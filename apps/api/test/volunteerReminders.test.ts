// The two-evenings-before volunteer reminder (migration 0041) — what is due,
// who is mailed, and what one failed or repeated run may NOT do.
//
// Behavioural, like test/volunteerEmails.test.ts and for the same reason: the
// properties worth defending are spelled as WHERE clauses and a guarded UPDATE,
// and a source scan can see a clause without proving it excludes anything. The
// fake D1 below EVALUATES them — a candidate query that dropped
// `published_at IS NOT NULL` mails a draft sheet's volunteers about an
// unannounced event, and that shows up here as a failing expectation naming the
// sheet. The fake EMAIL binding records every message, so what reaches an inbox
// is asserted on content, not on counters.
//
// The properties:
//
//   1. Due = published, un-reminded, occurrence on the calendar, ≥1 signup,
//      1–2 school-local days ahead. Tonight's event, a 5-days-out event, a
//      draft, an orphan and an already-reminded sheet all send nothing.
//   2. One message per ADDRESS, carrying every shift that address stands
//      behind; a private contact item is never the address used.
//   3. The claim is a CAS: a second run finds `reminder_sent_at` set and sends
//      nothing twice.
//   4. Unreachable volunteers are counted into the audit row, never dropped
//      silently — and never block the sheet's record.
//   5. A wholly failed send releases its own claim, so the next evening
//      retries instead of losing the reminder forever.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { buildTestReminder, sendVolunteerReminders } from "../src/lib/volunteerReminders.js";

/** Monday Nov 2 2026, 6:15pm CST — the cron's 00:15 UTC as a school evening. */
const NOW = new Date("2026-11-03T00:15:00.000Z");

interface SheetRow {
  id: string;
  slug: string;
  managed_event_id: string;
  occurrence_start: string;
  published_at: string | null;
  reminder_sent_at: string | null;
  runbook_url: string | null;
}

interface EventRow {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
}

interface SignupRow {
  sheet_id: string;
  person_id: string;
  /** Position fields, denormalised for the fake's one JOINed read. */
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
}

interface ContactRow {
  owner_id: string;
  value: string;
  visibility: "service" | "private";
  sort_order: number;
}

interface ControlRow {
  person_id: string;
  user_id: string;
  email: string;
  since: string;
  disabled: boolean;
}

interface PositionRow {
  sheet_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
}

interface World {
  sheets: SheetRow[];
  events: EventRow[];
  /** `${managed_event_id}|${starts_at}` — the materialized agenda. */
  occurrences: Set<string>;
  signups: SignupRow[];
  /** The positions themselves, read by `buildTestReminder` (the cron reads
   *  them through the signup JOIN instead). */
  positions: PositionRow[];
  contacts: ContactRow[];
  controls: ControlRow[];
  audit: unknown[][];
}

/** The clauses under test, matched as predicates (see the header). */
const PUBLISHED_ONLY = /published_at IS NOT NULL/;
const UNREMINDED_ONLY = /reminder_sent_at IS NULL/;
const ON_CALENDAR = /EXISTS \(SELECT 1 FROM calendar_event/;
const HAS_SIGNUP = /EXISTS \(SELECT 1 FROM volunteer_signup/;
const SERVICE_ONLY = /visibility = 'service'/;
const ENABLED_ONLY = /disabled_at IS NULL/;

interface SentMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

function fakeEnv(world: World): { env: Env; sent: SentMessage[]; refuse: { on: boolean } } {
  const sent: SentMessage[] = [];
  const refuse = { on: false };
  const db = {
    prepare(sql: string) {
      const make = (binds: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM audit_log")) return null; // empty chain
          if (sql.includes("FROM volunteer_sheet s") && sql.includes("WHERE s.id = ?")) {
            const s = world.sheets.find((s) => s.id === binds[0]);
            if (!s) return null;
            const e = world.events.find((e) => e.id === s.managed_event_id)!;
            return {
              id: s.id,
              slug: s.slug,
              occurrence_start: s.occurrence_start,
              runbook_url: s.runbook_url,
              title: e.title,
              location: e.location,
              event_starts_at: e.starts_at,
              event_ends_at: e.ends_at,
              all_day: e.all_day,
            } as unknown as T;
          }
          throw new Error(`unexpected first(): ${sql}`);
        },
        async run() {
          if (sql.startsWith("UPDATE volunteer_sheet SET reminder_sent_at = ?")) {
            const [value, id] = binds as [string, string];
            const sheet = world.sheets.find((s) => s.id === id);
            // The CAS under test: only a currently-NULL marker may be claimed.
            if (sheet && (!UNREMINDED_ONLY.test(sql) || sheet.reminder_sent_at === null)) {
              sheet.reminder_sent_at = value;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("SET reminder_sent_at = NULL")) {
            const [id, claimed] = binds as [string, string];
            const sheet = world.sheets.find((s) => s.id === id);
            if (sheet && sheet.reminder_sent_at === claimed) {
              sheet.reminder_sent_at = null;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("INSERT INTO audit_log")) {
            world.audit.push(binds);
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected run(): ${sql}`);
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes("FROM volunteer_sheet s") && sql.includes("JOIN managed_event")) {
            const [lo, hi] = binds as [string, string];
            const rows = world.sheets
              .filter((s) => (PUBLISHED_ONLY.test(sql) ? s.published_at !== null : true))
              .filter((s) => (UNREMINDED_ONLY.test(sql) ? s.reminder_sent_at === null : true))
              .filter((s) => s.occurrence_start > lo && s.occurrence_start < hi)
              .filter((s) =>
                ON_CALENDAR.test(sql)
                  ? world.occurrences.has(`${s.managed_event_id}|${s.occurrence_start}`)
                  : true,
              )
              .filter((s) =>
                HAS_SIGNUP.test(sql) ? world.signups.some((g) => g.sheet_id === s.id) : true,
              )
              .map((s) => {
                const e = world.events.find((e) => e.id === s.managed_event_id)!;
                return {
                  id: s.id,
                  slug: s.slug,
                  occurrence_start: s.occurrence_start,
                  runbook_url: s.runbook_url,
                  title: e.title,
                  location: e.location,
                  event_starts_at: e.starts_at,
                  event_ends_at: e.ends_at,
                  all_day: e.all_day,
                };
              })
              .sort((a, b) => a.occurrence_start.localeCompare(b.occurrence_start));
            return { results: rows as T[] };
          }
          if (sql.includes("FROM volunteer_signup su") && sql.includes("JOIN volunteer_position")) {
            const sheetId = binds[0] as string;
            const rows = world.signups
              .filter((g) => g.sheet_id === sheetId)
              .slice()
              .sort(
                (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
              )
              .map((g) => ({
                person_id: g.person_id,
                title: g.title,
                starts_at: g.starts_at,
                ends_at: g.ends_at,
              }));
            return { results: rows as T[] };
          }
          if (sql.includes("FROM volunteer_position") && !sql.includes("volunteer_signup")) {
            const sheetId = binds[0] as string;
            const rows = world.positions
              .filter((p) => p.sheet_id === sheetId)
              .slice()
              .sort(
                (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
              )
              .map((p) => ({ title: p.title, starts_at: p.starts_at, ends_at: p.ends_at }));
            return { results: rows as T[] };
          }
          if (sql.includes("FROM contact_item")) {
            const ids = binds as string[];
            const rows = world.contacts
              .filter((r) => ids.includes(r.owner_id))
              .filter((r) => (SERVICE_ONLY.test(sql) ? r.visibility === "service" : true))
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((r) => ({ person_id: r.owner_id, email: r.value }));
            return { results: rows as T[] };
          }
          if (sql.includes("FROM control")) {
            const ids = binds as string[];
            const rows = world.controls
              .filter((r) => ids.includes(r.person_id))
              .filter((r) => (ENABLED_ONLY.test(sql) ? !r.disabled : true))
              .slice()
              .sort((a, b) => a.since.localeCompare(b.since) || a.user_id.localeCompare(b.user_id))
              .map((r) => ({ person_id: r.person_id, email: r.email }));
            return { results: rows as T[] };
          }
          throw new Error(`unexpected all(): ${sql}`);
        },
      });
      return { bind: (...binds: unknown[]) => make(binds), ...make([]) };
    },
  };
  const env = {
    DB: db,
    SCHOOL_NAME: "Eisenhower PTO",
    SCHOOL_TIMEZONE: "America/Chicago",
    CALENDAR_URL: "https://calendar.example",
    // The binding channel, so sends report per message and the test can read
    // what would land in an inbox. A non-transient refusal avoids the paced
    // retry sleeps on the failure test.
    BULK_EMAIL_FROM: "Eisenhower PTO <newsletter@sitemail.example>",
    EMAIL_FROM: "Directory <directory@sitemail.example>",
    // Replies go to a human, not the sending machine (absent-means-off).
    EMAIL_REPLY_TO: "site@eisenhower.example",
    EMAIL: {
      async send(msg: SentMessage) {
        if (refuse.on) {
          const err = new Error("refused") as Error & { code: string };
          err.code = "E_SEND_FAILED";
          throw err;
        }
        sent.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo });
      },
    },
  } as unknown as Env;
  return { env, sent, refuse };
}

/** Fall Carnival, Wednesday Nov 4 5–8pm CST — two school-local days ahead of
 *  NOW. Dana's household (herself + a child, one account) takes two shifts;
 *  Sam takes one with a published address of his own. */
function world(): World {
  const start = "2026-11-04T23:00:00.000Z"; // Nov 4, 5:00pm CST
  return {
    events: [
      {
        id: "01EVT",
        title: "Fall Carnival",
        location: "Gym",
        starts_at: start,
        ends_at: "2026-11-05T02:00:00.000Z", // 8:00pm CST
        all_day: 0,
      },
    ],
    sheets: [
      {
        id: "01SHEET",
        slug: "fall-carnival-2026-11-04",
        managed_event_id: "01EVT",
        occurrence_start: start,
        published_at: "2026-10-01T00:00:00.000Z",
        reminder_sent_at: null,
        runbook_url: null,
      },
    ],
    occurrences: new Set([`01EVT|${start}`]),
    positions: [
      {
        sheet_id: "01SHEET",
        title: "Snack table",
        starts_at: "2026-11-04T23:00:00.000Z",
        ends_at: "2026-11-05T01:00:00.000Z",
        sort_order: 0,
        created_at: "2026-10-01T00:00:00.000Z",
      },
      {
        sheet_id: "01SHEET",
        title: "Cleanup crew",
        starts_at: "2026-11-05T01:00:00.000Z",
        ends_at: "2026-11-05T02:00:00.000Z",
        sort_order: 1,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    signups: [
      {
        sheet_id: "01SHEET",
        person_id: "01DANA",
        title: "Snack table",
        starts_at: "2026-11-04T23:00:00.000Z", // 5:00pm
        ends_at: "2026-11-05T01:00:00.000Z", // 7:00pm
        sort_order: 0,
        created_at: "2026-10-02T00:00:00.000Z",
      },
      {
        sheet_id: "01SHEET",
        person_id: "01KID",
        title: "Cleanup crew",
        starts_at: "2026-11-05T01:00:00.000Z", // 7:00pm
        ends_at: "2026-11-05T02:00:00.000Z", // 8:00pm
        sort_order: 1,
        created_at: "2026-10-03T00:00:00.000Z",
      },
      {
        sheet_id: "01SHEET",
        person_id: "01SAM",
        title: "Snack table",
        starts_at: "2026-11-04T23:00:00.000Z",
        ends_at: "2026-11-05T01:00:00.000Z",
        sort_order: 0,
        created_at: "2026-10-04T00:00:00.000Z",
      },
    ],
    contacts: [
      { owner_id: "01SAM", value: "sam@example.com", visibility: "service", sort_order: 0 },
      // The address a dropped `visibility = 'service'` clause would pick up.
      { owner_id: "01DANA", value: "dana-private@example.com", visibility: "private", sort_order: 0 },
    ],
    controls: [
      { person_id: "01DANA", user_id: "01U", email: "dana@example.com", since: "2026-01-01", disabled: false },
      { person_id: "01KID", user_id: "01U", email: "dana@example.com", since: "2026-01-01", disabled: false },
      { person_id: "01SAM", user_id: "01U_SAM", email: "sam-account@example.com", since: "2026-01-01", disabled: false },
    ],
    audit: [],
  };
}

/** The audit INSERT's bind order (lib/audit.ts): action is 5th, detail 8th. */
function auditRow(w: World, i = 0): { action: string; detail: Record<string, unknown> } {
  const binds = w.audit[i]!;
  return { action: binds[4] as string, detail: JSON.parse(binds[7] as string) };
}

describe("sendVolunteerReminders", () => {
  it("mails one message per address with every shift that address holds", async () => {
    const w = world();
    const { env, sent } = fakeEnv(w);
    const run = await sendVolunteerReminders(env, NOW);

    expect(run).toEqual({ considered: 1, sheets: 1, recipients: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual(["dana@example.com", "sam@example.com"]);

    // Dana's household: two shifts in one email, in sheet order.
    const dana = sent.find((m) => m.to === "dana@example.com")!;
    expect(dana.subject).toContain("Fall Carnival");
    expect(dana.subject).toContain("Wednesday, November 4");
    expect(dana.text).toContain("Snack table");
    expect(dana.text).toContain("Cleanup crew");
    expect(dana.text).toContain("Gym");
    expect(dana.text).toContain("https://calendar.example/v/fall-carnival-2026-11-04");
    // Shift windows are the school's wall clock, 12-hour.
    expect(dana.text).toContain("5:00");
    expect(dana.text).toContain("7:00");
    expect(dana.text).toMatch(/PM/);

    // Sam has one shift, and his private address was never the one used.
    const sam = sent.find((m) => m.to === "sam@example.com")!;
    expect(sam.text).toContain("Snack table");
    expect(sam.text).not.toContain("Cleanup crew");
    expect(JSON.stringify(sent)).not.toContain("dana-private@example.com");

    // The email names nobody — no first name from any fixture leaks in.
    expect(dana.text).not.toMatch(/Dana|Sam|01KID/i);

    // And it is a REAL reminder: no test banner, nothing claiming it lists the
    // whole sheet (that wording is the proof's alone — see buildTestReminder).
    expect(dana.text).not.toMatch(/test|every position/i);

    // It speaks of SOMEONE in the family, never "your family signed up" — one
    // address covers the household, and the plural reading said all of them
    // had signed up (user feedback, 2026-11-03).
    expect(dana.text).toContain("Someone in your family");
    expect(dana.text).not.toContain("Your family signed up");

    // Replies land with a human (EMAIL_REPLY_TO), not the sending machine.
    expect(dana.replyTo).toBe("site@eisenhower.example");

    // The record: one audit row, counts only, never an address.
    expect(w.audit).toHaveLength(1);
    const row = auditRow(w);
    expect(row.action).toBe("volunteer.reminder.sent");
    expect(row.detail.recipients).toBe(2);
    expect(row.detail.withoutEmail).toBe(0);
    expect(JSON.stringify(row.detail)).not.toContain("@example.com");
  }, 15000);

  it("claims the sheet once: a second run sends nothing", async () => {
    const w = world();
    const first = fakeEnv(w);
    await sendVolunteerReminders(first.env, NOW);
    expect(w.sheets[0]!.reminder_sent_at).not.toBeNull();

    const second = fakeEnv(w);
    const run = await sendVolunteerReminders(second.env, NOW);
    expect(run.sheets).toBe(0);
    expect(second.sent).toHaveLength(0);
    expect(w.audit).toHaveLength(1);
  }, 15000);

  it("sends nothing for tonight, far-off, draft, orphaned or signup-less sheets", async () => {
    const w = world();
    const start = w.sheets[0]!.occurrence_start;
    // Tonight (0 school-local days ahead) and five days out.
    w.sheets.push(
      { ...w.sheets[0]!, id: "01TONIGHT", slug: "tonight", occurrence_start: "2026-11-03T01:00:00.000Z" },
      { ...w.sheets[0]!, id: "01FAR", slug: "far", occurrence_start: "2026-11-08T23:00:00.000Z" },
      { ...w.sheets[0]!, id: "01DRAFT", slug: "draft", published_at: null },
      { ...w.sheets[0]!, id: "01ORPHAN", slug: "orphan", occurrence_start: "2026-11-04T22:00:00.000Z" },
      { ...w.sheets[0]!, id: "01EMPTY", slug: "empty" },
    );
    w.occurrences.add("01EVT|2026-11-03T01:00:00.000Z");
    w.occurrences.add("01EVT|2026-11-08T23:00:00.000Z");
    // 01ORPHAN's date is deliberately NOT in `occurrences` — edited away.
    // Give each sheet its own signup, so only the gate under test excludes it.
    for (const id of ["01TONIGHT", "01FAR", "01DRAFT", "01ORPHAN"]) {
      w.signups.push({ ...w.signups[0]!, sheet_id: id });
    }
    // 01EMPTY deliberately gets none.
    // Make the original sheet already reminded, so anything sent now is a bug.
    w.sheets[0]!.reminder_sent_at = "2026-11-01T00:15:00.000Z";

    const { env, sent } = fakeEnv(w);
    const run = await sendVolunteerReminders(env, NOW);
    expect(run.sheets).toBe(0);
    expect(sent).toHaveLength(0);
    // Nothing was claimed either — the empty sheet stays open for a late signup.
    expect(w.sheets.filter((s) => s.reminder_sent_at !== null)).toHaveLength(1);
  });

  it("counts unreachable volunteers instead of dropping them silently", async () => {
    const w = world();
    // Kai's only controller is disabled and he published nothing.
    w.signups.push({
      sheet_id: "01SHEET",
      person_id: "01KAI",
      title: "Cleanup crew",
      starts_at: null,
      ends_at: null,
      sort_order: 1,
      created_at: "2026-10-05T00:00:00.000Z",
    });
    w.controls.push({
      person_id: "01KAI",
      user_id: "01U_GONE",
      email: "gone@example.com",
      since: "2026-01-01",
      disabled: true,
    });
    const { env, sent } = fakeEnv(w);
    await sendVolunteerReminders(env, NOW);
    expect(sent.map((m) => m.to)).not.toContain("gone@example.com");
    expect(auditRow(w).detail.withoutEmail).toBe(1);
  }, 15000);

  it("carries the runbook link when the sheet has one — and only then", async () => {
    const w = world();
    w.sheets[0]!.runbook_url = "https://docs.google.com/document/d/runbook123";
    const { env, sent } = fakeEnv(w);
    await sendVolunteerReminders(env, NOW);
    for (const m of sent) {
      expect(m.text).toContain("https://docs.google.com/document/d/runbook123");
      expect(m.html).toContain("https://docs.google.com/document/d/runbook123");
    }
  }, 15000);

  it("says nothing about a runbook when there is none", async () => {
    const w = world();
    const { env, sent } = fakeEnv(w);
    await sendVolunteerReminders(env, NOW);
    expect(JSON.stringify(sent)).not.toMatch(/runbook/i);
  }, 15000);

  it("releases its claim when the whole send is refused, so tomorrow retries", async () => {
    const w = world();
    const { env, sent, refuse } = fakeEnv(w);
    refuse.on = true;
    const run = await sendVolunteerReminders(env, NOW);

    expect(run.sheets).toBe(0);
    expect(sent).toHaveLength(0);
    // The claim was taken and given back — matched by value, so this is OUR
    // claim being released, not any claim being clobbered.
    expect(w.sheets[0]!.reminder_sent_at).toBeNull();
    // A refused send changed nothing, so it is not an audit event.
    expect(w.audit).toHaveLength(0);

    // The next evening succeeds.
    refuse.on = false;
    const retry = await sendVolunteerReminders(env, NOW);
    expect(retry.sheets).toBe(1);
    expect(sent.length).toBeGreaterThan(0);
  }, 20000);
});

describe("buildTestReminder (the admin's proof)", () => {
  it("renders every position — signups or not — through the same template", async () => {
    const w = world();
    w.sheets[0]!.runbook_url = "https://docs.google.com/document/d/runbook123";
    // A DRAFT with nobody signed up: the state a test send is actually wanted in.
    w.sheets[0]!.published_at = null;
    w.signups = [];
    const { env } = fakeEnv(w);

    const built = await buildTestReminder(env, "01SHEET");
    expect(built).not.toBeNull();
    expect(built!.positionCount).toBe(2);
    const { msg } = built!;
    expect(msg.subject).toContain("Fall Carnival");
    expect(msg.subject).toContain("Wednesday, November 4");
    expect(msg.text).toContain("Snack table");
    expect(msg.text).toContain("Cleanup crew");
    expect(msg.text).toContain("https://docs.google.com/document/d/runbook123");
    expect(msg.text).toContain("https://calendar.example/v/fall-carnival-2026-11-04");
    // Built with `to` unset — the ROUTE chooses recipients and adds "[Test]".
    expect(msg.to).toBe("");
    // The banner that keeps the proof honest: it lists EVERY position, where a
    // real reminder is per-family, and the body has to say so — an admin who
    // signed up for one shift otherwise reads the whole sheet as THEIR shifts
    // (reported the first evening this was tried, 2026-11-03).
    expect(msg.text).toContain("EVERY position");
    expect(msg.text).toContain("only the shifts they signed up for");
    expect(msg.html).toContain("every position on the sheet");
  });

  it("reports an empty sheet so the route can refuse instead of mailing a blank", async () => {
    const w = world();
    w.positions = [];
    const { env } = fakeEnv(w);
    const built = await buildTestReminder(env, "01SHEET");
    expect(built!.positionCount).toBe(0);
  });

  it("is null for a sheet that does not exist", async () => {
    const { env } = fakeEnv(world());
    expect(await buildTestReminder(env, "01NOPE")).toBeNull();
  });
});

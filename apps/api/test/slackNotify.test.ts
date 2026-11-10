// The audit → Slack seam (invariant 22).
//
// This is the outbound twin of calendarPublic.test.ts and volunteersPublic.
// test.ts, and it asserts the same two kinds of thing they do: that the
// projection emits exactly what it means to, and that something added upstream
// LATER cannot ride along into it. The difference is what "out" means — those
// two guard a response to an anonymous reader inside the system, this one
// guards a message to a third party with retention, search and export.
//
// Four properties hold this seam together, and each has a test that fails loudly:
//
//   1. An action with no formatter sends nothing — including an action that
//      does not exist yet, which is the case no route-pinned test can cover.
//   2. `detail` never reaches a message. The formatter type has no such field,
//      so this is a regression test for the type being weakened later.
//   3. An unlisted Person is not named (invariants 21 + 22). The fake DB below
//      deliberately honours the guard rather than assuming it, so a guard that
//      collapsed to the literal "1" would FAIL this test rather than pass it.
//   4. Nothing here ever throws, at any layer.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AuditAction } from "@sd/shared";
import type { AuditDraft, AuditMeta } from "../src/lib/audit.js";
import { notifySlackForAudit, personLabel, slackLinesOf } from "../src/lib/slackNotify.js";
import type { Env } from "../src/env.js";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";

const META: AuditMeta = {
  actorUserId: "01ADMIN",
  masqueradingAs: null,
  ip: null,
  userAgent: null,
};

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: "full" | "initial";
  unlisted_at: string | null;
}

const PEOPLE: PersonRow[] = [
  { id: "01DANA", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full", unlisted_at: null },
  { id: "01INIT", first_name: "Sam", last_name: "Okonkwo", last_name_visibility: "initial", unlisted_at: null },
  {
    id: "01HIDDEN",
    first_name: "Jo",
    last_name: "Nguyen",
    last_name_visibility: "full",
    // Off the roster. Invariant 21 hides them from every ordinary member; the
    // Slack channel is a weaker audience still, so they must not be named here.
    unlisted_at: "2026-05-01T00:00:00.000Z",
  },
];

const USERS = [
  { id: "01ADMIN", email: "admin@eisenhower.edu" },
  { id: "01TARGET", email: "parent@eisenhower.edu" },
];

/** The enumeration guard, as it appears in a statement that actually carries
 *  one. Passing `isSystemAdmin: true` to `personListableSql` returns the
 *  literal "1" instead, which is why matching the PREDICATE — not the mere
 *  presence of a `personListableSql` call — is what proves the gate is live.
 *  test/personListable.test.ts's scan cannot tell those two apart; this can. */
const GUARD = /unlisted_at IS NULL/;

/** A D1 stand-in that answers only the statements this seam issues, and throws
 *  on anything else — same "narrow on purpose" idea as the fakes in
 *  newsletterSubscribe.test.ts and auditChain.test.ts.
 *
 *  It HONOURS the unlisted guard rather than assuming it: an unlisted row comes
 *  back when the SQL has no guard, so a regression that removed one is visible
 *  as a leaked name rather than hidden behind a cooperative fake. */
function fakeDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes("FROM person")) {
                const row = PEOPLE.find((p) => p.id === binds[0]);
                if (!row) return null;
                if (row.unlisted_at !== null && GUARD.test(sql)) return null;
                return row as unknown as T;
              }
              if (sql.includes("FROM grp")) {
                return (binds[0] === "01GRP"
                  ? { name: "Smith Household", kind: "household" }
                  : null) as T | null;
              }
              if (sql.includes("FROM calendar_source")) {
                return (binds[0] === "01SRC" ? { name: "District Athletics" } : null) as T | null;
              }
              if (sql.includes("FROM newsletter_issue")) {
                return (binds[0] === "01ISSUE"
                  ? { title: "October Update", slug: "october-update" }
                  : null) as T | null;
              }
              throw new Error(`fakeDb: unhandled first(): ${sql}`);
            },
            async all<T>(): Promise<{ results: T[] }> {
              if (sql.includes("FROM user")) {
                return { results: USERS.filter((u) => binds.includes(u.id)) as unknown as T[] };
              }
              throw new Error(`fakeDb: unhandled all(): ${sql}`);
            },
            async run() {
              throw new Error(`fakeDb: unexpected write: ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function testEnv(webhook?: string): Env {
  return {
    DB: fakeDb(),
    SCHOOL_NAME: "Eisenhower PTO",
    APP_URL: "https://directory.eisenhower.school",
    ALLOWED_ORIGINS: "https://directory.eisenhower.school",
    CALENDAR_URL: "https://calendar.eisenhower.school",
    NEWSLETTER_URL: "https://newsletter.eisenhower.school",
    LOSTFOUND_URL: "https://lostandfound.eisenhower.school",
    SLACK_WEBHOOK_URL: webhook,
  } as unknown as Env;
}

/** Every request Slack received. */
let posted: { url: string; text: string }[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (String(url).includes("hooks.slack.com")) {
      posted.push({ url: String(url), text: JSON.parse(String(init.body)).text });
      return new Response("ok", { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

const lines = (drafts: AuditDraft[], env = testEnv(WEBHOOK), meta = META) =>
  slackLinesOf(env, drafts, meta);

describe("the allowlist is closed by construction", () => {
  it("says nothing about an action that does not exist yet", async () => {
    // The case no route-pinned test can reach: a future AuditAction. A design
    // that denylisted noisy actions instead of allowlisting quiet ones would
    // start posting this the day it was added. See CLAUDE.md invariant 22.
    const future = { action: "something.invented.later" as AuditAction, entityId: "01X" };
    expect(await lines([future])).toEqual([]);
  });

  it("says nothing about an action that names an Object.prototype key", async () => {
    // `action in FORMATTERS` would be TRUE for these — `in` walks the prototype
    // chain — and `FORMATTERS.toString` called as a formatter returns the
    // truthy "[object Object]", which would post. Nothing can push these today
    // (the field is typed `AuditAction`), but the allowlist's promise is about
    // any string or it is not worth making.
    for (const action of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      expect(await lines([{ action: action as AuditAction }])).toEqual([]);
    }
  });

  it("says nothing about the real actions deliberately left off", async () => {
    // Pinned so that adding one of these to FORMATTERS is a visible diff in
    // this file rather than a quiet flood in someone's channel.
    const excluded: AuditAction[] = [
      // The near-misses matter most here: each of these has a sibling that IS
      // curated, so a copy-paste in FORMATTERS would show up as a failure.
      "auth.signin", // vs auth.registered — every visit, not the one arrival
      "auth.signout",
      "person.updated", // vs person.created — every edit, not the one arrival
      "contact.created",
      "contact.updated",
      "share.created",
      "share.revoked",
      "newsletter.issue.updated", // opening a draft is not news; the send is
      "calendar.managed.created", // vs calendar.event.created — the calendar, not an event on it
      "calendar.source.updated", // vs source.created/deleted — a re-fetch is not news
      "calendar.refreshed",
      "newsletter.subscriber.added",
      // vs access.requested — the ASK needs a human, the answer does not, and
      // a decision per applicant is the per-event noise this list exists for.
      "access.approved",
      "access.declined",
    ];
    for (const action of excluded) {
      expect(await lines([{ action, entityId: "01X" }])).toEqual([]);
    }
  });

  it("posts nothing at all when a request's drafts are all uncurated", async () => {
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "auth.signin" }], META);
    expect(posted).toEqual([]);
  });

  it("declines an admin.action whose op is not curated", async () => {
    // admin.action is a fifteen-way catch-all and nine of its ops are spoken.
    // The rest must fall through the switch's default and say nothing. Roster
    // ops (member.add/update/remove) were ADDED to the spoken set once the
    // production numbers showed the channel was otherwise near-silent; these
    // are the ones still left out.
    for (const op of ["group.rename", "group.reparent", "group.delete", "bootstrap_admin"]) {
      const draft: AuditDraft = {
        action: "admin.action",
        entityId: "01G",
        notify: { op, email: "admin@eisenhower.edu" },
      };
      expect(await lines([draft])).toEqual([]);
    }
  });
});

describe("`detail` cannot reach a message", () => {
  it("never emits the calendar feed URL, which may be a secret subscribe link", async () => {
    // The case that shaped the formatter's input type. routes/admin.ts puts the
    // feed's `url` in `detail`, and invariant 12 says an admin may have pasted a
    // secret Google/Outlook link there. The name is read back off the row.
    const secret = "https://calendar.google.com/private/abc123-secret-token/basic.ics";
    const [line] = await lines([
      {
        action: "calendar.source.created",
        entityKind: "calendar_source",
        entityId: "01SRC",
        detail: { url: secret },
      },
    ]);
    expect(line).toContain("District Athletics");
    expect(line).not.toContain("abc123-secret-token");
    expect(line).not.toContain("calendar.google.com");
  });

  it("falls back to (unknown) rather than to `detail` when notify is absent", async () => {
    // Proves there is no fallback path from `notify` to `detail`: a formatter
    // starved of its bag says nothing useful rather than reaching for the blob.
    const [line] = await lines([
      {
        action: "calendar.source.deleted",
        entityId: "01GONE",
        detail: { url: "https://outlook.office365.com/owa/calendar/secret-token/reachcalendar.ics" },
      },
    ]);
    expect(line).toContain("(unknown)");
    expect(line).not.toContain("secret-token");
  });
});

describe("an unlisted Person is not named", () => {
  it("renders the generic form for someone off the roster", async () => {
    // A guard that collapsed to the literal "1" would return the row here and
    // this would read "Jo Nguyen". That is the exact regression it catches.
    expect(await personLabel(testEnv(), "01HIDDEN")).toBe("A member");
  });

  it("names a listed Person normally", async () => {
    expect(await personLabel(testEnv(), "01DANA")).toBe("Dana Ruiz");
  });

  it("still honours last_name_visibility for a listed Person", async () => {
    // Being read from Slack grants none of a Controller's extra trust.
    expect(await personLabel(testEnv(), "01INIT")).toBe("Sam O.");
  });

  it("says the same thing for a withheld Person and one who does not exist", async () => {
    // Telling those apart would make the channel an oracle for the flag.
    expect(await personLabel(testEnv(), "01NOSUCH")).toBe("A member");
  });

  it("redacts the name in a volunteer line but still reports the count", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01HIDDEN",
          sheetSlug: "fall-festival",
          positionTitle: "Setup Crew",
          eventTitle: "Fall Festival",
          filled: 3,
          slots: 4,
        },
      },
    ]);
    expect(line).toContain("A member");
    expect(line).not.toContain("Nguyen");
    // The spot still reads as taken — the same reasoning `positionsOf` uses for
    // `filled` (invariant 13): a count that shrank with the name would
    // advertise a covered shift as needing help.
    expect(line).toContain("3/4");
  });
});

describe("the widened allowlist — activity, not field edits", () => {
  it("names both the Person and the group on a roster change", async () => {
    const [line] = await lines([
      {
        action: "admin.action",
        entityKind: "group",
        entityId: "01GRP",
        notify: { op: "member.add", personId: "01DANA" },
      },
    ]);
    expect(line).toContain("Dana Ruiz");
    expect(line).toContain("Smith Household");
    expect(line).toContain("added to");
  });

  it("puts a roster change's Person through the same gate as everything else", async () => {
    // The group is named; the unlisted member is not. Group-level hiding is
    // deliberately not built (invariant 21), so only one half is withheld.
    const [line] = await lines([
      {
        action: "admin.action",
        entityId: "01GRP",
        notify: { op: "member.remove", personId: "01HIDDEN" },
      },
    ]);
    expect(line).toContain("A member");
    expect(line).toContain("Smith Household");
    expect(line).not.toContain("Nguyen");
  });

  it("declines a self-grant, which person.created already reported", async () => {
    // Both drafts come from ONE request (routes/me.ts). Without this, adding a
    // child would post two lines saying the same thing.
    expect(await lines([{ action: "control.granted", entityId: "01DANA", notify: { self: true } }])).toEqual([]);
  });

  it("speaks for a grant to someone else, which nothing else reports", async () => {
    const [line] = await lines([{ action: "control.granted", entityId: "01DANA", notify: {} }]);
    expect(line).toContain("Dana Ruiz");
    expect(line).toContain("can now manage");
  });

  it("links a volunteer sheet by its own slug, not the occurrence pair", async () => {
    const [line] = await lines([
      {
        action: "volunteer.sheet.created",
        entityId: "01SHEET",
        // What routes/managedCalendar.ts puts in `detail` — the durable handle
        // invariant 12 withholds from anything outward-facing.
        detail: { seriesId: "01SERIES", occurrenceStart: "2026-10-17T18:00:00.000Z" },
        notify: { eventTitle: "Fall Festival", slug: "fall-festival", published: true },
      },
    ]);
    expect(line).toContain("Fall Festival");
    expect(line).toContain("https://calendar.eisenhower.school/v/fall-festival");
    expect(line).not.toContain("01SERIES");
    expect(line).not.toContain("2026-10-17");
  });

  it("names the event on a deleted sheet, captured before the row went", async () => {
    const [line] = await lines([
      { action: "volunteer.sheet.deleted", entityId: "01SHEET", notify: { eventTitle: "Fall Festival" } },
    ]);
    expect(line).toContain("Fall Festival");
    expect(line).toContain("deleted");
  });
});

describe("a directory-access request names nobody", () => {
  // The most sensitive claim in the system — a child's first name and their
  // teacher — reaches Slack from this action or from none, so this is the test
  // that would fail if someone later "improved" the line with who it was.
  it("speaks, and carries no address, child or room", async () => {
    const [line] = await lines([
      {
        action: "access.requested",
        entityId: "01USER_NEW",
        detail: { resubmitted: false, email: "parent@family.test" },
        notify: { resubmitted: false },
      },
    ]);
    expect(line).toContain("asked for directory access");
    expect(line).not.toContain("parent@family.test");
    expect(line).not.toMatch(/Grade|Rm |Ms\.|Mr\./);
  });

  it("distinguishes a re-ask after a decline, from `notify` and not `detail`", async () => {
    const [first] = await lines([
      { action: "access.requested", entityId: "01U", notify: { resubmitted: false } },
    ]);
    const [again] = await lines([
      { action: "access.requested", entityId: "01U", notify: { resubmitted: true } },
    ]);
    expect(first).not.toContain("again");
    expect(again).toContain("again");
  });

  it("falls back to the plain line when `detail` alone claims a re-ask", async () => {
    // `detail` is not in a formatter's scope at all (invariant 22). If this
    // ever starts saying "again", `detail` has leaked into the input type.
    const [line] = await lines([
      { action: "access.requested", entityId: "01U", detail: { resubmitted: true } },
    ]);
    expect(line).not.toContain("again");
  });
});

describe("message content", () => {
  it("names the person, position, event and count, and links the sheet", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01DANA",
          sheetSlug: "fall-festival",
          positionTitle: "Setup Crew",
          eventTitle: "Fall Festival",
          filled: 1,
          slots: 4,
        },
      },
    ]);
    expect(line).toContain("Dana Ruiz");
    expect(line).toContain("Setup Crew");
    expect(line).toContain("Fall Festival");
    expect(line).toContain("1/4");
    expect(line).toContain("https://calendar.eisenhower.school/v/fall-festival");
  });

  it("reads a newsletter's title back off the row it was sent from", async () => {
    const [line] = await lines([
      {
        action: "newsletter.issue.sent",
        entityId: "01ISSUE",
        notify: { recipientTotal: 214 },
      },
    ]);
    expect(line).toContain("October Update");
    expect(line).toContain("214 subscribers");
    expect(line).toContain("https://newsletter.eisenhower.school/n/october-update");
    expect(line).toContain("admin@eisenhower.edu");
  });

  it("attributes to the real admin during a masquerade, not the person acted as", async () => {
    // Matches the audit log's own convention: the human who acted is the actor,
    // and the impersonated account is recorded beside them.
    const [line] = await lines(
      [{ action: "registration.toggled", notify: { open: true } }],
      testEnv(WEBHOOK),
      { ...META, masqueradingAs: "01TARGET" },
    );
    expect(line).toContain("admin@eisenhower.edu (as parent@eisenhower.edu)");
  });

  it("escapes member-entered text so it cannot forge a Slack link", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01DANA",
          sheetSlug: "x",
          positionTitle: "<https://evil.example|Click here>",
          eventTitle: "Bake Sale & Raffle",
          filled: 1,
          slots: 2,
        },
      },
    ]);
    expect(line).toContain("&lt;https://evil.example|Click here&gt;");
    expect(line).toContain("Bake Sale &amp; Raffle");
  });
});

describe("delivery", () => {
  it("coalesces one request's drafts into a single post", async () => {
    // c.var.audit is already the batch; two curated drafts from one handler are
    // one event to a reader, not two notifications.
    await notifySlackForAudit(
      testEnv(WEBHOOK),
      [
        { action: "registration.toggled", notify: { open: false } },
        { action: "admin.action", entityId: "01T", notify: { op: "user.admin.granted", email: "new@eisenhower.edu" } },
      ],
      META,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toContain("Registration *closed*");
    expect(posted[0]!.text).toContain("new@eisenhower.edu");
    expect(posted[0]!.text.split("\n")).toHaveLength(2);
  });

  it("posts a single line without bullet decoration", async () => {
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META);
    expect(posted[0]!.text.startsWith("•")).toBe(false);
  });

  it("logs instead of posting when no webhook is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await notifySlackForAudit(testEnv(undefined), [{ action: "registration.toggled", notify: { open: true } }], META);
    expect(posted).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).toContain("[slack:dev]");
    log.mockRestore();
  });
});

describe("nothing here ever throws", () => {
  it("survives Slack rejecting the post", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("no_service", { status: 404 }));
    await expect(
      notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("survives the network failing outright", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection reset");
    });
    await expect(
      notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META),
    ).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("survives a formatter whose lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      ...testEnv(WEBHOOK),
      DB: {
        prepare() {
          return {
            bind() {
              return {
                first: async () => {
                  throw new Error("D1_ERROR");
                },
                all: async () => {
                  throw new Error("D1_ERROR");
                },
              };
            },
          };
        },
      },
    } as unknown as Env;
    await expect(
      notifySlackForAudit(env, [{ action: "newsletter.issue.sent", entityId: "01ISSUE", notify: {} }], META),
    ).resolves.toBeUndefined();
    expect(posted).toEqual([]);
    err.mockRestore();
  });

  it("never posts the webhook URL into a log line", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 500 }));
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META);
    // The URL is a bearer capability to post into the channel; like every
    // secret it is never echoed, not even on failure.
    expect(err.mock.calls.flat().join(" ")).not.toContain("xxxxxxxx");
    err.mockRestore();
  });
});

describe("calendar event CRUD", () => {
  // Added deliberately, against the noise argument in slackNotify.ts's header:
  // the whole of an event's CRUD posts, updates included. These pin what each
  // one says — and, more importantly, what none of them says.

  it("names the event and links its page on create", async () => {
    const [line] = await lines([
      {
        action: "calendar.event.created",
        entityId: "01EV",
        notify: { title: "Fall Carnival", start: "2026-10-17T22:00:00.000Z", allDay: false, occurrences: 1 },
      },
    ]);
    expect(line).toContain("Fall Carnival");
    expect(line).toContain("Oct 17");
    // The content identity the calendar app addresses an event by (invariant 8).
    expect(line).toContain("/e/2026-10-17/fall-carnival");
  });

  it("reports what a delete took, and links nothing", async () => {
    const [line] = await lines([
      {
        action: "calendar.event.deleted",
        entityId: "01EV",
        notify: { title: "Fall Carnival", occurrences: 4, sheets: 1, signups: 3 },
      },
    ]);
    expect(line).toContain("Fall Carnival");
    expect(line).toContain("4 dates");
    // The cascade is the consequential half — a deleted signup is not
    // recoverable, and the people who claimed those spots are not told.
    expect(line).toContain("3 volunteer sign-ups");
    // The page is exactly what stopped resolving, so there must be no link.
    expect(line).not.toContain("/e/");
  });

  it("still refuses to say anything a route did not put in notify", async () => {
    // The defence invariant 22 rests on: a formatter has no `detail` in scope,
    // so a draft carrying a secret there cannot leak through one. This is the
    // calendar family's version of the assertion the source-feed test makes.
    const [line] = await lines([
      {
        action: "calendar.event.updated",
        entityId: "01EV",
        detail: { url: "https://calendar.google.com/private-abc123/basic.ics" },
        notify: { title: "Fall Carnival", start: "2026-10-17T22:00:00.000Z", allDay: false },
      },
    ]);
    expect(line).not.toContain("private-abc123");
    expect(line).not.toContain("google.com");
  });

  it("degrades to a usable line when notify is empty", async () => {
    // A push site that forgets the bag must still post something harmless
    // rather than throw inside waitUntil.
    const [line] = await lines([{ action: "calendar.event.updated", entityId: "01EV" }]);
    expect(line).toBeTruthy();
    expect(line).not.toContain("undefined");
  });
});

describe("someone new", () => {
  it("announces a self-serve signup with no actor", async () => {
    // Nobody is signed in when the row is written, so the message must not
    // claim an admin did it.
    const [line] = await lines(
      [{ action: "auth.registered", entityId: "01U", notify: { email: "new@eisenhower.edu", via: "signup" } }],
      testEnv(WEBHOOK),
      { actorUserId: null, masqueradingAs: null, ip: null, userAgent: null },
    );
    expect(line).toContain("new@eisenhower.edu");
    expect(line).toContain("signed up");
    expect(line).not.toContain("someone signed out");
  });

  it("tells an invitation apart from an open-registration signup", async () => {
    const [line] = await lines([
      { action: "auth.registered", entityId: "01U", notify: { email: "new@eisenhower.edu", via: "invite" } },
    ]);
    expect(line).toContain("accepted an invitation");
  });

  it("names a new Person through the gate, not from notify", async () => {
    const [line] = await lines([{ action: "person.created", entityId: "01DANA" }]);
    // The fake D1 honours personListableSql, so this only passes if the
    // formatter actually composed the guard.
    expect(line).toContain("Dana");
  });

  it("says 'A member' for a new Person who is unlisted", async () => {
    // The case that makes this channel safe: unlisted_at is reversible and a
    // Slack channel is not, so a withheld Person must never be named here —
    // and must read identically to a Person who does not exist (invariant 21).
    const [line] = await lines([{ action: "person.created", entityId: "01HIDDEN" }]);
    expect(line).toContain("A member");
    expect(line).not.toContain("Dana");
  });

  it("announces a group by name and kind", async () => {
    const [line] = await lines([
      {
        action: "admin.action",
        entityId: "01G",
        notify: { op: "group.create", name: "Ms. Ruiz — Grade 3", kind: "classroom" },
      },
    ]);
    expect(line).toContain("Ms. Ruiz");
    expect(line).toContain("classroom");
  });

  it("announces an admin-created user, and notes a silent one", async () => {
    const [loud] = await lines([
      { action: "admin.action", entityId: "01U", notify: { op: "user.create", email: "a@b.edu", emailSent: true } },
    ]);
    expect(loud).toContain("a@b.edu");
    expect(loud).not.toContain("no invitation");

    const [quiet] = await lines([
      { action: "admin.action", entityId: "01U", notify: { op: "user.create", email: "a@b.edu", emailSent: false } },
    ]);
    expect(quiet).toContain("no invitation sent");
  });
});

describe("lost & found", () => {
  it("links a claim to its own spot in the staff queue and names nobody", async () => {
    const [line] = await lines([
      {
        action: "lostfound.claim.created",
        entityKind: "lf_claim",
        entityId: "01CLAIM",
        detail: { itemId: "01ITEM" },
        notify: {},
      },
    ]);
    expect(line).toContain("<https://lostandfound.eisenhower.school/staff?claim=01CLAIM|Open claim>");
    expect(line).not.toContain("01ITEM");
  });
});

describe("the store", () => {
  it("speaks a sale, with a total and a town and nothing else", async () => {
    // What routes/storeWebhooks.ts actually puts in the bag. Note what is NOT
    // there: no buyer name, no street address, no email. The channel is a third
    // party with its own retention and membership list (invariant 22), and a
    // sale is reportable where the person who made it is not.
    const [line] = await lines([
      {
        action: "store.order.paid",
        entityKind: "store_order",
        entityId: "01ORDER",
        detail: { email: "buyer@example.com", totalCents: 5395, itemCount: 2 },
        notify: { totalCents: 5395, itemCount: 2, city: "Hopkins", state: "MN" },
      },
    ]);
    expect(line).toContain("$53.95");
    expect(line).toContain("2 items");
    expect(line).toContain("Hopkins, MN");
    // `detail` carries the buyer's address; the formatter cannot see it.
    expect(line).not.toContain("buyer@example.com");
  });

  it("never emits the buyer's email even when only `detail` holds it", async () => {
    // The same property calendar.source.created pins, restated for the store:
    // a formatter starved of `notify` reaches for nothing.
    const [line] = await lines([
      {
        action: "store.order.paid",
        entityKind: "store_order",
        entityId: "01ORDER",
        detail: {
          email: "buyer@example.com",
          shipTo: "412 Maple Street, Hopkins MN",
          stripeSessionId: "cs_live_secret",
        },
      },
    ]);
    expect(line).not.toContain("buyer@example.com");
    expect(line).not.toContain("412 Maple Street");
    expect(line).not.toContain("cs_live_secret");
  });

  it("raises a charged-but-unprinted order, because that one needs a person", async () => {
    const [line] = await lines([
      {
        action: "store.order.fulfillment_failed",
        entityKind: "store_order",
        entityId: "01ORDER",
        detail: { error: "Variant 4771000 is discontinued", attempts: 6 },
        notify: { totalCents: 5395, attempts: 6 },
      },
    ]);
    expect(line).toContain("01ORDER");
    expect(line).toContain("$53.95");
    expect(line).toContain("6 attempts");
    // Printful's raw message lives in `detail` for the admin screen, not here.
    expect(line).not.toContain("discontinued");
  });

  it("says nothing about catalog edits, a shipment, or an admin retry", async () => {
    // All three stay out for the reasons that keep `person.updated` out. The
    // catalog edit is an admin working in a screen they are already looking at;
    // the shipment is already emailed to the only person who cares; and the
    // retry is the expected response to a `fulfillment_failed` line the channel
    // has ALREADY seen — saying it twice would make the alert worth less.
    // Adding any of them is a decision to make after counting real volume
    // (invariant 22's "count first"), not before.
    expect(
      await lines([
        { action: "store.product.updated", entityId: "01P", detail: { op: "edited" } },
        { action: "store.order.shipped", entityId: "01ORDER", detail: { carrier: "USPS" } },
        { action: "store.order.retried", entityId: "01ORDER" },
      ]),
    ).toEqual([]);
  });
});

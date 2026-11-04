// Volunteer event reminders (migration 0041). Two evenings before an event
// with sign-ups, every address holding a spot on its sheet gets one email
// saying when and where to show up, with the shifts that family claimed.
//
// Fired from its own cron ("15 0 * * *" — see wrangler.toml [triggers]):
// 00:15 UTC is 6:15pm CST / 7:15pm CDT, so "the evening" holds across the DST
// change without any zone math in the schedule. The DUE test is school-local
// all the same — a sheet is due when its occurrence falls 1–2 school-local
// days ahead: 2 is the design ("two days before, in the evening"), 1 is the
// catch-up for a tick that failed or a sheet published after its 2-day evening
// had already passed. An event starting in under a day gets nothing; by then
// the reminder would arrive after the shift for anything in the morning.
//
// What keeps this once-and-only-once is the CAS on `reminder_sent_at`: a
// guarded UPDATE only one tick can win, the same idiom as the overfill guard
// and the store's status transitions. A wholly failed send releases its own
// claim so the next evening retries; a partial success keeps it, because the
// accepted messages are already in inboxes and re-sending to everyone is the
// worse failure. `moveStatements` (lib/volunteers.ts) clears the marker when a
// sheet moves to a new instant, so a re-dated event re-reminds for the date it
// now occupies.
//
// Privacy posture, in one line: the email names NOBODY and this module reads
// no `person` row at all. Addresses resolve through `firstEmailByPerson` — the
// same two rules as the admin's "Email volunteers" button (own `service` email
// items, else enabled controllers' account emails) — and the body carries
// position titles and shift windows, the exact content of the PUBLIC sheet
// (invariant 13), sent to the family that claimed them. No name, no note, no
// other volunteer. The audit row keeps counts, never addresses, and the Slack
// line (invariant 22) says only the public title and how many were reached.

import { formatClockRange, resolveTimeZone, volunteerShiftWindow } from "@sd/shared";
import type { Env } from "../env.js";
import { writeAudit, type AuditDraft, type AuditMeta } from "./audit.js";
import { notifySlackForAudit } from "./slackNotify.js";
import {
  sendEmailBatchResult,
  volunteerReminderEmail,
  BATCH_API_MAX,
  RESEND_PACE_MS,
  type SendArgs,
  type VolunteerReminderShift,
} from "./email.js";
import { firstEmailByPerson, occurrenceEndOf } from "./volunteers.js";
import { DAYS, nowIso } from "./time.js";

/** Not a person: the cron has no session, so the audit row has a null actor
 *  (like `auth.registered`) and the user agent says which machinery wrote it
 *  (like the email intake's "email-intake"). */
const CRON_META: AuditMeta = {
  actorUserId: null,
  masqueradingAs: null,
  ip: null,
  userAgent: "volunteer-reminder",
};

interface CandidateRow {
  id: string;
  slug: string;
  occurrence_start: string;
  runbook_url: string | null;
  title: string;
  location: string | null;
  event_starts_at: string;
  event_ends_at: string | null;
  all_day: number;
}

interface SignupRow {
  person_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** What one run did, for the cron log and the tests. `sheets` counts the ones
 *  a reminder actually went out for (or was recorded for, when nobody on a
 *  sheet was reachable); `recipients` the addresses accepted across them. */
export interface ReminderRun {
  considered: number;
  sheets: number;
  recipients: number;
}

/** YYYY-MM-DD of an instant in `timeZone` — en-CA formats exactly that way,
 *  the same trick `eventDateSegment` uses. */
function localDate(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Whole school-local days between now's date and the occurrence's date.
 *  All-day events are read in UTC — they are stored at UTC midnight
 *  (invariant 8's convention), and a western zone would slide them a day. */
function daysAhead(startIso: string, allDay: boolean, timeZone: string, now: Date): number {
  const eventDay = allDay ? startIso.slice(0, 10) : localDate(startIso, timeZone);
  const today = localDate(now, timeZone);
  return Math.round((Date.parse(eventDay) - Date.parse(today)) / DAYS);
}

/** "Thursday, November 5" in the school's zone (UTC for all-day — above). */
function whenLabel(startIso: string, allDay: boolean, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: allDay ? "UTC" : timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(startIso));
}

/** One shift as the email prints it: the position's title and its window on
 *  the school's wall clock ("" for an all-day commitment). ONE builder for the
 *  cron's real sends and the admin's test send, so a test proofs the same
 *  rendering the volunteers get. */
function reminderShift(
  event: { start: string; end: string | null; allDay: boolean },
  position: { title: string; starts_at: string | null; ends_at: string | null },
  timeZone: string,
): VolunteerReminderShift {
  const w = volunteerShiftWindow(event, { startsAt: position.starts_at, endsAt: position.ends_at });
  return {
    title: position.title,
    window: w.allDay ? "" : formatClockRange(w.start, w.end, "en-US", timeZone),
  };
}

/** The sheet's permanent public page, the link the email carries. `/v/:slug`
 *  rather than the event page: the slug is the one DURABLE handle on a sheet
 *  (invariant 13), so the link survives a retitle or a move. */
function sheetUrlOf(env: Env, slug: string): string | null {
  return env.CALENDAR_URL ? `${env.CALENDAR_URL.replace(/\/+$/, "")}/v/${slug}` : null;
}

/** Send the evening's due reminders. Never throws; one bad sheet is logged and
 *  the rest still go out, the `refreshAllSources` contract. */
export async function sendVolunteerReminders(env: Env, now = new Date()): Promise<ReminderRun> {
  const timeZone = resolveTimeZone(env.SCHOOL_TIMEZONE);
  const run: ReminderRun = { considered: 0, sheets: 0, recipients: 0 };

  // Candidates: published, not yet reminded, inside the window, with the
  // occurrence still on the calendar and at least one signup. The two EXISTS
  // are both deliberate exclusions: an orphaned sheet's date is one the series
  // no longer produces — reminding people to show up to it would be worse than
  // silence — and a sheet nobody signed is left UNCLAIMED rather than marked,
  // so a family claiming a spot tomorrow still gets the day-1 catch-up.
  // The 3-day ceiling just bounds the read; the precise due test is in code,
  // in school-local days, where SQL only has UTC text.
  const candidates = await env.DB.prepare(
    `SELECT s.id, s.slug, s.occurrence_start, s.runbook_url,
            e.title, e.location,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.all_day
       FROM volunteer_sheet s
       JOIN managed_event e ON e.id = s.managed_event_id
      WHERE s.published_at IS NOT NULL
        AND s.reminder_sent_at IS NULL
        AND s.occurrence_start > ?
        AND s.occurrence_start < ?
        AND EXISTS (SELECT 1 FROM calendar_event ce
                     WHERE ce.managed_event_id = s.managed_event_id
                       AND ce.starts_at = s.occurrence_start)
        AND EXISTS (SELECT 1 FROM volunteer_signup su
                      JOIN volunteer_position p ON p.id = su.position_id
                     WHERE p.sheet_id = s.id)
      ORDER BY s.occurrence_start ASC`,
  )
    .bind(now.toISOString(), new Date(now.getTime() + 3 * DAYS).toISOString())
    .all<CandidateRow>();

  for (const row of candidates.results) {
    run.considered++;
    try {
      const ahead = daysAhead(row.occurrence_start, row.all_day === 1, timeZone, now);
      if (ahead < 1 || ahead > 2) continue;
      const sent = await remindSheet(env, row, timeZone);
      if (sent !== null) {
        run.sheets++;
        run.recipients += sent;
      }
    } catch (err) {
      console.error(`[volunteer-reminder] sheet ${row.slug} failed:`, err);
    }
  }
  return run;
}

/** Remind one due sheet. Returns the number of addresses accepted, or null
 *  when nothing was recorded (claim lost, signups gone, or the whole send
 *  failed and the claim was released). */
async function remindSheet(env: Env, row: CandidateRow, timeZone: string): Promise<number | null> {
  // Claim BEFORE sending: between two overlapping ticks, exactly one may mail.
  // Losing the claim means the other tick is (or was) doing the work.
  const claimedAt = nowIso();
  const claim = await env.DB.prepare(
    "UPDATE volunteer_sheet SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL",
  )
    .bind(claimedAt, row.id)
    .run();
  if (!claim.meta || claim.meta.changes === 0) return null;

  // Everyone with a spot, in sheet order — the order a family reads the page
  // in. Re-read under the claim: the EXISTS that qualified the sheet ran
  // earlier, and every signup may have withdrawn since.
  const signups = await env.DB.prepare(
    `SELECT su.person_id, p.title, p.starts_at, p.ends_at
       FROM volunteer_signup su
       JOIN volunteer_position p ON p.id = su.position_id
      WHERE p.sheet_id = ?
      ORDER BY p.sort_order ASC, p.created_at ASC, su.created_at ASC`,
  )
    .bind(row.id)
    .all<SignupRow>();
  if (signups.results.length === 0) {
    // Nothing to remind after all. Release the claim rather than recording a
    // reminder that named nobody — a last-minute signup tomorrow still earns
    // the day-1 catch-up.
    await releaseClaim(env, row.id, claimedAt);
    return null;
  }

  const personIds = [...new Set(signups.results.map((s) => s.person_id))];
  const first = await firstEmailByPerson(env, personIds);

  const event = {
    start: row.occurrence_start,
    end: occurrenceEndOf(row.occurrence_start, row.event_starts_at, row.event_ends_at),
    allDay: row.all_day === 1,
  };
  const when = whenLabel(row.occurrence_start, event.allDay, timeZone);
  const sheetUrl = sheetUrlOf(env, row.slug);

  // One message per ADDRESS, carrying every shift that address stands behind —
  // a parent with two children on two positions reads one email, not two. A
  // repeated (title, window) pair collapses: the line says what and when, and
  // saying it twice says nothing more.
  const byAddress = new Map<string, { to: string; seen: Set<string>; shifts: VolunteerReminderShift[] }>();
  const unreachable = new Set<string>();
  for (const su of signups.results) {
    const email = first.get(su.person_id);
    if (!email) {
      unreachable.add(su.person_id);
      continue;
    }
    const key = email.toLowerCase();
    let entry = byAddress.get(key);
    if (!entry) {
      entry = { to: email, seen: new Set(), shifts: [] };
      byAddress.set(key, entry);
    }
    const shift = reminderShift(event, su, timeZone);
    const lineKey = `${shift.title}|${shift.window}`;
    if (entry.seen.has(lineKey)) continue;
    entry.seen.add(lineKey);
    entry.shifts.push(shift);
  }

  const msgs: SendArgs[] = [...byAddress.values()].map((entry) => ({
    ...volunteerReminderEmail(env, {
      eventTitle: row.title,
      when,
      location: row.location,
      shifts: entry.shifts,
      sheetUrl,
      runbookUrl: row.runbook_url,
    }),
    to: entry.to,
  }));

  let accepted = 0;
  for (let i = 0; i < msgs.length; i += BATCH_API_MAX) {
    const chunk = msgs.slice(i, i + BATCH_API_MAX);
    const res = await sendEmailBatchResult(env, chunk, RESEND_PACE_MS);
    // The Cloudflare channel reports per message; the Resend batch is
    // all-or-nothing and reports no `results`.
    accepted += res.results ? res.results.filter((r) => r.ok).length : res.ok ? chunk.length : 0;
  }

  if (msgs.length > 0 && accepted === 0) {
    // Nothing left the building. Release OUR claim (matched by value, so a
    // concurrent move's NULL or a later claim is never clobbered) and record
    // nothing — a refused send changed nothing, and tomorrow retries.
    console.error(`[volunteer-reminder] sheet ${row.slug}: all ${msgs.length} sends refused`);
    await releaseClaim(env, row.id, claimedAt);
    return null;
  }

  // The audit row is the record (invariant 5's spirit, from a cron: flushed
  // through the same `writeAudit` the middleware uses, like the email intake).
  // Counts only — never an address. `notify` is the hand-curated Slack bag
  // (invariant 22): the public title, the date, the slug, the count.
  const draft: AuditDraft = {
    action: "volunteer.reminder.sent",
    entityKind: "volunteer_sheet",
    entityId: row.id,
    detail: {
      slug: row.slug,
      eventTitle: row.title,
      start: row.occurrence_start,
      recipients: accepted,
      attempted: msgs.length,
      withoutEmail: unreachable.size,
    },
    notify: {
      eventTitle: row.title,
      slug: row.slug,
      start: row.occurrence_start,
      allDay: event.allDay,
      recipients: accepted,
    },
  };
  try {
    await writeAudit(env, draft, CRON_META);
  } catch (err) {
    console.error("[audit] failed to write volunteer.reminder.sent", err);
  }
  await notifySlackForAudit(env, [draft], CRON_META);
  return accepted;
}

/** Undo our own claim and only ours: matched by the value we wrote, so this
 *  can never null a claim some other writer has since taken. */
async function releaseClaim(env: Env, sheetId: string, claimedAt: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE volunteer_sheet SET reminder_sent_at = NULL WHERE id = ? AND reminder_sent_at = ?",
  )
    .bind(sheetId, claimedAt)
    .run();
}

// ── The admin's test send ────────────────────────────────────────────────────

/** The reminder as a volunteer holding EVERY position would receive it — what
 *  the admin's "Send test reminder" proofs (the route in
 *  routes/managedCalendar.ts picks the recipients and prefixes the subject).
 *
 *  Built from the sheet's POSITIONS rather than its signups, because the test
 *  is wanted BEFORE anyone has signed up — that is when the intro, the runbook
 *  link and the shift windows are being written. Rendering goes through the
 *  same `reminderShift` + `volunteerReminderEmail` the cron uses, so what the
 *  admin proofs is what the volunteers get; only the shift SELECTION differs,
 *  and selection is exactly what a per-family reminder varies anyway.
 *
 *  Deliberately no published/occurrence gates: a draft or orphaned sheet may be
 *  tested — the reader is an admin, not a volunteer. Returns null for no such
 *  sheet; `positionCount` lets the route refuse an empty sheet with a message
 *  instead of mailing a reminder with nothing in it. */
export async function buildTestReminder(
  env: Env,
  sheetId: string,
): Promise<{ msg: SendArgs; positionCount: number } | null> {
  const timeZone = resolveTimeZone(env.SCHOOL_TIMEZONE);
  const row = await env.DB.prepare(
    `SELECT s.id, s.slug, s.occurrence_start, s.runbook_url,
            e.title, e.location,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.all_day
       FROM volunteer_sheet s
       JOIN managed_event e ON e.id = s.managed_event_id
      WHERE s.id = ?`,
  )
    .bind(sheetId)
    .first<CandidateRow>();
  if (!row) return null;

  const positions = await env.DB.prepare(
    `SELECT title, starts_at, ends_at FROM volunteer_position
      WHERE sheet_id = ?
      ORDER BY sort_order ASC, created_at ASC`,
  )
    .bind(sheetId)
    .all<{ title: string; starts_at: string | null; ends_at: string | null }>();

  const event = {
    start: row.occurrence_start,
    end: occurrenceEndOf(row.occurrence_start, row.event_starts_at, row.event_ends_at),
    allDay: row.all_day === 1,
  };
  const msg = volunteerReminderEmail(env, {
    eventTitle: row.title,
    when: whenLabel(row.occurrence_start, event.allDay, timeZone),
    location: row.location,
    shifts: positions.results.map((p) => reminderShift(event, p, timeZone)),
    sheetUrl: sheetUrlOf(env, row.slug),
    runbookUrl: row.runbook_url,
  });
  return { msg, positionCount: positions.results.length };
}

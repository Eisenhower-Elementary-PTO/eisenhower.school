// Shared calendar: fetch public ICS feeds, expand recurrences, and store the
// upcoming window in D1. Reads serve from D1; this runs on a cron schedule
// (and on-demand via the admin "refresh" action). ical.js is pure JS and runs
// under nodejs_compat — we fetch the ICS text ourselves (per the geocode.ts
// pattern) and hand the string to the parser.

import ICAL from "ical.js";
import { eventTitleSlug, resolveTimeZone, shiftIsoDate } from "@sd/shared";
import type {
  CalendarEventDTO,
  CalendarEventKind,
  CalendarFeedDTO,
  PublicCalendarEventDTO,
  PublicCalendarFeedDTO,
} from "@sd/shared";
import type { Env } from "../env.js";
import { icsDate, renderCalendar, type IcsEventInput } from "./icsWriter.js";
import { ulid } from "./ids.js";
import { nowIso } from "./time.js";

/** How far back/forward to materialize events on each refresh. */
const PAST_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // keep 2 days of just-past events
const FUTURE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000; // 180 days ahead
/** Hard cap on iterations when expanding one recurring VEVENT. Bounds the
 *  catch-up cost for a rule that started far in the past (it counts every step,
 *  not just in-window ones) while still reaching the window for ~13y of dailies
 *  / ~96y of weeklies. */
const MAX_ITERATIONS = 5000;
/** Cap on stored events per source, to bound a pathological feed. */
const MAX_EVENTS_PER_SOURCE = 2000;
/** Domain half of a mirrored feed's UIDs. Matches managedCalendar.ts's: the
 *  ULID/start pair already makes the UID unique, the domain only makes it
 *  well-formed for calendar clients. */
const UID_DOMAIN = "eisenhower.school";
/** Insert chunk size — D1 batches are kept modest rather than one huge batch. */
const INSERT_CHUNK = 100;
/** Abort a feed fetch that hangs, so one bad source can't stall the refresh. */
const FETCH_TIMEOUT_MS = 15000;

export interface ParsedEvent {
  uid: string | null;
  title: string;
  location: string | null;
  description: string | null;
  /** The VEVENT's `URL` property, or null. Read for every feed but STORED only
   *  for a managed event (as `meeting_url`), whose writer put it there — see
   *  migration 0025 for why an imported feed's is dropped. */
  url: string | null;
  start: string; // ISO-8601 UTC
  end: string | null; // ISO-8601 UTC
  allDay: boolean;
}

/** The wall clock an unzoned feed time belongs to. Configured per instance,
 *  because it is a property of where the school IS, not of where this code runs. */
function schoolZone(env: Env): string {
  return resolveTimeZone(env.SCHOOL_TIMEZONE);
}

function userAgent(env: Env): string {
  return `${env.SCHOOL_NAME ?? "School"} School Directory (+https://github.com/Eisenhower-Elementary-PTO/eisenhower.school)`;
}

/** A school-feed event with no SUMMARY still gets a usable title. */
function titleOf(event: ICAL.Event): string {
  return (event.summary ?? "").trim() || "(untitled)";
}

/** The UTC instant of a wall-clock reading in a named IANA zone.
 *
 *  There is no built-in for this: `Intl` converts an instant INTO a zone, and we
 *  need the inverse. So take the reading as if it were UTC, ask what that
 *  instant looks like in the target zone, and subtract the difference. The
 *  second pass matters only at a DST boundary, where the offset that applies to
 *  the answer is not the offset that applied to the guess. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  // CLOCK-EXEMPT: this PARSES a wall clock out of `formatToParts` to derive a
  // zone offset — nobody reads it. `hourCycle: "h23"` is what makes the hour
  // an arithmetic value; the project-wide 12-hour rule would halve every
  // afternoon here and move half the calendar.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const f = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(f("year"), f("month") - 1, f("day"), f("hour"), f("minute"), f("second"));
  return asUtc - instantMs;
}

function wallClockToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  sec: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
  const first = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(first, timeZone);
  return second;
}

/** Is this time FLOATING — a wall-clock reading with no zone attached?
 *
 *  RFC 5545 calls `DTSTART:20260914T183000` (no trailing Z, no TZID) a floating
 *  time: 6:30pm on whatever clock is on the wall where the event happens. It is
 *  also what ical.js falls back to for a TZID whose VTIMEZONE was never
 *  registered — which is why `parseIcs` registers them before reading any date. */
function isFloating(t: ICAL.Time): boolean {
  return t.zone === ICAL.Timezone.localTimezone || t.zone?.tzid === "floating";
}

/** Normalize one ICAL.Time to an ISO-8601 UTC string.
 *
 *  All-day values (`VALUE=DATE`, no time and no timezone) are read from their
 *  calendar fields rather than via `toJSDate()`, which resolves a floating date
 *  in the *runtime's* local zone — that yields midnight UTC on Workers but shifts
 *  the timestamp by the host offset anywhere else, which can land the event on
 *  the wrong calendar day east of UTC.
 *
 *  A FLOATING timed value has the same problem and it is not theoretical: the
 *  district's feeds publish every timed event that way, with no VTIMEZONE
 *  anywhere in the file. `toJSDate()` resolves those against the RUNTIME's zone,
 *  and a Worker runs in UTC — so "6:30pm" was stored as 18:30Z and rendered to a
 *  Central reader as 1:30pm, a clean five-hour shift with the duration intact.
 *  `floatingZone` is the wall the clock is on: the school's own timezone.
 *
 *  A value that carries a real zone (a trailing Z, or a TZID whose VTIMEZONE was
 *  registered) is already an instant and converts directly. */
function isoOf(t: ICAL.Time, floatingZone: string): string {
  if (t.isDate) return new Date(Date.UTC(t.year, t.month - 1, t.day)).toISOString();
  if (isFloating(t)) {
    return new Date(
      wallClockToUtcMs(t.year, t.month, t.day, t.hour, t.minute, t.second, floatingZone),
    ).toISOString();
  }
  return t.toJSDate().toISOString();
}

/** Epoch ms for an ICAL.Time, normalized the same way as `isoOf` so window
 *  comparisons agree with what gets stored. */
function msOf(t: ICAL.Time, floatingZone: string): number {
  return new Date(isoOf(t, floatingZone)).getTime();
}

/** Parse ICS text into a flat list of events, expanding recurrences within
 *  [windowStart, windowEnd]. Times are normalized to UTC ISO strings.
 *
 *  `floatingZone` is REQUIRED rather than defaulted, so every call site has to
 *  state which wall clock an unzoned time belongs to. A default would be wrong
 *  half the time and silently: for a third-party feed the answer is the school's
 *  timezone, and for our own round-trip it is UTC, because `icsWriter` only ever
 *  emits Z-suffixed times. Getting it wrong shifts every timed event by the
 *  offset and nothing fails — see `isoOf`. */
export function parseIcs(
  text: string,
  windowStart: Date,
  windowEnd: Date,
  floatingZone: string,
): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const comp = new ICAL.Component(ICAL.parse(text));
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  // Register this feed's own VTIMEZONE definitions BEFORE any date is read.
  // ical.js resolves a TZID through a global registry, and an unregistered TZID
  // does not error — it silently degrades to floating, which is how a Google or
  // Outlook feed would land in the wrong zone with nothing to notice. The reset
  // keeps one feed's definition of a tzid from leaking into the next one parsed
  // in the same isolate.
  ICAL.TimezoneService.reset();
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vt);
    } catch {
      // A malformed VTIMEZONE falls back to floating, which `isoOf` then reads
      // in floatingZone — a better answer than failing the whole feed.
    }
  }

  for (const ve of comp.getAllSubcomponents("vevent")) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(ve);
    } catch {
      continue; // skip malformed components rather than fail the whole feed
    }
    if (!event.startDate) continue;

    const rawUrl = ve.getFirstPropertyValue("url");
    const url = (typeof rawUrl === "string" ? rawUrl : "").trim() || null;
    const push = (start: ICAL.Time, end: ICAL.Time | null) => {
      out.push({
        uid: event.uid ?? null,
        title: titleOf(event),
        location: (event.location ?? "").trim() || null,
        description: (event.description ?? "").trim() || null,
        url,
        start: isoOf(start, floatingZone),
        end: end ? isoOf(end, floatingZone) : null,
        allDay: start.isDate === true,
      });
    };

    if (event.isRecurring()) {
      const iter = event.iterator();
      let next: ICAL.Time | null;
      let iterations = 0;
      // Count every iteration (incl. pre-window catch-up) toward the cap, so a
      // long-past rule can't loop forever, but only STORE in-window occurrences.
      while ((next = iter.next()) && iterations < MAX_ITERATIONS) {
        iterations++;
        const occMs = msOf(next, floatingZone);
        if (occMs > endMs) break;
        if (occMs < startMs) continue; // already past the window's start
        try {
          const det = event.getOccurrenceDetails(next);
          push(det.startDate, det.endDate ?? null);
        } catch {
          // ignore a single bad occurrence
        }
      }
    } else {
      const occMs = msOf(event.startDate, floatingZone);
      if (occMs >= startMs && occMs < endMs) push(event.startDate, event.endDate ?? null);
    }
  }
  return out;
}

/** The school's rotation-day markers: an all-day `Day "1"` / `Day "2"` /
 *  `Day "3"` on nearly every school day of the Eisenhower feed, quotes and
 *  all. They say which specials rotation runs, which no family reads a
 *  calendar for, and at ~100 of them they buried every real event on the
 *  agenda. We can't change the feed, so they are dropped at INGEST — never
 *  stored, so no surface (agenda, public API, front door, newsletter blocks,
 *  the mirrored `/ics/source/:id.ics`) has to remember to hide them, and they
 *  don't count against `MAX_EVENTS_PER_SOURCE`. Anchored on both ends so a
 *  real event that merely mentions a day ("Picture Re-Take Day") survives.
 *  Imported feeds only: a managed event's title is one an admin typed. */
const ROTATION_DAY_TITLE = /^day\s*["“”']?\s*\d+\s*["“”']?$/i;

export function isRotationDayMarker(title: string): boolean {
  return ROTATION_DAY_TITLE.test(title.trim());
}

interface SourceRow {
  id: string;
  url: string;
}

/** Fetch one feed, parse it, and replace this source's stored events. Records
 *  status/error on the source. Never throws — failures are recorded. */
export async function refreshSource(env: Env, source: SourceRow): Promise<{ ok: boolean; count: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - PAST_WINDOW_MS);
  const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_MS);
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": userAgent(env), Accept: "text/calendar, text/plain, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseIcs(text, windowStart, windowEnd, schoolZone(env)).filter(
      (e) => !isRotationDayMarker(e.title),
    );
    // Keep the earliest N upcoming events; bounds storage for pathological feeds.
    parsed.sort((a, b) => a.start.localeCompare(b.start));
    const events = parsed.slice(0, MAX_EVENTS_PER_SOURCE);

    // Replace-in-place: clear this source's events, then insert the fresh set in
    // modest chunks (rather than one huge D1 batch), then mark the source ok.
    const inserts = events.map((e) =>
      env.DB.prepare(
        `INSERT INTO calendar_event (id, source_id, uid, title, location, description, starts_at, ends_at, all_day, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(ulid(), source.id, e.uid, e.title, e.location, e.description, e.start, e.end, e.allDay ? 1 : 0, nowIso()),
    );
    await env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(source.id).run();
    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      await env.DB.batch(inserts.slice(i, i + INSERT_CHUNK));
    }
    await env.DB.prepare("UPDATE calendar_source SET last_fetched_at = ?, last_status = 'ok', last_error = NULL WHERE id = ?")
      .bind(nowIso(), source.id)
      .run();
    return { ok: true, count: events.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar] refresh failed", source.id, msg);
    await env.DB.prepare("UPDATE calendar_source SET last_fetched_at = ?, last_status = 'error', last_error = ? WHERE id = ?")
      .bind(nowIso(), msg.slice(0, 300), source.id)
      .run()
      .catch(() => {});
    return { ok: false, count: 0 };
  }
}

/** A joined calendar_event row (event + its calendar) as read for serialization.
 *  Covers both origins: `source_id`/`source_name`/`source_color` are COALESCEd
 *  over the imported source and the managed calendar by the read query, so this
 *  shape is identical either way. */
export interface CalendarRow {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  meeting_url: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  /** The imported source id or the managed calendar id — the "feed id" the
   *  per-calendar show/hide filter keys on. */
  source_id: string;
  source_name: string;
  source_color: string;
  /** Set only for managed rows; identifies the durable authored event. */
  managed_event_id: string | null;
  /** Slug of the PUBLISHED volunteer sheet on this occurrence, or null. Joined
   *  on (managed_event_id, starts_at) — the durable pair, never the row id. */
  volunteer_slug: string | null;
}

/** Collapse the same event syndicated across multiple feeds into one. Events are
 *  matched on kind + title + day + time-to-the-minute (tolerating sub-minute
 *  timestamp differences between feeds); the merged event keeps the richest copy
 *  (longest description, any location) and records every calendar it appears on,
 *  so the per-calendar filter can hide it only when all of them are hidden.
 *
 *  The key includes the kind so an imported event never merges into a managed one
 *  that happens to share a title and start minute — merging across kinds would
 *  make the surviving row's `seriesId` arbitrary, and a later volunteer signup
 *  could resolve to the wrong event.
 *
 *  `rows` must be ordered by start; output preserves that order, capped to `limit`. */
export function dedupeEvents(rows: CalendarRow[], limit: number): CalendarEventDTO[] {
  interface Merged {
    dto: CalendarEventDTO;
    descLen: number;
  }
  const byKey = new Map<string, Merged>();
  const order: string[] = [];
  for (const r of rows) {
    const kind: CalendarEventKind = r.managed_event_id ? "managed" : "imported";
    // Match on kind + title + day + time to the minute (e.g. "2026-06-15T15:00").
    const key = `${kind}|${r.title.trim().toLowerCase()}|${r.starts_at.slice(0, 16)}`;
    let m = byKey.get(key);
    if (!m) {
      m = {
        dto: {
          id: r.id,
          kind,
          // A managed occurrence is addressed by (series, occurrence start) —
          // the ICS UID + RECURRENCE-ID pair — which survives re-materialization
          // even though `id` does not.
          ...(r.managed_event_id
            ? { seriesId: r.managed_event_id, recurrenceId: r.starts_at }
            : {}),
          title: r.title,
          location: r.location,
          description: r.description,
          meetingUrl: r.meeting_url,
          start: r.starts_at,
          end: r.ends_at,
          allDay: r.all_day === 1,
          sourceIds: [r.source_id],
          source: { name: r.source_name, color: r.source_color },
          volunteerSlug: r.volunteer_slug,
        },
        descLen: (r.description ?? "").length,
      };
      byKey.set(key, m);
      order.push(key);
      continue;
    }
    if (!m.dto.sourceIds.includes(r.source_id)) m.dto.sourceIds.push(r.source_id);
    if (!m.dto.location && r.location) m.dto.location = r.location;
    if (!m.dto.meetingUrl && r.meeting_url) m.dto.meetingUrl = r.meeting_url;
    // A merged duplicate can only be a second COPY of the same managed
    // occurrence (the key includes the kind), so it carries the same sheet —
    // but an imported row merged in first would have brought null. Keep the
    // first non-null so syndication order can't drop the volunteer link.
    if (!m.dto.volunteerSlug && r.volunteer_slug) m.dto.volunteerSlug = r.volunteer_slug;
    const dlen = (r.description ?? "").length;
    if (dlen > m.descLen) {
      m.dto.description = r.description;
      m.descLen = dlen;
    }
  }
  return order.slice(0, limit).map((k) => byKey.get(k)!.dto);
}

export interface UpcomingEventsQuery {
  /** ISO-8601. An event counts as in-window if it ends at/after this. */
  from: string;
  /** ISO-8601 upper bound on the start, or omitted for "no end". */
  to?: string;
  /** Restrict to these calendars — imported source ids and/or managed calendar
   *  ids, i.e. CalendarFeedDTO.id. Empty/omitted means every calendar. */
  calendarIds?: string[];
  limit: number;
}

/** Read upcoming events, optionally bounded above and restricted to a set of
 *  calendars. The route-level GET /calendar/events is a thin wrapper over this;
 *  the newsletter calls it directly at send time to freeze an events block,
 *  with no HTTP hop.
 *
 *  Filtering happens before de-duplication, so an event syndicated to both a
 *  selected and an unselected calendar still appears (it genuinely is on a
 *  selected calendar) but carries only the selected calendar in `sourceIds`. */
export async function queryUpcomingEvents(
  env: Env,
  q: UpcomingEventsQuery,
): Promise<CalendarEventDTO[]> {
  const limit = Math.min(Math.max(q.limit, 1), 500);
  // Over-fetch so de-duplicating across feeds still yields up to `limit`.
  const fetchCap = Math.min(limit * 5, 2000);

  const where: string[] = ["(e.ends_at >= ? OR e.ends_at IS NULL OR e.starts_at >= ?)"];
  const binds: unknown[] = [q.from, q.from];
  if (q.to) {
    where.push("e.starts_at < ?");
    binds.push(q.to);
  }
  const ids = (q.calendarIds ?? []).filter(Boolean);
  if (ids.length > 0) {
    const holes = ids.map(() => "?").join(",");
    where.push(`COALESCE(e.source_id, e.managed_calendar_id) IN (${holes})`);
    binds.push(...ids);
  }
  binds.push(fetchCap);

  // One query over both origins: a row's calendar is whichever of the two joins
  // matched, which the CHECK constraint in migration 0009 guarantees is exactly one.
  //
  // The volunteer join is on the DURABLE pair (managed_event_id, starts_at), not
  // on e.id, because e.id is re-minted on every refresh (invariant 8). Only a
  // published sheet joins — a draft must not put a link on anyone's calendar.
  const rows = await env.DB.prepare(
    `SELECT e.id, e.title, e.location, e.description, e.meeting_url, e.starts_at, e.ends_at, e.all_day,
            e.managed_event_id,
            COALESCE(e.source_id, e.managed_calendar_id) AS source_id,
            COALESCE(s.name, mc.name) AS source_name,
            COALESCE(s.color, mc.color) AS source_color,
            vs.slug AS volunteer_slug
     FROM calendar_event e
     LEFT JOIN calendar_source s ON s.id = e.source_id
     LEFT JOIN managed_calendar mc ON mc.id = e.managed_calendar_id
     LEFT JOIN volunteer_sheet vs
            ON vs.managed_event_id = e.managed_event_id
           AND vs.occurrence_start = e.starts_at
           AND vs.published_at IS NOT NULL
     WHERE ${where.join(" AND ")}
     ORDER BY e.starts_at ASC
     LIMIT ?`,
  )
    .bind(...binds)
    .all<CalendarRow>();

  return dedupeEvents(rows.results, limit);
}

/** Resolve one event from its page URL (`/e/:date/:slug`) — the lookup behind
 *  both the member and the anonymous event page, and behind the single-event
 *  ICS download.
 *
 *  There is no id to look up. See packages/shared/src/eventPath.ts for why an
 *  event is addressed by its CONTENT identity instead; this is the matching half
 *  of that round trip, and it is a SEARCH rather than a key lookup.
 *
 *  Two deliberate slacknesses, both because the caller minted the date in the
 *  READER'S timezone and this Worker has no way to know what that was:
 *
 *   - the window is `date - 1d … date + 2d`, so an evening event whose UTC date
 *     is the next day (or a morning one east of UTC) still resolves; and
 *   - among slug matches, the occurrence NEAREST that date's midday wins, which
 *     is what makes a weekly event resolve to the right week rather than to
 *     whichever copy the query happened to return first.
 *
 *  It returns the full CalendarEventDTO; narrowing for anonymous callers is
 *  `publicEventOf`'s job, exactly as it is for the agenda. */
export async function findEventByPath(
  env: Env,
  date: string,
  slug: string,
): Promise<CalendarEventDTO | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const events = await queryUpcomingEvents(env, {
    from: `${shiftIsoDate(date, -1)}T00:00:00.000Z`,
    to: `${shiftIsoDate(date, 2)}T00:00:00.000Z`,
    limit: 500,
  });
  const matches = events.filter((e) => eventTitleSlug(e.title) === slug);
  if (matches.length === 0) return null;

  const target = Date.parse(`${date}T12:00:00.000Z`);
  return matches.reduce((best, e) =>
    Math.abs(Date.parse(e.start) - target) < Math.abs(Date.parse(best.start) - target) ? e : best,
  );
}

/** Every calendar available to the show/hide filter, tagged with its origin so
 *  a caller can decide what a given audience may see about it. Admin-only
 *  status/error columns are excluded at the SELECT, so they can't reach either
 *  the member or the public route. Shared by both so the two can't drift in what
 *  "a calendar" means. */
async function calendarFeedRows(
  env: Env,
  origin: string,
): Promise<Array<CalendarFeedDTO & { kind: CalendarEventKind }>> {
  const [imported, managed] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, color, url FROM calendar_source WHERE enabled = 1 ORDER BY name COLLATE NOCASE",
    ).all<CalendarFeedDTO>(),
    env.DB.prepare(
      "SELECT id, name, color FROM managed_calendar ORDER BY name COLLATE NOCASE",
    ).all<{ id: string; name: string; color: string }>(),
  ]);

  return [
    ...imported.results.map((f) => ({ ...f, kind: "imported" as const })),
    ...managed.results.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      url: `${origin}/ics/${m.id}.ics`,
      kind: "managed" as const,
    })),
  ];
}

/** Members see every calendar's real subscribe URL. */
export async function listCalendarFeeds(env: Env, origin: string): Promise<CalendarFeedDTO[]> {
  const rows = await calendarFeedRows(env, origin);
  return rows.map((f) => ({ id: f.id, name: f.name, color: f.color, url: f.url }));
}

/** THE public/private seam for calendars, the companion to `publicEventOf`.
 *  Every calendar gets a subscribe URL, but an IMPORTED one is rewritten to our
 *  own mirror (`renderImportedSourceIcs`) rather than passed through: a pasted
 *  upstream URL is not ours to publish. See PublicCalendarFeedDTO.
 *
 *  The upstream URL must not survive into the return value — build each row
 *  field by field, never by spreading `f`, which carries it. */
export async function listPublicCalendarFeeds(
  env: Env,
  origin: string,
): Promise<PublicCalendarFeedDTO[]> {
  const rows = await calendarFeedRows(env, origin);
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    url: f.kind === "managed" ? f.url : `${origin}/ics/source/${f.id}.ics`,
  }));
}

/** A calendar_event row as read for mirroring. */
interface MirrorRow {
  uid: string | null;
  title: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
}

/** A stable, per-occurrence UID for a mirrored event.
 *
 *  The rows we mirror are already-expanded occurrences, so every occurrence of a
 *  recurring upstream event carries the SAME upstream UID (see migration 0006);
 *  emitting it verbatim would make a subscriber collapse the series into one
 *  event. Appending the occurrence start disambiguates them the way upstream's
 *  RECURRENCE-ID does. It must NOT be derived from `calendar_event.id`, which is
 *  re-minted on every refresh (CLAUDE.md invariant 8) — that would make every
 *  event look brand new to a subscriber each time the feed is refreshed. */
function mirrorUid(sourceId: string, r: MirrorRow): string {
  // Drop any upstream domain part so the result has exactly one `@`.
  const upstream = (r.uid ?? "").split("@")[0]!.trim();
  const base = upstream || `${sourceId}-${r.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `${base}-${icsDate(r.starts_at, r.all_day === 1)}@${UID_DOMAIN}`;
}

/** Render an imported calendar as a text/calendar document, or null if it is
 *  unknown or disabled.
 *
 *  This is a MIRROR of what we already store, not a proxy of the upstream feed.
 *  It re-serializes `calendar_event` rows, so a subscriber gets exactly what the
 *  agenda shows and nothing the upstream ICS carried but we chose never to keep
 *  (ORGANIZER/ATTENDEE addresses, alarms, attachments). That is the whole reason
 *  it exists: the public agenda can offer a download for EVERY calendar without
 *  publishing the admin-pasted upstream URL.
 *
 *  Two properties follow from mirroring rather than proxying, and both are
 *  intended: occurrences are already expanded here, so the document lists them
 *  flat instead of as an RRULE; and it covers only the materialized window
 *  (PAST_WINDOW_MS…FUTURE_WINDOW_MS), so a subscriber sees ~180 days out and
 *  re-polls for the rest rather than the full history upstream may hold. */
export async function renderImportedSourceIcs(env: Env, sourceId: string): Promise<string | null> {
  const source = await env.DB.prepare(
    "SELECT id, name, last_fetched_at FROM calendar_source WHERE id = ? AND enabled = 1",
  )
    .bind(sourceId)
    .first<{ id: string; name: string; last_fetched_at: string | null }>();
  if (!source) return null;

  const rows = await env.DB.prepare(
    `SELECT uid, title, location, description, starts_at, ends_at, all_day
     FROM calendar_event WHERE source_id = ? ORDER BY starts_at ASC`,
  )
    .bind(sourceId)
    .all<MirrorRow>();

  // One DTSTAMP for the whole document: the refresh is when this copy was last
  // known to be current, and it's the only "modified" signal a mirror has.
  const stamp = source.last_fetched_at ?? nowIso();
  const events: IcsEventInput[] = rows.results.map((r) => ({
    uid: mirrorUid(sourceId, r),
    title: r.title,
    location: r.location,
    description: r.description,
    url: null, // never stored for an imported row; see migration 0025
    start: r.starts_at,
    end: r.ends_at,
    allDay: r.all_day === 1,
    recurrence: null, // occurrences are already expanded in this table
    sequence: 0,
    updatedAt: stamp,
  }));
  return renderCalendar(source.name, events);
}

/** THE public/private seam for calendar events. Builds the anonymous-facing
 *  shape field by field — never by spreading `e` — so a field added to
 *  CalendarEventDTO stays out of the public response until someone edits this
 *  function on purpose. See PublicCalendarEventDTO for why `seriesId` and
 *  `recurrenceId` are withheld rather than merely unused.
 *
 *  `volunteerSlug` is the one field ever added here after the fact, and it was a
 *  deliberate act: it addresses the public volunteer page (counts, never names)
 *  and is NOT the durable pair, which is exactly why a sheet has a slug of its
 *  own. See PublicCalendarEventDTO and lib/volunteers.ts's `publicSheetOf`.
 *
 *  `meetingUrl` is the second, and it cleared the bar the way `location` does:
 *  it says where the event happens, an admin typed it onto an event anyone
 *  can read, and the sessionless .ics feed carries it as `URL` regardless. It
 *  is never derived from a Person or a User.
 *
 *  If you are here because you added a field to CalendarEventDTO: the default
 *  answer is to leave this function alone. */
export function publicEventOf(e: CalendarEventDTO): PublicCalendarEventDTO {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    location: e.location,
    description: e.description,
    meetingUrl: e.meetingUrl,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    sourceIds: e.sourceIds,
    source: e.source,
    volunteerSlug: e.volunteerSlug,
  };
}

/** Refresh every enabled source. Used by the cron handler and the admin button. */
export async function refreshAllSources(env: Env): Promise<{ sources: number; events: number }> {
  const rows = await env.DB.prepare("SELECT id, url FROM calendar_source WHERE enabled = 1").all<SourceRow>();
  let events = 0;
  // Sequentially, to stay gentle on the feed hosts (single school, few feeds).
  for (const s of rows.results) {
    const r = await refreshSource(env, s);
    events += r.count;
  }
  return { sources: rows.results.length, events };
}

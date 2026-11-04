// Volunteer signups: sheets of positions hung off one occurrence of an authored
// event, which members claim spots on as one of the Persons they control.
//
// Identity, first, because everything else follows from it: a sheet names its
// occurrence by (managed_event_id, occurrence_start) — the ICS UID +
// RECURRENCE-ID pair migration 0009 reserved — and NEVER by calendar_event.id,
// which is re-minted on every refresh (CLAUDE.md invariant 8). Reading a sheet
// therefore joins `managed_event` for the title/location/duration and takes the
// occurrence's instant from the sheet's own column. The derived cache is
// consulted for exactly one thing: telling an admin that the date they opened a
// sheet on no longer exists, because the series was edited afterwards.
//
// `publicSheetOf` at the bottom is THE public/private seam, the companion to
// lib/calendar.ts's `publicEventOf`. Anonymous readers get positions and filled
// counts; who filled them is member-only (invariant 1). Build the public shape
// field by field — never by spreading — so a field added to the member DTO
// cannot reach an anonymous response by itself.

import type {
  LastNameDisplay,
  ManagedOccurrenceDTO,
  PublicVolunteerSheetDTO,
  VolunteerEmailsDTO,
  VolunteerPositionDTO,
  VolunteerPositionInput,
  VolunteerSheetDTO,
  VolunteerSheetInput,
  VolunteerSignupDTO,
} from "@sd/shared";
import {
  dictionaries,
  eventPath,
  resolveTimeZone,
  volunteerEntryDetails,
  volunteerEntryTitle,
  volunteerSheetSlug,
  volunteerShiftWindow,
  type Locale,
} from "@sd/shared";
import type { Env } from "../env.js";
import { displayName, isPersonListable } from "./privacy.js";
import { ulid } from "./ids.js";
import { renderCalendar } from "./icsWriter.js";
import { nowIso } from "./time.js";

/** Cap on positions per sheet. A signup sheet with 100 jobs on it is a spread-
 *  sheet, not a sign-up sheet; this also bounds the read query. */
const MAX_POSITIONS = 60;
/** Cap on people needed for one position. */
const MAX_SLOTS = 200;
const MAX_TITLE = 120;
const MAX_TEXT = 2000;
const MAX_NOTE = 500;

/** Invalid authored input. Routes translate this into a 400 carrying the
 *  message, exactly as ManagedEventError does. */
export class VolunteerError extends Error {}

/** Why a claim was refused. The route maps these to a status; the client shows
 *  a specific message rather than a generic failure. */
export type ClaimFailure = "full" | "duplicate" | "closed" | "not_found";

// ── Row shapes ──────────────────────────────────────────────────────────────

interface SheetRow {
  id: string;
  managed_event_id: string;
  occurrence_start: string;
  slug: string;
  intro: string | null;
  runbook_url: string | null;
  published_at: string | null;
  closes_at: string | null;
  created_at: string;
  /** Joined from managed_event — the durable description of the series. */
  title: string;
  location: string | null;
  description: string | null;
  event_starts_at: string;
  event_ends_at: string | null;
  all_day: number;
}

interface PositionRow {
  id: string;
  sheet_id: string;
  title: string;
  description: string | null;
  slots: number;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
}

interface SignupRow {
  id: string;
  position_id: string;
  person_id: string;
  note: string | null;
  created_at: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: LastNameDisplay;
  /** Read so the NAME can be withheld while the row still counts — see
   *  `positionsOf`. */
  unlisted_at: string | null;
}

/** Who is reading. `controlledPersonIds` drives both `isYou` and the last-name
 *  rule, so it is resolved once per request rather than per signup. */
export interface Viewer {
  userId: string;
  isSystemAdmin: boolean;
  controlledPersonIds: Set<string>;
  /** May they read other families at all (migration 0029)? A sheet's COUNTS
   *  are public (invariant 13); its NAMES are for approved members, so a
   *  pending one reads this route as an anonymous visitor does — plus their
   *  own household's claims, which `isPersonListable` keeps. */
  isApproved?: boolean;
}

/** The Persons this User controls. One query, reused for every name on a sheet. */
export async function viewerOf(
  env: Env,
  userId: string,
  isSystemAdmin: boolean,
  isApproved = true,
): Promise<Viewer> {
  const rows = await env.DB.prepare("SELECT person_id FROM control WHERE user_id = ?")
    .bind(userId)
    .all<{ person_id: string }>();
  return {
    userId,
    isSystemAdmin,
    isApproved,
    controlledPersonIds: new Set(rows.results.map((r) => r.person_id)),
  };
}

// ── Input coercion ──────────────────────────────────────────────────────────

function trimmed(value: unknown, max: number, field: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new VolunteerError(`${field} is required.`);
  if (s.length > max) throw new VolunteerError(`${field} is too long (max ${max} characters).`);
  return s;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Validate an optional ISO-8601 instant. Stored strings are compared as text
 *  everywhere else in this codebase, so a malformed one would silently sort
 *  wrong rather than throw — reject it here instead. */
function optionalInstant(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new VolunteerError(`${field} is not a valid date.`);
  return d.toISOString();
}

/** Longest runbook link the editor accepts — a Google Docs URL runs well under
 *  this; anything past it is a pasted mistake, not a document. */
const MAX_RUNBOOK_URL = 2048;

/** An external runbook link, or null for none — the volunteer-side twin of
 *  managedCalendar.ts's `normalizeMeetingUrl`, closed the same way for the same
 *  reason: the value is rendered as an anchor (on the event page, for signed-in
 *  members), so only http(s) may pass — a `javascript:` or `data:` link is a
 *  script, not a document. Parsed with `new URL()` so what is stored is a
 *  canonical, well-formed address. */
function normalizeRunbookUrl(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_RUNBOOK_URL) {
    throw new VolunteerError("Runbook link is too long.");
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new VolunteerError("Runbook link must be a full web address, starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new VolunteerError("Runbook link must start with https:// or http://.");
  }
  return url.href;
}

function coerceSlots(value: unknown): number {
  if (value === undefined || value === null) return 1;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) throw new VolunteerError("Number of people must be at least 1.");
  if (n > MAX_SLOTS) throw new VolunteerError(`Number of people must be ${MAX_SLOTS} or fewer.`);
  return n;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/** Append -2, -3, … until the slug is free, mirroring newsletter's `uniqueSlug`.
 *  Two occurrences of a weekly event in the same week is ordinary. */
export async function uniqueVolunteerSlug(env: Env, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const row = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE slug = ?")
      .bind(candidate)
      .first<{ id: string }>();
    if (!row) return candidate;
  }
  return `${base}-${ulid().toLowerCase().slice(-6)}`;
}

// ── Reads ───────────────────────────────────────────────────────────────────

const SHEET_SELECT = `
  SELECT s.id, s.managed_event_id, s.occurrence_start, s.slug, s.intro,
         s.runbook_url, s.published_at, s.closes_at, s.created_at,
         e.title, e.location, e.description,
         e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.all_day
    FROM volunteer_sheet s
    JOIN managed_event e ON e.id = s.managed_event_id`;

async function sheetRowBy(env: Env, column: "slug" | "id", value: string): Promise<SheetRow | null> {
  return await env.DB.prepare(`${SHEET_SELECT} WHERE s.${column} = ?`)
    .bind(value)
    .first<SheetRow>();
}

/** This occurrence's end, derived from the SERIES duration rather than stored.
 *  Every occurrence of a rule has the same length, so duration is the durable
 *  fact and the end is arithmetic on the occurrence's own start. Reading it off
 *  a `calendar_event` row would tie the sheet to the disposable cache.
 *  Exported for lib/volunteerReminders.ts, which reads the same three columns
 *  outside SheetRow — one piece of arithmetic, not two. */
export function occurrenceEndOf(
  occurrenceStart: string,
  eventStartsAt: string,
  eventEndsAt: string | null,
): string | null {
  if (!eventEndsAt) return null;
  const durationMs = new Date(eventEndsAt).getTime() - new Date(eventStartsAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return new Date(new Date(occurrenceStart).getTime() + durationMs).toISOString();
}

function occurrenceEnd(row: SheetRow): string | null {
  return occurrenceEndOf(row.occurrence_start, row.event_starts_at, row.event_ends_at);
}

function isClosed(row: SheetRow, now: string): boolean {
  return !!row.closes_at && row.closes_at <= now;
}

/** Positions + signups for a set of sheets, in one round trip each. */
async function positionsOf(
  env: Env,
  sheetId: string,
  viewer: Viewer | null,
): Promise<VolunteerPositionDTO[]> {
  const positions = await env.DB.prepare(
    `SELECT id, sheet_id, title, description, slots, starts_at, ends_at, sort_order
       FROM volunteer_position WHERE sheet_id = ?
      ORDER BY sort_order ASC, created_at ASC
      LIMIT ?`,
  )
    .bind(sheetId, MAX_POSITIONS)
    .all<PositionRow>();
  if (positions.results.length === 0) return [];

  const holes = positions.results.map(() => "?").join(",");
  // UNLISTED-EXEMPT: filtered in memory below, not here, and deliberately. A
  // position's `filled` must still count an unlisted signer on the very response
  // that hides their name — dropping the row in SQL would report a spot as open
  // that somebody is standing in. See isPersonListable.
  const signups = await env.DB.prepare(
    `SELECT su.id, su.position_id, su.person_id, su.note, su.created_at,
            p.first_name, p.last_name, p.last_name_visibility, p.unlisted_at
       FROM volunteer_signup su
       JOIN person p ON p.id = su.person_id
      WHERE su.position_id IN (${holes})
      ORDER BY su.created_at ASC`,
  )
    .bind(...positions.results.map((p) => p.id))
    .all<SignupRow>();

  const byPosition = new Map<string, SignupRow[]>();
  for (const s of signups.results) {
    const list = byPosition.get(s.position_id);
    if (list) list.push(s);
    else byPosition.set(s.position_id, [s]);
  }

  return positions.results.map((p) => {
    const rows = byPosition.get(p.id) ?? [];
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      slots: p.slots,
      // Counted over the UNFILTERED rows: an unlisted volunteer still holds the
      // spot, and a count that shrank with the name would advertise a shift as
      // needing help when it doesn't (invariant 13).
      filled: rows.length,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      // `viewer` is null only when the caller is building the public projection,
      // where these are dropped anyway. Emitting an empty list rather than
      // reading names we're about to discard keeps the anonymous path from ever
      // holding a member's name in memory.
      signups: viewer
        ? rows
            .filter((r) => isPersonListable(r.person_id, r.unlisted_at, viewer))
            .map((r) => signupDto(r, viewer))
        : [],
    };
  });
}

function signupDto(row: SignupRow, viewer: Viewer): VolunteerSignupDTO {
  const isYou = viewer.controlledPersonIds.has(row.person_id);
  return {
    id: row.id,
    personId: row.person_id,
    displayName: displayName(row.first_name, row.last_name, row.last_name_visibility, isYou),
    note: row.note,
    isYou,
    createdAt: row.created_at,
  };
}

async function sheetDto(env: Env, row: SheetRow, viewer: Viewer | null): Promise<VolunteerSheetDTO> {
  const now = nowIso();
  return {
    id: row.id,
    slug: row.slug,
    intro: row.intro,
    runbookUrl: row.runbook_url,
    closesAt: row.closes_at,
    closed: isClosed(row, now),
    published: !!row.published_at,
    event: {
      seriesId: row.managed_event_id,
      recurrenceId: row.occurrence_start,
      title: row.title,
      location: row.location,
      description: row.description,
      start: row.occurrence_start,
      end: occurrenceEnd(row),
      allDay: row.all_day === 1,
    },
    positions: await positionsOf(env, row.id, viewer),
    canManage: !!viewer?.isSystemAdmin,
  };
}

/** A sheet as a signed-in member sees it, or null if there is no such slug. */
export async function loadSheetForMember(
  env: Env,
  slug: string,
  viewer: Viewer,
): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "slug", slug);
  if (!row) return null;
  // A draft is admin-only: it is not on the calendar and has no public page, so
  // an ordinary member reaching it would be reading something not yet announced.
  if (!row.published_at && !viewer.isSystemAdmin) return null;
  return await sheetDto(env, row, viewer);
}

/** A sheet by its id, for the admin screens. Includes the orphan check. */
export async function loadSheetForAdmin(env: Env, id: string): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "id", id);
  if (!row) return null;
  const dto = await sheetDto(env, row, {
    userId: "",
    isSystemAdmin: true,
    controlledPersonIds: new Set(),
  });
  dto.orphaned = !(await occurrenceExists(env, row.managed_event_id, row.occurrence_start));
  return dto;
}

/** Does the materialized agenda still contain this occurrence? Only ever used to
 *  WARN. A sheet whose date was edited away keeps its signups; it just isn't on
 *  anyone's calendar until the admin fixes the series or moves the sheet. */
async function occurrenceExists(env: Env, seriesId: string, start: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM calendar_event WHERE managed_event_id = ? AND starts_at = ? LIMIT 1",
  )
    .bind(seriesId, start)
    .first<{ ok: number }>();
  return !!row;
}

/** A published sheet as an ANONYMOUS caller sees it, or null. Draft sheets 404
 *  here — guessing tomorrow's slug reveals nothing, matching the newsletter
 *  archive's posture. */
export async function loadPublicSheet(
  env: Env,
  slug: string,
): Promise<PublicVolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "slug", slug);
  if (!row || !row.published_at) return null;
  return publicSheetOf(await sheetDto(env, row, null));
}

/** Every occurrence of one authored event, with the sheet already open on it —
 *  the admin's "which date?" picker. Read from the materialized agenda, so it
 *  offers exactly the dates a member can currently see. */
export async function listOccurrences(
  env: Env,
  managedEventId: string,
): Promise<ManagedOccurrenceDTO[]> {
  const [events, sheets] = await Promise.all([
    env.DB.prepare(
      `SELECT starts_at, ends_at, all_day FROM calendar_event
        WHERE managed_event_id = ? ORDER BY starts_at ASC`,
    )
      .bind(managedEventId)
      .all<{ starts_at: string; ends_at: string | null; all_day: number }>(),
    env.DB.prepare(
      `SELECT s.id, s.slug, s.occurrence_start, s.published_at,
              (SELECT COUNT(*) FROM volunteer_position WHERE sheet_id = s.id) AS position_count
         FROM volunteer_sheet s WHERE s.managed_event_id = ?`,
    )
      .bind(managedEventId)
      .all<{
        id: string;
        slug: string;
        occurrence_start: string;
        published_at: string | null;
        position_count: number;
      }>(),
  ]);

  const bySheetStart = new Map(sheets.results.map((s) => [s.occurrence_start, s]));
  const out: ManagedOccurrenceDTO[] = events.results.map((e) => {
    const sheet = bySheetStart.get(e.starts_at);
    bySheetStart.delete(e.starts_at);
    return {
      start: e.starts_at,
      end: e.ends_at,
      allDay: e.all_day === 1,
      sheet: sheet
        ? {
            id: sheet.id,
            slug: sheet.slug,
            published: !!sheet.published_at,
            positionCount: sheet.position_count,
          }
        : null,
    };
  });

  // Whatever is left over is orphaned — a sheet on a date the series no longer
  // produces. Surface it rather than hiding it, so its signups are reachable.
  for (const s of bySheetStart.values()) {
    out.push({
      start: s.occurrence_start,
      end: null,
      allDay: false,
      sheet: {
        id: s.id,
        slug: s.slug,
        published: !!s.published_at,
        positionCount: s.position_count,
      },
    });
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

// ── Reaching the volunteers (admin) ─────────────────────────────────────────
//
// One address per person who took a spot, for the admin's "Email volunteers"
// button. Two rules decide which address, and both are chosen so that this
// route discloses nothing a system admin cannot already read:
//
//   1. The Person's OWN email contact items, but only `visibility = 'service'`
//      — the ones already visible to any signed-in member (lib/privacy.ts's
//      `canSeeItem`). A `private` item is deliberately NOT read: `canSeeItem`
//      grants a system admin no exemption from it, and this route is not the
//      place to invent one.
//   2. Failing that, the account emails of the Users who CONTROL them, which is
//      how a child is reached at all — a nine-year-old on the snack table has no
//      address of their own, and their parent's is the one that matters. Those
//      are already listed to an admin at `GET /admin/users`, and are the same
//      addresses the newsletter sends to.
//
// "The first" is therefore an ordering, not a guess: own items by `sort_order`,
// then controllers by how long they have held control. A disabled User is
// skipped, matching the newsletter audience — mail to an account that can no
// longer sign in is mail to nobody.
//
// Nothing here reads `person`, and that is not an accident of spelling: the
// question is "how do I reach the people already named on this sheet", which
// `loadSheetForAdmin` has answered, not "who exists" — so invariant 21's gate
// has nothing to decide and this spends none of its exemption budget.

interface EmailRow {
  person_id: string;
  email: string;
}

/** First reachable address for each of `personIds`, by the two rules above:
 *  the Person's own `service` email items first (by `sort_order`), then the
 *  account emails of enabled controlling Users (by how long they have held
 *  control). Extracted from `sheetVolunteerEmails` so the reminder cron
 *  (lib/volunteerReminders.ts) resolves addresses by EXACTLY the rules the
 *  admin's "Email volunteers" button does — a second copy of the two WHERE
 *  clauses is how the two would come to disagree about what `private`
 *  withholds (test/volunteerEmails.test.ts evaluates both). */
export async function firstEmailByPerson(
  env: Env,
  personIds: string[],
): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const holes = personIds.map(() => "?").join(",");
  const [own, controllers] = await Promise.all([
    env.DB.prepare(
      `SELECT owner_id AS person_id, value AS email
         FROM contact_item
        WHERE owner_kind = 'person' AND type = 'email' AND visibility = 'service'
          AND owner_id IN (${holes})
        ORDER BY sort_order ASC, created_at ASC`,
    )
      .bind(...personIds)
      .all<EmailRow>(),
    env.DB.prepare(
      `SELECT c.person_id, u.email
         FROM control c
         JOIN user u ON u.id = c.user_id
        WHERE c.person_id IN (${holes}) AND u.disabled_at IS NULL
        ORDER BY c.since ASC, u.id ASC`,
    )
      .bind(...personIds)
      .all<EmailRow>(),
  ]);

  // Own items are concatenated FIRST, so first-seen-per-person is the precedence
  // rule above rather than whichever query happened to return a row.
  const first = new Map<string, string>();
  for (const r of [...own.results, ...controllers.results]) {
    const email = r.email.trim();
    if (email && !first.has(r.person_id)) first.set(r.person_id, email);
  }
  return first;
}

/** The addresses behind one sheet's signups, or null if there is no such sheet.
 *
 *  The signup read needs no LIMIT: a sheet holds at most MAX_POSITIONS
 *  positions of at most MAX_SLOTS people, and `claimSpot`'s guarded insert is
 *  what makes the second half true. */
export async function sheetVolunteerEmails(
  env: Env,
  sheetId: string,
): Promise<VolunteerEmailsDTO | null> {
  const sheet = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE id = ?")
    .bind(sheetId)
    .first<{ id: string }>();
  if (!sheet) return null;

  const signups = await env.DB.prepare(
    `SELECT su.person_id
       FROM volunteer_signup su
       JOIN volunteer_position p ON p.id = su.position_id
      WHERE p.sheet_id = ?
      ORDER BY p.sort_order ASC, p.created_at ASC, su.created_at ASC`,
  )
    .bind(sheetId)
    .all<{ person_id: string }>();

  // Sheet order, first appearance wins — the same order the admin is reading
  // the positions in, so a list they paste somewhere is not arbitrary.
  const personIds: string[] = [];
  for (const r of signups.results) {
    if (!personIds.includes(r.person_id)) personIds.push(r.person_id);
  }
  if (personIds.length === 0) return { emails: [], withoutEmail: 0 };

  const first = await firstEmailByPerson(env, personIds);

  const emails: string[] = [];
  const seen = new Set<string>();
  let withoutEmail = 0;
  for (const id of personIds) {
    const email = first.get(id);
    if (!email) {
      withoutEmail++;
      continue;
    }
    // Two children of one parent are one address, not two — a Bcc line that
    // repeats it mails them twice.
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return { emails, withoutEmail };
}

// ── Sheet writes (admin) ────────────────────────────────────────────────────

export async function createSheet(
  env: Env,
  managedEventId: string,
  body: VolunteerSheetInput,
  userId: string,
): Promise<VolunteerSheetDTO | null> {
  const event = await env.DB.prepare("SELECT id, title FROM managed_event WHERE id = ?")
    .bind(managedEventId)
    .first<{ id: string; title: string }>();
  if (!event) return null;

  const occurrenceStart = optionalInstant(body.occurrenceStart, "Date");
  if (!occurrenceStart) throw new VolunteerError("Pick which date to open signups for.");

  const existing = await env.DB.prepare(
    "SELECT id FROM volunteer_sheet WHERE managed_event_id = ? AND occurrence_start = ?",
  )
    .bind(managedEventId, occurrenceStart)
    .first<{ id: string }>();
  if (existing) throw new VolunteerError("This date already has a volunteer sheet.");

  const now = nowIso();
  const id = ulid();
  const slug = await uniqueVolunteerSlug(env, volunteerSheetSlug(event.title, occurrenceStart));

  await env.DB.prepare(
    `INSERT INTO volunteer_sheet
       (id, managed_event_id, occurrence_start, slug, intro, runbook_url, published_at,
        closes_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      managedEventId,
      occurrenceStart,
      slug,
      optionalText(body.intro, MAX_TEXT),
      normalizeRunbookUrl(body.runbookUrl),
      // Sheets start as drafts: positions have to exist before a link is worth
      // sharing, and publishing is what puts it on the public calendar.
      body.published ? now : null,
      optionalInstant(body.closesAt, "Closing date"),
      userId,
      now,
      now,
    )
    .run();

  return await loadSheetForAdmin(env, id);
}

export async function updateSheet(
  env: Env,
  id: string,
  body: VolunteerSheetInput,
): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "id", id);
  if (!row) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.intro !== undefined) {
    sets.push("intro = ?");
    binds.push(optionalText(body.intro, MAX_TEXT));
  }
  if (body.runbookUrl !== undefined) {
    sets.push("runbook_url = ?");
    binds.push(normalizeRunbookUrl(body.runbookUrl));
  }
  if (body.closesAt !== undefined) {
    sets.push("closes_at = ?");
    binds.push(optionalInstant(body.closesAt, "Closing date"));
  }
  if (body.published !== undefined) {
    sets.push("published_at = ?");
    // Unpublishing keeps the sheet and its signups; it only withdraws the public
    // page and the calendar's link to it.
    binds.push(body.published ? (row.published_at ?? nowIso()) : null);
  }
  // `occurrenceStart` is deliberately not updatable — see VolunteerSheetInput.
  if (sets.length === 0) throw new VolunteerError("Nothing to update.");

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE volunteer_sheet SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return await loadSheetForAdmin(env, id);
}

/** The three statements that remove every sheet matching `sheetWhere` — signups,
 *  then positions, then the sheets themselves. Returned rather than run so a
 *  caller can put them at the FRONT of its own `env.DB.batch`, which is the
 *  whole reason this is exported: `volunteer_sheet.managed_event_id` references
 *  `managed_event(id)`, so deleting an event without taking its sheets first
 *  either trips the foreign key or leaves rows that nothing can ever reach
 *  again — `sheetRow` joins `managed_event`, so an orphan is invisible to every
 *  read while its signups sit in the table forever.
 *
 *  `sheetWhere` is a predicate over `volunteer_sheet` written by a caller in
 *  this repo, never from a request; values still go through `binds`. Each
 *  statement nests it exactly once, so every one takes the same binds. */
export function sheetCascade(env: Env, sheetWhere: string, binds: unknown[]): D1PreparedStatement[] {
  const sheets = `SELECT id FROM volunteer_sheet WHERE ${sheetWhere}`;
  return [
    env.DB.prepare(
      `DELETE FROM volunteer_signup WHERE position_id IN
         (SELECT id FROM volunteer_position WHERE sheet_id IN (${sheets}))`,
    ).bind(...binds),
    env.DB.prepare(`DELETE FROM volunteer_position WHERE sheet_id IN (${sheets})`).bind(...binds),
    env.DB.prepare(`DELETE FROM volunteer_sheet WHERE ${sheetWhere}`).bind(...binds),
  ];
}

/** How much volunteer work is hanging off the sheets `sheetWhere` selects,
 *  counted BEFORE they are deleted. An admin is told this at the confirmation
 *  step and the audit row keeps it afterwards: once the rows are gone, the
 *  number of people who had claimed a spot is not recoverable from anywhere. */
export async function volunteerFootprint(
  env: Env,
  sheetWhere: string,
  binds: unknown[],
): Promise<{ sheets: number; signups: number }> {
  const sheets = `SELECT id FROM volunteer_sheet WHERE ${sheetWhere}`;
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM volunteer_sheet WHERE ${sheetWhere}) AS sheets,
            (SELECT COUNT(*) FROM volunteer_signup WHERE position_id IN
               (SELECT id FROM volunteer_position WHERE sheet_id IN (${sheets}))) AS signups`,
  )
    .bind(...binds, ...binds)
    .first<{ sheets: number; signups: number }>();
  return { sheets: row?.sheets ?? 0, signups: row?.signups ?? 0 };
}

/** Delete a sheet and everything hanging off it. Explicit child deletes rather
 *  than ON DELETE CASCADE, matching how deleteManagedEvent does it. */
export async function deleteSheet(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!row) return false;
  await env.DB.batch(sheetCascade(env, "id = ?", [id]));
  return true;
}

// ── Following the event (admin, by consequence) ─────────────────────────────
//
// A sheet names its occurrence by INSTANT — `(managed_event_id,
// occurrence_start)`, the durable pair — and an admin who moves an event
// changes exactly that instant. Nothing linked the two, so until this existed a
// re-dated event left its sheet behind: the new date carried no sign-up link
// (`publicEventOf`'s join is `vs.occurrence_start = e.starts_at`), and everyone
// who had already claimed a spot stayed claimed on a date the calendar no
// longer produced. The admin screen could only report it — "move them to a
// current date or delete the sheet" — over an app that offered no way to move
// them.
//
// So the move is a CONSEQUENCE of the event edit, not an act of its own. That
// is also the answer to the objection `VolunteerSheetInput.occurrenceStart`
// raises against letting an admin re-date a sheet by hand ("would silently
// relocate everyone who already signed up"): relocating everyone is the correct
// outcome here, because the thing they signed up for is what moved. It is not
// silent either — the route reports how many came along and the audit row keeps
// the dates, which is the only place the old one survives.
//
// Three rules decide where a sheet lands, and the order matters:
//
//  1. **A sheet already on a surviving date never moves.** Extending a series'
//     UNTIL, or editing its title, leaves most dates untouched; a sheet sitting
//     on one of them is already where it belongs.
//  2. **Otherwise it keeps its ORDINAL.** Both lists are ascending, so the n-th
//     date the event used to produce becomes the n-th it produces now. That is
//     what carries a whole series forward an hour or a week — the edit an admin
//     actually makes — and it needs no history: `expandEvent` has just rendered
//     the new list and `calendar_event` still holds the old one.
//  3. **A one-date event is unambiguous**, so a sheet whose instant is in
//     NEITHER list still lands on it: there is nowhere else for it to be. This
//     is the clause that heals a sheet orphaned by an edit made before any of
//     this existed, on the next save of its event.
//
// A sheet is never moved onto a date another sheet already holds — `UNIQUE
// (managed_event_id, occurrence_start)` would reject the whole batch, and the
// sheet that is already right is not the one to disturb. Whatever can't be
// placed stays put and keeps reporting itself as `orphaned`, which is still the
// honest answer for a series that genuinely lost a date.
//
// Everything dated off the old instant moves by the same delta: `closes_at` and
// each position's shift window. Those are offsets from the event ("the 7:30
// shift", "sign-ups close the night before"), and adding one delta to all of
// them is what preserves an offset across a move.
//
// Note which clock that holds, because it is the opposite of the intuitive
// answer: `expandEvent` renders Z-suffixed values and parses them back in UTC
// (invariant 11), so a series keeps its absolute INSTANT and its local wall
// clock is what shifts across a daylight-saving boundary — a 7:30am CDT weekly
// event reads 6:30am once CST arrives. That is a property of the recurrence
// engine, not of this function, and it is why the delta is the right tool
// either way: it preserves the offset in the same clock the occurrences
// themselves are kept in.

/** One sheet carried from an old occurrence to a new one. `signups` is how many
 *  people came with it, counted here because this is the only place that knows
 *  which sheets moved — and reported onward for the reason `deleteManagedEvent`
 *  counts what it removes (invariant 13): afterwards the old date is gone from
 *  the row and only the audit entry can say what happened to whom. */
export interface SheetMove {
  id: string;
  slug: string;
  from: string;
  to: string;
  signups: number;
}

/** What an event's edit did to its sheets. `stranded` is the ones no rule could
 *  place — a series that genuinely lost a date — reported rather than counted
 *  silently, since a sheet nobody moved is sign-ups nobody can find. */
export interface SheetReanchor {
  moves: SheetMove[];
  stranded: number;
}

/** D1 binds a bounded number of values per statement, so the `IN (…)` reads
 *  below are chunked under it the way lib/backup.ts chunks its own. */
const MOVE_CHUNK = 50;
/** Statements per `batch()`. One sheet's whole group always fits. */
const BATCH_LIMIT = 100;

function shifted(iso: string | null, deltaMs: number): string | null {
  return iso === null ? null : new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

interface MovableSheet {
  id: string;
  occurrence_start: string;
  closes_at: string | null;
}
interface MovablePosition {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** Everything one sheet's move writes: its own row, and every position whose
 *  shift window is dated off the instant it is leaving. ONE builder, shared by
 *  the automatic re-anchor below and the admin's manual repair (`moveSheet`),
 *  because a second copy is how the two would come to disagree about what
 *  "moving a sheet" includes — which is the bug this whole section exists
 *  after, one level up. Returned rather than run, so a caller can keep a
 *  sheet's statements inside one `batch()`. */
function moveStatements(
  env: Env,
  sheet: MovableSheet,
  to: string,
  positions: MovablePosition[],
  ts: string,
): D1PreparedStatement[] {
  const delta = new Date(to).getTime() - new Date(sheet.occurrence_start).getTime();
  // A real move clears `reminder_sent_at` (migration 0041): the reminder that
  // went out named the instant the sheet is LEAVING, so the date it now
  // occupies has earned a fresh one — the cron re-reminds two evenings before
  // the new date. A zero-delta "move" between two spellings of one instant
  // changes nothing a reminder said, so the marker stays.
  const out = [
    delta === 0
      ? env.DB.prepare(
          "UPDATE volunteer_sheet SET occurrence_start = ?, closes_at = ?, updated_at = ? WHERE id = ?",
        ).bind(to, shifted(sheet.closes_at, delta), ts, sheet.id)
      : env.DB.prepare(
          "UPDATE volunteer_sheet SET occurrence_start = ?, closes_at = ?, updated_at = ?, reminder_sent_at = NULL WHERE id = ?",
        ).bind(to, shifted(sheet.closes_at, delta), ts, sheet.id),
  ];
  // A position with no window has nothing dated off the occurrence, and a zero
  // delta moves nothing. Neither is worth a statement.
  if (delta === 0) return out;
  for (const p of positions) {
    if (p.starts_at === null && p.ends_at === null) continue;
    out.push(
      env.DB.prepare(
        "UPDATE volunteer_position SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?",
      ).bind(shifted(p.starts_at, delta), shifted(p.ends_at, delta), ts, p.id),
    );
  }
  return out;
}

/** Carry this event's volunteer sheets onto the dates it now produces, and
 *  return the ones that moved. `oldStarts` are the instants `calendar_event`
 *  held before re-materialization, `newStarts` the ones `expandEvent` just
 *  produced — both ascending, which is what rule 2 above reads.
 *
 *  Safe to call when nothing changed: a sheet on a surviving date is left
 *  alone, and an event with no sheets costs one small read and stops. */
export async function reanchorSheets(
  env: Env,
  managedEventId: string,
  oldStarts: string[],
  newStarts: string[],
): Promise<SheetReanchor> {
  const sheets = await env.DB.prepare(
    `SELECT id, slug, occurrence_start, closes_at FROM volunteer_sheet
      WHERE managed_event_id = ? ORDER BY occurrence_start ASC`,
  )
    .bind(managedEventId)
    .all<{ id: string; slug: string; occurrence_start: string; closes_at: string | null }>();
  if (sheets.results.length === 0 || newStarts.length === 0) return { moves: [], stranded: 0 };

  const surviving = new Set(newStarts);
  // Every date already spoken for: rule 1's sheets are never displaced, and two
  // moved sheets can't collide on one date.
  const taken = new Set(
    sheets.results.map((s) => s.occurrence_start).filter((start) => surviving.has(start)),
  );
  // An ordinal only means something when the list was TRANSLATED rather than
  // cut. Same count in and out is the cheapest honest test for that, and
  // without it a series truncated at the front relocates sign-ups onto a date
  // that already existed and the admin never touched: drop Oct 1 from
  // Oct 1/8/15/22 and the Oct 1 sheet would take its eighteen families to
  // Oct 8, an occurrence nothing about the edit disturbed. Refusing is the
  // conservative half — the sheet is reported stranded and the admin decides —
  // where moving it is the half that can't be undone.
  const translated = oldStarts.length === newStarts.length;

  const moves: SheetMove[] = [];
  const rowOf = new Map<string, { row: (typeof sheets.results)[number]; to: string }>();
  let stranded = 0;

  for (const s of sheets.results) {
    if (surviving.has(s.occurrence_start)) continue;
    const ordinal = translated ? oldStarts.indexOf(s.occurrence_start) : -1;
    const to =
      ordinal >= 0 ? newStarts[ordinal] : newStarts.length === 1 ? newStarts[0] : undefined;
    if (!to || taken.has(to)) {
      // Nowhere to put it. It keeps its date, keeps its sign-ups and keeps
      // reporting itself as `orphaned`; the caller says so out loud, because
      // stranding sign-ups silently is the failure this whole function exists
      // to end.
      stranded++;
      continue;
    }
    taken.add(to);
    rowOf.set(s.id, { row: s, to });
    moves.push({ id: s.id, slug: s.slug, from: s.occurrence_start, to, signups: 0 });
  }
  if (moves.length === 0) return { moves: [], stranded };

  // One group per sheet: its own row and its positions, kept together so a
  // batch boundary can never fall between them (see the flush below).
  const groups: D1PreparedStatement[][] = [];
  const ts = nowIso();

  for (let i = 0; i < moves.length; i += MOVE_CHUNK) {
    const chunk = moves.slice(i, i + MOVE_CHUNK);
    const ids = chunk.map((m) => m.id);
    const holes = ids.map(() => "?").join(",");
    const [positions, counts] = await Promise.all([
      env.DB.prepare(
        `SELECT id, sheet_id, starts_at, ends_at FROM volunteer_position
          WHERE sheet_id IN (${holes})`,
      )
        .bind(...ids)
        .all<{ id: string; sheet_id: string; starts_at: string | null; ends_at: string | null }>(),
      env.DB.prepare(
        `SELECT p.sheet_id AS sheet_id, COUNT(*) AS n FROM volunteer_signup g
           JOIN volunteer_position p ON p.id = g.position_id
          WHERE p.sheet_id IN (${holes}) GROUP BY p.sheet_id`,
      )
        .bind(...ids)
        .all<{ sheet_id: string; n: number }>(),
    ]);
    for (const row of counts.results) {
      const move = moves.find((m) => m.id === row.sheet_id);
      if (move) move.signups = row.n;
    }
    for (const m of chunk) {
      const placed = rowOf.get(m.id)!;
      groups.push(
        moveStatements(
          env,
          placed.row,
          placed.to,
          positions.results.filter((p) => p.sheet_id === m.id),
          ts,
        ),
      );
    }
  }

  // Whole groups only. A `batch()` is atomic but a SEQUENCE of them is not, so
  // a boundary falling between a sheet's new date and its positions' shift
  // windows would leave the sheet moved and its shifts on the old day — with
  // the delta that would repair them gone from memory. One sheet is at most
  // 1 + MAX_POSITIONS statements, comfortably inside one batch.
  let batch: D1PreparedStatement[] = [];
  for (const group of groups) {
    if (batch.length && batch.length + group.length > BATCH_LIMIT) {
      await env.DB.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length) await env.DB.batch(batch);
  return { moves, stranded };
}

/** Move ONE sheet onto another of its event's dates, by hand.
 *
 *  `reanchorSheets` above handles the case that matters most — the admin edits
 *  the event and its sheets follow — but it cannot place every sheet: a series
 *  that genuinely lost a date, or one truncated rather than translated, leaves
 *  a sheet stranded ON PURPOSE rather than guessing. Until this route existed
 *  the admin screen then said "move them to a current date or delete the sheet"
 *  over an app offering neither, and the only way out was deleting eighteen
 *  families' sign-ups. This is the affordance that sentence always promised.
 *
 *  It is deliberately NOT `updateSheet` taking an `occurrenceStart`.
 *  `VolunteerSheetInput` keeps that field create-only because re-dating a sheet
 *  relocates everyone already signed up, and that stays true; what makes this
 *  acceptable is the narrowness, not a change of mind. The target must be a
 *  date the event ACTUALLY produces — read from `calendar_event`, the same
 *  materialized agenda `listOccurrences` offers the admin — and must not
 *  already hold a sheet, which `UNIQUE (managed_event_id, occurrence_start)`
 *  would refuse anyway and which would make "the" volunteer link for a date
 *  ambiguous. Everything dated off the old instant rides the delta, through the
 *  same `moveStatements` the automatic path uses.
 *
 *  Returns null when there is no such sheet; `move` is null when the sheet was
 *  already on that date, so a double-tap writes nothing and the route pushes no
 *  audit draft — an append-only log must not be paddable (invariants 27, 28). */
export async function moveSheet(
  env: Env,
  sheetId: string,
  to: string,
): Promise<{ sheet: VolunteerSheetDTO; move: SheetMove | null } | null> {
  const sheet = await env.DB.prepare(
    `SELECT id, slug, managed_event_id, occurrence_start, closes_at
       FROM volunteer_sheet WHERE id = ?`,
  )
    .bind(sheetId)
    .first<{
      id: string;
      slug: string;
      managed_event_id: string;
      occurrence_start: string;
      closes_at: string | null;
    }>();
  if (!sheet) return null;

  const target = optionalInstant(to, "Date");
  if (!target) throw new VolunteerError("Pick which date to move this sheet to.");
  if (target === sheet.occurrence_start) {
    return { sheet: (await loadSheetForAdmin(env, sheetId))!, move: null };
  }

  const occurrence = await env.DB.prepare(
    "SELECT id FROM calendar_event WHERE managed_event_id = ? AND starts_at = ?",
  )
    .bind(sheet.managed_event_id, target)
    .first<{ id: string }>();
  if (!occurrence) throw new VolunteerError("That date isn't on the calendar for this event.");

  const clash = await env.DB.prepare(
    `SELECT id FROM volunteer_sheet
      WHERE managed_event_id = ? AND occurrence_start = ? AND id <> ?`,
  )
    .bind(sheet.managed_event_id, target, sheetId)
    .first<{ id: string }>();
  if (clash) throw new VolunteerError("That date already has a volunteer sheet.");

  const positions = await env.DB.prepare(
    "SELECT id, starts_at, ends_at FROM volunteer_position WHERE sheet_id = ?",
  )
    .bind(sheetId)
    .all<{ id: string; starts_at: string | null; ends_at: string | null }>();
  const signups = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM volunteer_signup g
       JOIN volunteer_position p ON p.id = g.position_id
      WHERE p.sheet_id = ?`,
  )
    .bind(sheetId)
    .first<{ n: number }>();

  // One batch: the sheet's new date and its shift windows land together or not
  // at all, for `reanchorSheets`'s reason — the delta that would repair a half
  // -applied move is gone once the request returns.
  await env.DB.batch(moveStatements(env, sheet, target, positions.results, nowIso()));

  return {
    sheet: (await loadSheetForAdmin(env, sheetId))!,
    move: {
      id: sheet.id,
      slug: sheet.slug,
      from: sheet.occurrence_start,
      to: target,
      signups: signups?.n ?? 0,
    },
  };
}

// ── Position writes (admin) ─────────────────────────────────────────────────

export async function createPosition(
  env: Env,
  sheetId: string,
  body: VolunteerPositionInput,
): Promise<VolunteerSheetDTO | null> {
  const sheet = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE id = ?")
    .bind(sheetId)
    .first<{ id: string }>();
  if (!sheet) return null;

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM volunteer_position WHERE sheet_id = ?",
  )
    .bind(sheetId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_POSITIONS) {
    throw new VolunteerError(`A sheet may have at most ${MAX_POSITIONS} positions.`);
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO volunteer_position
       (id, sheet_id, title, description, slots, starts_at, ends_at, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      ulid(),
      sheetId,
      trimmed(body.title, MAX_TITLE, "Title"),
      optionalText(body.description, MAX_TEXT),
      coerceSlots(body.slots),
      optionalInstant(body.startsAt, "Start time"),
      optionalInstant(body.endsAt, "End time"),
      body.sortOrder ?? (count?.n ?? 0),
      now,
      now,
    )
    .run();

  return await loadSheetForAdmin(env, sheetId);
}

export async function updatePosition(
  env: Env,
  id: string,
  body: Partial<VolunteerPositionInput>,
): Promise<VolunteerSheetDTO | null> {
  const row = await env.DB.prepare(
    "SELECT id, sheet_id FROM volunteer_position WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; sheet_id: string }>();
  if (!row) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(trimmed(body.title, MAX_TITLE, "Title"));
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    binds.push(optionalText(body.description, MAX_TEXT));
  }
  if (body.slots !== undefined) {
    // Lowering `slots` below what is already filled is allowed and does NOT
    // evict anyone: the people who volunteered committed in good faith. The
    // position simply reads as over-full until someone withdraws.
    sets.push("slots = ?");
    binds.push(coerceSlots(body.slots));
  }
  if (body.startsAt !== undefined) {
    sets.push("starts_at = ?");
    binds.push(optionalInstant(body.startsAt, "Start time"));
  }
  if (body.endsAt !== undefined) {
    sets.push("ends_at = ?");
    binds.push(optionalInstant(body.endsAt, "End time"));
  }
  if (body.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    binds.push(Math.floor(Number(body.sortOrder)) || 0);
  }
  if (sets.length === 0) throw new VolunteerError("Nothing to update.");

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE volunteer_position SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return await loadSheetForAdmin(env, row.sheet_id);
}

export async function deletePosition(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id, sheet_id FROM volunteer_position WHERE id = ?")
    .bind(id)
    .first<{ id: string; sheet_id: string }>();
  if (!row) return null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM volunteer_signup WHERE position_id = ?").bind(id),
    env.DB.prepare("DELETE FROM volunteer_position WHERE id = ?").bind(id),
  ]);
  return row.sheet_id;
}

// ── Claiming and releasing a spot (members) ─────────────────────────────────

export interface ClaimResult {
  ok: boolean;
  reason?: ClaimFailure;
  /** The sheet's slug, so the route can return the refreshed sheet. */
  slug?: string;
}

/** Take one spot on a position, for a Person the caller controls.
 *
 *  Overfill is prevented by the WHERE clause on the INSERT rather than by
 *  reading the count first: D1 runs one statement atomically but gives no
 *  transaction around a read-then-write, so two parents tapping the last spot at
 *  the same moment would both pass a prior count check. `meta.changes` is the
 *  authority on whether the row landed.
 *
 *  The caller must already have verified control of `personId` — that is an
 *  authorization decision and lives in the route, next to the session. */
export async function claimSpot(
  env: Env,
  positionId: string,
  personId: string,
  userId: string,
  note: string | null,
): Promise<ClaimResult> {
  const position = await env.DB.prepare(
    `SELECT p.id, p.sheet_id, s.slug, s.closes_at, s.published_at
       FROM volunteer_position p
       JOIN volunteer_sheet s ON s.id = p.sheet_id
      WHERE p.id = ?`,
  )
    .bind(positionId)
    .first<{
      id: string;
      sheet_id: string;
      slug: string;
      closes_at: string | null;
      published_at: string | null;
    }>();
  if (!position || !position.published_at) return { ok: false, reason: "not_found" };
  if (position.closes_at && position.closes_at <= nowIso()) {
    return { ok: false, reason: "closed", slug: position.slug };
  }

  const already = await env.DB.prepare(
    "SELECT id FROM volunteer_signup WHERE position_id = ? AND person_id = ?",
  )
    .bind(positionId, personId)
    .first<{ id: string }>();
  if (already) return { ok: false, reason: "duplicate", slug: position.slug };

  const res = await env.DB.prepare(
    `INSERT INTO volunteer_signup (id, position_id, person_id, user_id, note, created_at)
     SELECT ?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM volunteer_signup WHERE position_id = ?)
          < (SELECT slots FROM volunteer_position WHERE id = ?)`,
  )
    .bind(
      ulid(),
      positionId,
      personId,
      userId,
      optionalText(note, MAX_NOTE),
      nowIso(),
      positionId,
      positionId,
    )
    .run();

  // No row inserted means the guard bit: the last spot went to someone else
  // between the check above and this statement.
  if (!res.meta || res.meta.changes === 0) {
    return { ok: false, reason: "full", slug: position.slug };
  }
  return { ok: true, slug: position.slug };
}

/** Who a signup belongs to, for the route's authorization check.
 *
 *  `positionId` rides along for the notification the delete route pushes: the
 *  signup row is gone by then, so the spot that just opened up can only be
 *  named from something read before the DELETE. */
export async function signupOwner(
  env: Env,
  signupId: string,
): Promise<{ personId: string; userId: string; slug: string; positionId: string } | null> {
  const row = await env.DB.prepare(
    `SELECT su.person_id, su.user_id, su.position_id, s.slug
       FROM volunteer_signup su
       JOIN volunteer_position p ON p.id = su.position_id
       JOIN volunteer_sheet s ON s.id = p.sheet_id
      WHERE su.id = ?`,
  )
    .bind(signupId)
    .first<{ person_id: string; user_id: string; position_id: string; slug: string }>();
  return row
    ? { personId: row.person_id, userId: row.user_id, slug: row.slug, positionId: row.position_id }
    : null;
}

/** One signup as a `.ics` file — the "add to calendar" a volunteer is offered
 *  after taking a spot. See packages/shared/src/volunteerCalendar.ts for why a
 *  shift, unlike an event, is handed out as a copy.
 *
 *  Read through `loadSheetForMember`, so it resolves the event the way the sheet
 *  page does — from `managed_event`, at the sheet's CURRENT occurrence — and a
 *  file taken after `reanchorSheets` moved the sheet carries the new date.
 *
 *  Returns null when the signup, its sheet or its position is gone; the route
 *  has already checked the caller may act for the Person. */
export async function signupIcs(
  env: Env,
  signupId: string,
  viewer: Viewer,
  locale: Locale,
): Promise<{ body: string; filename: string } | null> {
  const owner = await signupOwner(env, signupId);
  if (!owner) return null;
  const sheet = await loadSheetForMember(env, owner.slug, viewer);
  if (!sheet) return null;
  return signupIcsOf(sheet, owner.positionId, signupId, {
    calendarUrl: env.CALENDAR_URL ?? null,
    timeZone: resolveTimeZone(env.SCHOOL_TIMEZONE),
    locale,
    now: nowIso(),
  });
}

/** The pure half of `signupIcs`. Built from the sheet's event and the one
 *  position, field by field: nothing in the file names anybody — not who signed
 *  up, not who else did — so it is the shift the public sheet already shows,
 *  made into a file. Read `sheet.positions` for the position and NEVER its
 *  `signups`. */
export function signupIcsOf(
  sheet: VolunteerSheetDTO,
  positionId: string,
  signupId: string,
  opts: { calendarUrl: string | null; timeZone: string; locale: Locale; now: string },
): { body: string; filename: string } | null {
  const position = sheet.positions.find((p) => p.id === positionId);
  if (!position) return null;

  const eventUrl = opts.calendarUrl
    ? `${opts.calendarUrl.replace(/\/+$/, "")}${eventPath(sheet.event, opts.timeZone)}`
    : null;
  const window = volunteerShiftWindow(sheet.event, position);
  const body = renderCalendar(sheet.event.title, [
    {
      // The signup's id: one file per commitment, so adding it again after the
      // school moves the event replaces the entry instead of duplicating it.
      uid: `volunteer-${signupId}@eisenhower.school`,
      title: volunteerEntryTitle(position.title, sheet.event.title, dictionaries[opts.locale].volunteerEntryPrefix),
      location: sheet.event.location,
      description: volunteerEntryDetails(position.description, eventUrl) || null,
      url: eventUrl,
      start: window.start,
      end: window.end,
      allDay: window.allDay,
      recurrence: null,
      // Seconds since the epoch: there is no edit counter to read for a
      // signup, and a client that compares SEQUENCE before replacing an entry
      // must see a later download as newer.
      sequence: Math.floor(Date.parse(opts.now) / 1000),
      updatedAt: opts.now,
    },
  ]);
  // ASCII only — it goes in a header, and the title slug keeps any script.
  return { body, filename: `volunteer-${window.start.slice(0, 10)}.ics` };
}

export async function releaseSpot(env: Env, signupId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM volunteer_signup WHERE id = ?").bind(signupId).run();
}

// ── The public/private seam ─────────────────────────────────────────────────

/** THE public/private seam for volunteer sheets, the companion to
 *  lib/calendar.ts's `publicEventOf`. Builds the anonymous-facing shape field by
 *  field — never by spreading — so a field added to VolunteerSheetDTO stays out
 *  of the public response until someone edits this function on purpose.
 *
 *  Three things are withheld deliberately, not incidentally:
 *
 *  - **Names.** `positions[].signups` is dropped entirely; a public reader gets
 *    `filled` and nothing else. Who volunteered is member-only (invariant 1),
 *    and this page's URL is enumerable, so a name here would be a name on the
 *    open internet.
 *  - **`event.seriesId` / `event.recurrenceId`.** The durable handle that
 *    addresses signup data, withheld for exactly the reason
 *    PublicCalendarEventDTO withholds it (invariant 12). The occurrence's
 *    instant still goes out as `event.start` — the public agenda already
 *    publishes that — but the pair that identifies the row does not.
 *  - **`runbookUrl`** (migration 0039). A link to the organizers' working
 *    document — how the event is run, who holds the cash box — which routinely
 *    names families and logistics. Members see it on the event page; an
 *    enumerable anonymous page must not.
 *
 *  If you are here because you added a field to VolunteerSheetDTO: the default
 *  answer is to leave this function alone. */
export function publicSheetOf(sheet: VolunteerSheetDTO): PublicVolunteerSheetDTO {
  return {
    slug: sheet.slug,
    intro: sheet.intro,
    closesAt: sheet.closesAt,
    closed: sheet.closed,
    event: {
      title: sheet.event.title,
      location: sheet.event.location,
      description: sheet.event.description,
      start: sheet.event.start,
      end: sheet.event.end,
      allDay: sheet.event.allDay,
    },
    positions: sheet.positions.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      slots: p.slots,
      filled: p.filled,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
    })),
  };
}

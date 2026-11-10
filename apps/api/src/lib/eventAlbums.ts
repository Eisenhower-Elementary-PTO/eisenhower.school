// Photo-album links on event occurrences (migration 0045).
//
// An admin pastes the link to a collaborative Google Photos album; signed-in
// members see it on the event's page and in the albums list. Nothing here talks
// to Google — the Photos Library API can no longer share an album it created
// (403 since 2025-03-31), so the album is made by hand and this stores where it
// is.
//
// The link is a CAPABILITY: whoever holds it can view the album, and a
// collaborative one lets them add to it. So it never reaches `publicEventOf`
// (invariant 12) — the only readers are the two `requireAuth` routes in
// routes/calendar.ts and the admin write in routes/managedCalendar.ts.

import type { EventAlbumDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { nowIso } from "./time.js";

export class EventAlbumError extends Error {}

/** Where a Google Photos share link lives. A closed list rather than "any
 *  https": the field's whole job is one kind of link, and a stray paste of a
 *  Drive folder or someone's website is a mistake worth catching at the form.
 *  Widen it here if the PTO ever moves albums elsewhere. */
export const ALBUM_HOSTS = ["photos.app.goo.gl", "photos.google.com"] as const;

const MAX_ALBUM_URL = 500;

/** Trim and validate an album link. Empty means "no album" (null). Closed to
 *  https and `ALBUM_HOSTS` because the value is rendered as an anchor on a
 *  members page: a `javascript:` link stored here would run in their session. */
export function normalizeAlbumUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_ALBUM_URL) throw new EventAlbumError("Album link is too long.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new EventAlbumError("Album link must be a full web address, starting with https://.");
  }
  if (url.protocol !== "https:" || !(ALBUM_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new EventAlbumError(
      `Album link must be a Google Photos share link (${ALBUM_HOSTS.join(" or ")}).`,
    );
  }
  return url.href;
}

/** The album on one occurrence, or null. Keyed on the durable pair (invariant 8). */
export async function albumFor(
  env: Env,
  seriesId: string,
  occurrenceStart: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT url FROM event_album WHERE managed_event_id = ? AND occurrence_start = ?",
  )
    .bind(seriesId, occurrenceStart)
    .first<{ url: string }>();
  return row?.url ?? null;
}

/** Every album, newest occurrence first. Reads `event_album` joined to
 *  `managed_event`, NOT `calendar_event`: the agenda forgets an occurrence ~2
 *  days after it ends, and an album is wanted most after the event. */
export async function listAlbums(env: Env, limit = 200): Promise<EventAlbumDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.title, a.occurrence_start, e.all_day, a.url
       FROM event_album a JOIN managed_event e ON e.id = a.managed_event_id
      ORDER BY a.occurrence_start DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{ title: string; occurrence_start: string; all_day: number; url: string }>();
  return results.map((r) => ({
    title: r.title,
    start: r.occurrence_start,
    allDay: !!r.all_day,
    url: r.url,
  }));
}

export interface AlbumChange {
  /** False when the stored value already was what was asked for. A no-op writes
   *  nothing and the route pushes no audit draft (an append-only log must not be
   *  paddable by a double tap — invariant 27's rule). */
  changed: boolean;
  /** What the occurrence held before. */
  previous: string | null;
}

/** Set (or, with a null/empty url, clear) one occurrence's album. Null when the
 *  series doesn't exist.
 *
 *  A NEW album must name a date the series actually produces, read from
 *  `calendar_event` and never the client's word — otherwise a typo mints a row
 *  no page can reach. Replacing or clearing an existing one skips that check,
 *  since the agenda forgets past dates and an admin still has to be able to fix
 *  a link after the event. The consequence: an album can be ADDED only while its
 *  occurrence is upcoming or within ~2 days of ending, so create it in advance. */
export async function setAlbum(
  env: Env,
  seriesId: string,
  occurrenceStart: string,
  rawUrl: string | null | undefined,
): Promise<AlbumChange | null> {
  const series = await env.DB.prepare("SELECT id FROM managed_event WHERE id = ?")
    .bind(seriesId)
    .first<{ id: string }>();
  if (!series) return null;

  const url = normalizeAlbumUrl(rawUrl);
  const previous = await albumFor(env, seriesId, occurrenceStart);

  if (url === null) {
    if (previous === null) return { changed: false, previous };
    await env.DB.prepare(
      "DELETE FROM event_album WHERE managed_event_id = ? AND occurrence_start = ?",
    )
      .bind(seriesId, occurrenceStart)
      .run();
    return { changed: true, previous };
  }

  if (url === previous) return { changed: false, previous };

  if (previous === null) {
    const produced = await env.DB.prepare(
      "SELECT 1 AS ok FROM calendar_event WHERE managed_event_id = ? AND starts_at = ?",
    )
      .bind(seriesId, occurrenceStart)
      .first<{ ok: number }>();
    if (!produced) {
      throw new EventAlbumError("That event has no occurrence on that date.");
    }
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO event_album (managed_event_id, occurrence_start, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (managed_event_id, occurrence_start)
     DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`,
  )
    .bind(seriesId, occurrenceStart, url, now, now)
    .run();
  return { changed: true, previous };
}

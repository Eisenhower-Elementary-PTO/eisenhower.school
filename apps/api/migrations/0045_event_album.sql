-- 0045_event_album.sql — a shared photo album link on ONE occurrence of a managed event.
--
-- An admin-pasted URL (a collaborative Google Photos album) shown to SIGNED-IN
-- members only: on the event's own page and in the members-only albums list.
-- It never crosses `publicEventOf` — an album link is a capability (anyone
-- holding it can view, and a collaborative one can add), and event URLs are
-- enumerable by design (invariant 12). Held to https and the Google Photos
-- hosts on write by `normalizeAlbumUrl` in lib/eventAlbums.ts.
--
-- Keyed on the DURABLE pair, exactly like `volunteer_sheet` (invariant 8):
-- `calendar_event.id` is re-minted on every materialize. The key is a date, so
-- a recurring meeting gets one album per occurrence.
--
-- Deliberately a table of its own rather than a column on `calendar_event`
-- (a derived cache, deleted and re-inserted) or `managed_event` (one row per
-- SERIES). The row OUTLIVES the occurrence it names: `calendar_event` keeps only
-- ~2 days of past events, but an album is wanted most AFTER the event, so the
-- albums list reads this table, not the agenda.
--
-- No `created_by`: the actor is on the audit row (`calendar.album.set`), and a
-- `REFERENCES user(id)` column here would put this table in the user-deletion
-- cascade (invariant 17). The foreign key to `managed_event` is why
-- `deleteManagedEvent` / `deleteManagedCalendar` delete these rows first.
CREATE TABLE event_album (
  managed_event_id TEXT NOT NULL REFERENCES managed_event(id),
  occurrence_start TEXT NOT NULL,
  url              TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (managed_event_id, occurrence_start)
);

-- The albums list reads newest-first across all events.
CREATE INDEX event_album_start ON event_album (occurrence_start DESC);

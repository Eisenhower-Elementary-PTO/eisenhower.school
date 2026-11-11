-- Lost & found: a similarity index that outlives the item (invariant 33).
--
-- Staff asked two things: when a new item turns up, "has something like this
-- come in before, and did anyone claim it?"; and, for the things that are lost
-- over and over (the same blue water bottle, the same jacket), a list of them.
-- Both need history, and `lf_item` forgets: a returned item, its photos and its
-- vector are deleted 30 days after the return (RETURNED_RETENTION_DAYS).
--
-- So each described item leaves a FINGERPRINT here: what it looked like, as an
-- embedding plus the structured fields, and how it ended. One row per item,
-- keyed on the item's id but deliberately NOT a foreign key — the whole point is
-- that the row survives `DELETE FROM lf_item`. The sweep that deletes returned
-- items keeps it; deleting an item by hand (a face in frame, spam) removes it.
-- The fingerprint is deleted `LF_HISTORY_RETENTION_DAYS` after the item was
-- found (365, one school year with room to spare).
--
-- STAFF-ONLY, like `visible_text`. The embedding is built from the same
-- appearance text the public vector uses — no writing — so it learns nothing
-- the public search doesn't. Writing is matched separately and exactly: `writing`
-- holds the lowercased words of `name_text` (the person's name read off the
-- item), which is how "this is Milo's bottle again" is recognised when the
-- model describes it two different ways. It is never in any public shape.
--
-- What a return leaves behind is deliberately small: `returned_to` (the child
-- the claimant named, else the claimant's own name) and `returned_room` (the
-- teacher or room they gave) — enough for the office to walk a recurring item
-- to the right classroom. NOT the claimant's contact details, which stay in
-- `lf_claim` and are still deleted 60 days after the claim settles. This is a
-- longer life for a child's name than /privacy used to promise; /privacy says
-- so (all four languages) and changed first.
--
-- No Vectorize index: the public one holds listed items only, and its
-- semantics (anonymous, no history) are the opposite of this. Similarity is
-- computed in the Worker over the fingerprints, which at school scale is a few
-- hundred to a couple of thousand rows, and which also works under
-- `wrangler dev` where Vectorize has no local mode.

CREATE TABLE lf_fingerprint (
  item_id       TEXT PRIMARY KEY,                     -- the item's ULID; NOT a FK (survives the item)
  -- base64 of 384 little-endian float32s (bge-small-en-v1.5), ~2 KB. Text, so
  -- the JSON backup round-trips it (lib/backup.ts discovers tables).
  embedding     TEXT NOT NULL,
  -- The appearance text that was embedded, so an unchanged description is not
  -- re-embedded when an item is returned or restored.
  embed_text    TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',             -- the scrubbed public title
  category      TEXT NOT NULL DEFAULT '',
  colors        TEXT NOT NULL DEFAULT '[]',           -- JSON array, as lf_item
  brand         TEXT NOT NULL DEFAULT '',
  writing       TEXT NOT NULL DEFAULT '',             -- lowercased name_text words, space-separated. STAFF-ONLY
  found_at      TEXT NOT NULL,
  returned_at   TEXT,
  returned_to   TEXT NOT NULL DEFAULT '',             -- child (else claimant) it went home to. STAFF-ONLY
  returned_room TEXT NOT NULL DEFAULT '',             -- their teacher/room as typed. STAFF-ONLY
  updated_at    TEXT NOT NULL
);

-- Candidates for a new item: same category, newest first; and the retention sweep.
CREATE INDEX idx_lf_fingerprint_category ON lf_fingerprint (category, found_at DESC);
CREATE INDEX idx_lf_fingerprint_found ON lf_fingerprint (found_at);

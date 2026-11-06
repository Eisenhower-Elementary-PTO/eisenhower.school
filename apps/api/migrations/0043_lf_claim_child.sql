-- Lost & found claims now capture WHOSE child the item belongs to and their
-- teacher (invariant 33). Most items go home through a classroom: the office
-- routes a claimed jacket to "Milo, in Ms. Shrestha's room", and until now the
-- claimant had to cram that into `message`.
--
-- Both fields are free text typed by an anonymous claimant, optional (the item
-- may be the claimant's own — a parent's gloves dropped at pickup — or they may
-- not know the room). They are a child's name and placement, so they get
-- exactly the posture `name`/`contact`/`message` already have: staff-only
-- (`claimOf` serves only the roster-gated routes), never in `detail` (audit
-- rows are forever; claims are swept), never in Slack or the notification
-- email, and deleted with the claim by the 60-day retention sweep.
--
-- Free text, deliberately NOT a reference to `person` or `grp`: the claimant
-- is anonymous and the child they name usually isn't in this system at all —
-- and migration 0033's header says why nothing in these tables may ever join
-- `person`. A typed name is a note for the office, not an identity.

ALTER TABLE lf_claim ADD COLUMN child_name TEXT NOT NULL DEFAULT '';
ALTER TABLE lf_claim ADD COLUMN teacher TEXT NOT NULL DEFAULT '';

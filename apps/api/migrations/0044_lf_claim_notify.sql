-- Closing the loop on a lost & found return (invariant 33). Staff used to copy
-- a claimant's contact into their own mail or phone by hand; now marking an
-- item returned against a claim can notify the claimant itself.
--
-- `lang` is the UI language the claim form was filled in, BUCKETED to LOCALES
-- on write (anything else stores as 'en'), so the column can never carry free
-- text. It picks the dictionary the return notification is rendered from —
-- the one message the lost & found sends a claimant, and it names the item
-- and the school, never a child (packages/shared/src/lostFoundReturn.ts).
--
-- `contact_verified` is 1 when the claimant was SIGNED IN and the contact they
-- typed is that account's email, checked server-side at submit time. It marks
-- an address that has already received a magic link; it grants nothing and
-- gates nothing — staff just see a "verified" chip on the queue.
--
-- `notified_at` is the CAS claim on the send, `reminder_sent_at`'s pattern
-- (migration 0041): a guarded `UPDATE … WHERE notified_at IS NULL` means a
-- double-tap mails nobody twice, and a wholly failed send releases its own
-- claim (matched by value) so staff can retry.
--
-- All three ride the claim's existing posture: staff-only (`claimOf` serves
-- only roster-gated routes), never in audit `detail` or Slack, swept with the
-- claim by the 60-day retention job.

ALTER TABLE lf_claim ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE lf_claim ADD COLUMN contact_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lf_claim ADD COLUMN notified_at TEXT;

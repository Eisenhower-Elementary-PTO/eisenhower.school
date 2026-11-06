-- 0042_newsletter_metrics.sql — anonymous, aggregate readership counts for the
-- public newsletter archive.
--
-- Two counter tables, nothing else: how many times an issue's public page was
-- loaded (per school-local day, per reading language) and how many times a link
-- on it was followed (per destination HOST). Deliberately NOT an events table:
-- there is no row per reader, no IP, no user agent, no cookie, no member id —
-- a row here is a tally, so the archive stays exactly as anonymous as it was.
-- That is also why neither table appears on /privacy's services list: nothing
-- new reaches any third party, and what we hold is strictly less than the
-- zone-wide Cloudflare Web Analytics the page already discloses.
--
-- The counts come from a beacon on the published issue page (the page itself
-- is edge-cached, so counting its SERVER renders would miss most readers —
-- the beacon fires client-side on every load). The write path is
-- lib/newsletterMetrics.ts via POST /newsletter-public/issues/:slug/view,
-- which buckets `lang` to LOCALES + 'other' and `dest` to a parsed hostname,
-- so the dimension space — and with it this table's growth — is bounded
-- server-side, never by the beacon's word.
--
-- `day` is the SCHOOL-LOCAL calendar date (isoToZonedDate, @sd/shared), per
-- the "every timed thing is read in the school's zone" convention.
--
-- Views are only recorded for PUBLISHED issues, but an issue can be published,
-- viewed, then unpublished back to a deletable draft — so the drafts-only
-- DELETE /newsletter/issues/:id clears these rows in its batch (D1 enforces
-- the REFERENCES below; a forgotten child would fail the delete, invariant 17's
-- lesson).

CREATE TABLE newsletter_issue_view (
  issue_id TEXT NOT NULL REFERENCES newsletter_issue(id),
  day TEXT NOT NULL,          -- yyyy-mm-dd, school-local
  lang TEXT NOT NULL,         -- a LOCALES code, or 'other'
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, day, lang)
);

CREATE TABLE newsletter_issue_click (
  issue_id TEXT NOT NULL REFERENCES newsletter_issue(id),
  day TEXT NOT NULL,          -- yyyy-mm-dd, school-local
  dest TEXT NOT NULL,         -- destination hostname (translate-proxy hosts unproxied)
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, day, dest)
);

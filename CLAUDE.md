# CLAUDE.md — working notes for agents in this repo

Read this before making changes. It captures the non-obvious rules; the product
spec is in `docs/`, an orientation for humans is in `README.md`. `PLAN.md` is
the ORIGINAL build plan (M0–M4, identity core only) — read it as history; this
file and the tests are the current contract.

**Invariant numbers are referenced from source comments — never renumber them.**

## What this is

Single-tenant **school directory**, live in production, plus the services that
grew on its identity: a calendar with volunteer sign-ups, a newsletter, a merch
store, the PTO's site and planning boards, a lost & found, and the game-night
bingo board.
Cloudflare-native: React/Vite (Pages) + Hono (Workers) + D1 + R2, with
Cloudflare email (Email Sending + Routing on `sitemail.eisenhower.school`;
no fallback channel — Resend was retired 2026-11-05, so a half-configured
channel logs mail instead of sending it), Nominatim geocoding, Stripe +
Printful (store), Workers AI + Vectorize (lost & found), and an optional
Slack webhook.
The account is on **Workers Paid** (upgraded for Email Sending, 2026-10-25).
Any comment citing a Free-plan ceiling — five cron triggers per account, 50
subrequests per invocation — describes history, not a current constraint:
Paid allows 250 triggers and 1000 subrequests. Budgets sized against the old
caps (`SEND_BUDGET`) are kept deliberately, as headroom.

The directory is **members-only; there is no public visibility level.** The
deliberately-open surfaces are: the front door, the calendar agenda and event
pages, volunteer COUNTS, the sent-newsletter archive, published ICS feeds, the
storefront, an order's status page, the PTO's explanatory pages, lost & found
browse/claim, and the live bingo board (numbers only — `readBingoState`,
lib/bingo.ts; writes need a session). Each is served through a hand-written
projection (invariants 12, 13, 15, 26, 33) or, for the PTO landing page, no
read at all (invariant 28). Everything else — every volunteer NAME included —
needs a session.

## Repository layout

```
apps/home           One-page Worker owning the apex, eisenhower.school. Server-rendered, no bundle. One of only FOUR indexed surfaces (with /faq beside it, the storefront, and the PTO public pages).
apps/web            Directory SPA → directory.eisenhower.school. Design system in src/components, screens in src/screens.
apps/calendar       Calendar SPA → calendar.eisenhower.school. Shares API/D1/session; design system COPIED, not imported.
apps/newsletter     Newsletter SPA → newsletter.eisenhower.school. Admin authoring (TipTap) + member preferences, PLUS Pages Functions serving the public archive. Design system COPIED.
apps/store          Store SPA → store.eisenhower.school. Cart + admin in the bundle, PLUS Pages Functions serving the PUBLIC, INDEXED storefront. Printful + Stripe. Design system COPIED. Vendor/DNS setup: SETUP.md.
apps/api            Hono Worker → api-directory.eisenhower.school. Serves ALL the SPAs. Routes in src/routes, logic in src/lib, middleware in src/middleware.
apps/pto            PTO SPA → pto.eisenhower.school. Planning boards (members AND PTO-board only) in the bundle, PLUS Pages Functions serving the PUBLIC, INDEXED explanatory pages (/, /resource-center; /how-to-help 301s to /). Design system COPIED. Routing: ROUTING.md.
apps/lostandfound   Lost & found SPA → lostandfound.eisenhower.school. Public browse/search/item/claim (open, NOT indexed) + member submit (any session; items held for review) + staff screens (roster-gated) in one bundle; no Pages Functions. Design system COPIED. Invariant 33.
apps/bingo          Game-night bingo board (Lit, not React) → bingo.eisenhower.school. Public to WATCH (open, NOT indexed; polls /bingo-public/state); operating needs any session (PUT /bingo/state). Keeps the game's own fullscreen look — deliberately NO design-system copy, no AppShell, not in PLATFORM_APPS. Based on github.com/Meandmybadself/bingo-board; state in D1 (migration 0040). SECOND PAGE at /scan/ (vite MPA): the card checker — point a phone at ANY physical Finger-Tip shutter card (no registration; the school owns 500+) and it reads the printed numbers live, open AND through the translucent red shutters (column ranges make it a 15-way match, not OCR), fuses frames until cells settle, and referees against the called numbers; a tap fixes a misread. All vision in-browser (src/scan/), no OCR service, no new API surface. Fixture-tested: test/vision.test.ts.
apps/redirect       One-file Worker for hostnames that only 301 (retired directory.meandmybadself.com, ptomeet.eisenhower.school). Host map in src/index.ts; each host also a custom_domain route in wrangler.toml.
apps/api/migrations Ordered D1 SQL migrations (NNNN_name.sql). Never edit an applied migration — add a new one.
packages/shared     Domain types (types.ts) + i18n dictionaries (i18n.ts). Imported as `@sd/shared`.
docs/               Product spec (PLAN/SRD/SDD). Source of truth for requirements.
```

## The front door

`apps/home` serves `eisenhower.school` (301s `www`). One HTML document per
request from the shared dictionaries; no client bundle. Three pages: `/`
(`page.ts`), `/faq` (`faq.ts` — explains the site for a parent handed the URL),
`/privacy` (`privacy.ts` — the formal notice). Shared chrome (`<head>`, header,
footer, `?lang=` helpers) lives in `shell.ts`, imported by all three.

- **`/privacy` names every third party data actually reaches** — the bar is
  "data reaches them", not "we have a contract" — so a new outbound call is a
  change to that page. One call is invisible in this repo: **Cloudflare Web
  Analytics is injected at the edge, zone-wide** (reports to `/cdn-cgi/rum`);
  grepping won't find it. `/privacy` names it as the only measurement.
- **`INDEXED_PATHS` in `index.ts` builds the sitemap** — a page added to this
  host and not that list is invisible to search engines. `/faq` makes no
  subrequest at all, so an API outage can't touch it.
- **Nothing member-private may ever appear on an indexed surface** (this host,
  the storefront, the PTO pages).
- **The hero greeting stack is the language picker** — the one place that reads
  ACROSS `dictionaries` (all four `landingWelcome` strings, `LOCALES` order).
  Adding a locale adds a line for free; one without `landingWelcome` breaks the
  type.
- **`?lang=` stays in the URL here** (unlike the SPAs, which apply and strip
  it) — `hreflang` and shared links need stable per-language URLs. Outbound
  links to the apps carry `?lang=`; that handoff is how preference travels (the
  SPAs don't read the cookie).
- **Language resolves `?lang=` → `sd_lang` cookie → `Accept-Language` → `en`**
  (`locale.ts`; server twin of each SPA's `detectLocale`). The cookie is
  written ONLY where an explicit `?lang=` was honoured — detection never
  promotes itself into a preference. Host-only cookie; response is
  `Cache-Control: private` + `Vary: Accept-Language, Cookie`.
- **Exactly one subrequest**: the upcoming-events block (`events.ts`) reads the
  ANONYMOUS `/calendar-public/events`, edge-cached, fast timeout, and **every
  failure resolves to an empty list that hides the block** — an API outage must
  never take the front door down. Rows link to `/e/:date/:slug`, minted in
  `SCHOOL_TIMEZONE`.
- The tile grid leads with the PTO page; the store tile is deliberately absent
  while the shop is unannounced (see comment in `page.ts`).
- District contacts/bell times live in `apps/home/src/district.ts` — including
  the school's NAME. Nothing in that file expires; keep additions to the bar
  of "helps a family", not "reprints the mailing".
- The apex used to be a Cloudflare redirect rule → district site. Redirect
  rules run BEFORE Workers, so if the apex ever 301s again, look for a
  resurrected rule in the zone before debugging the Worker.

## Seven front ends, one API

All seven SPAs are separate Pages projects talking to the single `apps/api`
Worker, sharing one session:

- **`sd_session` has no `Domain`** — host-only to the API hostname. All SPAs
  are `eisenhower.school` subdomains, so a credentialed `fetch` is same-site
  and the cookie rides along. Don't "fix" this with a `Domain` attribute.
- **Every new front-end origin goes in `ALLOWED_ORIGINS`** in
  `apps/api/wrangler.toml` (both `[vars]` and `[env.production.vars]`). That
  list is also the allowlist of magic-link `returnTo` targets — same trust
  boundary, deliberately one variable.
- Five of the non-web apps **copy** `tokens.css`, `Icon.tsx`, `atoms.tsx` and
  the generic half of `parts.tsx` from `apps/web`. They're expected to drift. A
  change to a shared-looking component is a decision about which of the six
  copies need it. `apps/bingo` is the deliberate exception: a fullscreen game
  board with its own look, no design-system copy, no `AppShell`.
- **Navigation has two tiers.** An app's OWN screens are its `navItems()` in
  `AppShell.tsx` (labels are dictionary keys; admin entry is `shield` +
  `navAdmin`). The platform switcher is `PLATFORM_APPS` in
  `packages/shared/src/nav.ts`, rendered by each app's copied
  `AppSwitcher.tsx` and iterated by the store's and PTO's server headers. The
  store is deliberately absent until announced; when that changes, add it
  there and nowhere else. Each app supplies only its ORIGINS
  (`PLATFORM_ORIGINS` in `lib/api.ts` from `VITE_*_URL`) — the shared package
  is also imported by the Worker, which has no `import.meta.env`.
  `test/platformNav.test.ts` checks the icons exist and no hardcoded labels.
- `apps/newsletter`, `apps/store`, `apps/pto` have `wrangler.toml` because they
  have `functions/` serving their public surfaces (real link previews, no
  authoring bundle for anonymous readers). **Never add a `_redirects` file** —
  Pages 308s `/index.html` → `/`, so an SPA-fallback rewrite sends `/admin` to
  the public page. Functions take precedence over assets; everything else falls
  through to `index.html` on its own. See each app's `ROUTING.md`.
- **The PTO landing page reads only the ANONYMOUS calendar projections**
  (`functions/_lib/volunteers.ts`) for its live volunteer block, hiding the
  block on any failure; `/resource-center` reads nothing — pure function of
  URL, `Accept-Language`, `sd_lang`. `pto_*` tables are reached only via the
  bundle's credentialed `/pto/*` fetches. See invariant 28.
- The calendar owns all calendar admin; `apps/web`'s `/calendar` is a redirect
  and keeps only `api.calendarEvents` for Home's block.
- **The calendar's home screen is public** — `/` reads `/calendar-public/*`
  (no `requireAuth`), never the members-only `/calendar/*` twins (which
  `apps/web` uses). See invariant 12 before adding a field to any calendar DTO.
- **A volunteer sheet has no page of its own** — it renders inline on its
  event's page. `/v/:slug` (permanent URL, circulates in texts; a slug is the
  only DURABLE handle on a sheet) resolves and forwards there, picking the
  endpoint by session (anonymous = counts, no names), passing `?sheet=` so a
  draft or orphaned sheet still opens; a param-sourced sheet is checked against
  the path's own slug before rendering. Signing up always needs an account.
  See invariant 13.
- **`/e/:date/:slug` is THE event page** — description, volunteer sheet
  (`components/VolunteerPositions.tsx`) and admin edit form all live there; one
  rendering of an event, not two. **No per-event `.ics` download** (a copied
  occurrence goes stale when the school moves the date; the calendar-level
  subscribe keeps up) — with ONE exception: a volunteer's own claimed shift
  offers "Add to calendar" (Google template link + `.ics` from
  `GET /volunteers/signups/:id/ics`, controller-or-admin, `no-store`). Both are
  built by `volunteerShiftWindow` (`packages/shared/src/volunteerCalendar.ts`);
  the `.ics` UID is the signup id so re-adding after a move replaces the entry;
  `signupIcsOf` names nobody (pinned). The path is a CONTENT identity
  (day + title slug; `eventPath` / `findEventByPath`, see invariant 8). The app
  mints the day in the READER'S timezone, so lookup searches ±1 day and takes
  the nearest occurrence. The screen reads the public route; only a system
  admin re-reads the members-only twin (for `seriesId`, which the edit form
  needs). The agenda is written purely against `PublicCalendarEventDTO`.
- The newsletter's events blocks link titles to `/e/:date/:slug`, minting the
  day in the ISSUE'S `SCHOOL_TIMEZONE`. `calendar_event` keeps only ~2 days of
  past events, so an archived issue's event links stop resolving shortly after
  the event — inherent to addressing an event at all, not a bug.

## Non-negotiable invariants

1. **Privacy is resolved server-side only.** Never send a client data it can't
   see. All filtering lives in `apps/api/src/lib/privacy.ts` + `serialize.ts`.

2. **Geo-coordinates never leave the server.** `geo_lat`/`geo_lng` go in no
   DTO. Neighbor responses carry a rounded distance string only.

3. **New fields default to `private`** (NFR-1). Neighbor discovery is opt-in
   and independent of address visibility.

4. **No account enumeration.** `/auth/start` and registration-closed responses
   are identical whether or not the email exists.

5. **All mutating routes push audit drafts** to `c.var.audit`; the middleware
   persists them hash-chained. Never write `audit_log` directly. The append is
   a **compare-and-swap on `seq`** (migration 0016): D1 has no read-then-write
   transaction and the flush runs in `waitUntil`, so a writer claims a
   position, `ON CONFLICT (seq) DO NOTHING` rejects the loser, and it re-reads
   and re-chains — retry budget 25 with jittered backoff, because exhausting it
   DROPS an entry, which is worse than a fork. `verifyAuditChain` is exposed at
   `GET /admin/audit/verify`; rows appended before 0016 may legitimately fail.
   **Noise is fixed at the push site, never by deleting rows** (the chain is
   append-only; `lib/sweep.ts` deliberately omits `audit_log`).
   `newsletter.issue.updated` is the worked example: the editor autosaves, so
   `claimEditSession` (`routes/newsletter.ts`, migration 0020) mints one row
   per editing SITTING — a guarded `UPDATE … WHERE audit_session_at < ?`
   batched with the save, draft pushed only when `meta.changes` says this
   request opened the session. State lives on the issue row (audit rows are
   written in `waitUntil` AFTER the response, so a lookup there would race).
   Before coalescing another action, **count first**
   (`SELECT action, COUNT(*) FROM audit_log GROUP BY action`) — coalescing a
   human-paced action loses real events for nothing.

6. **UI copy comes from `@sd/shared` i18n dictionaries** — never hardcode
   user-facing English in a component. Member-entered content is never
   translated.

7. **IDs are ULIDs** (`lib/ids.ts`); timestamps are ISO-8601 UTC strings.

8. **`calendar_event` is a derived cache; its row ids are NOT stable** (both
   imported feeds and managed events delete-then-insert, minting fresh ULIDs).
   The durable handle on a managed event is `(managed_event_id, starts_at)` —
   the ICS `UID` + `RECURRENCE-ID` convention, surfaced as
   `seriesId`/`recurrenceId` on `CalendarEventDTO`. `volunteer_sheet` stores
   exactly that pair and reads its event from `managed_event`, never
   `calendar_event` (invariant 13). An imported event has no durable id;
   `eventKey` (`packages/shared/src/newsletterEvents.ts`) falls back to the
   content identity `dedupeEvents` uses (kind + title + start-to-the-minute).
   Never key anything durable on `CalendarEventDTO.id`. The event page URL
   (`/e/:date/:slug`) uses content identity for managed and imported events
   alike — retitling or moving drops old links, a deliberate trade
   (`packages/shared/src/eventPath.ts`).

9. **One newsletter renderer.** Issues are TipTap JSON turned into HTML solely
   by `packages/shared/src/newsletterRender.ts` — email, composer preview, and
   archive alike. It is also the sanitizer: a fixed node/mark allowlist that
   escapes all text, so enabling a TipTap extension without adding its renderer
   case silently drops content. `sanitizeNewsletterDoc` applies the allowlist
   on write. The **settings footer is the one raw-HTML seam**:
   `sanitizeFooterHtml` (same file) reduces admin-written `footerHtml` to a
   tag/attribute allowlist on WRITE (`coerceNewsletterSettings`). HTML only —
   `footerHtmlOf` serves email and archive; `footerTextOf` flattens for the
   email's text part. Never add a second place that interpolates admin HTML.
   (`coerceNewsletterSettings` still promotes legacy `footerText` on read;
   removable once every instance re-saves settings.)

10. **A sent newsletter is immutable; `published_at` (migration 0031) is the
   public gate, not `status`.** Events blocks resolve live while drafting and
   are FROZEN into `events_snapshot_json` at send. Issue URLs are enumerable by
   design — nothing member-private in one. An editor can publish without
   mailing (`POST /newsletter/issues/:id/publish`), keep editing a published
   draft, and unpublish anything (`DELETE …/publish`) — a sent page with a
   mistake has to be removable — except while a send is running. The send
   publishes via `COALESCE` (keeps an earlier date; the email's "view in
   browser" link is that page). While published: slug can't change, draft
   can't be deleted (links are already out). Publish/unpublish are CAS, write
   and log nothing when repeated, and are Slack-curated.
   `test/newsletterPublish.test.ts` pins it. `edited_by`/`edited_at`
   (migration 0032) move only on document writes (publish/send bump
   `updated_at` too); the name comes from `editorNames` (`lib/newsletter.ts`)
   through `personListableSql`; `userDeletionStmts` NULLs the column.

11. **One recurrence engine.** Managed events expand by rendering through
   `lib/icsWriter.ts` and parsing back through `parseIcs`
   (`lib/managedCalendar.ts`). Never hand-roll a second RRULE walker — the
   round-trip guarantees the published feed and the agenda agree.

12. **The calendar's public seam is `publicEventOf` / `listPublicCalendarFeeds`**
   (`apps/api/src/lib/calendar.ts`). `PublicCalendarEventDTO` /
   `PublicCalendarFeedDTO` are hand-written, never `Omit<>` or spread — a field
   added to `CalendarEventDTO` does NOT reach the public response until someone
   edits the projection on purpose. Deliberate withholdings:
   `seriesId`/`recurrenceId` (the durable handle signups key on — invariant 8);
   an imported feed's upstream `url` is **replaced, never passed through** (it
   may be a secret Google/Outlook subscribe link, and raw feeds carry
   ORGANIZER/ATTENDEE addresses). Public feed URLs are on our origin:
   `/ics/:id.ics` (managed), `/ics/source/:id.ics` (mirrored from stored rows
   by `renderImportedSourceIcs`, never proxied).
   `test/calendarPublic.test.ts` asserts the exact key set and fails on leaks.
   Two fields have cleared the bar since: `volunteerSlug` (an opaque handle on
   a sheet's public page — precisely so public links needn't carry the durable
   pair) and `meetingUrl` (migration 0025: admin-typed, says where the event
   happens, already in the sessionless ICS feed as RFC 5545 `URL`; held to
   http(s) on write by `normalizeMeetingUrl`; round-trips per invariant 11;
   `refreshSource` deliberately does NOT bind an imported feed's `URL` — on a
   district feed that names a web page, not a meeting).

13. **Volunteer counts are public; volunteer NAMES are members-only.** A sheet
   (`volunteer_sheet` → `volunteer_position` → `volunteer_signup`, migration
   0012) hangs off ONE occurrence of a managed event.
   `/volunteers-public/sheets/:slug` (no auth) returns positions + `filled`
   counts; `/volunteers/sheets/:slug` (auth) adds who. The seam is
   **`publicSheetOf`** (`lib/volunteers.ts`), field by field like
   `publicEventOf`; sheet URLs are enumerable by design, so a name reaching
   that response is a member's name on the open internet —
   `test/volunteersPublic.test.ts` asserts exact key sets and that no name,
   note or person id survives. Structural rules: only managed events carry
   sheets (invariant 8); a sheet resolves its event from `managed_event`, never
   `calendar_event` (an occurrence edited away reports `orphaned`, not
   deleted); writes always need a session, and claiming for a Person requires
   `isController` or system admin. Overfill: guarded
   `INSERT … SELECT … WHERE (count < slots)` checking `meta.changes` (no D1
   transactions).
   **Moving an event moves its sheets — `reanchorSheets`** (called by
   `updateManagedEvent`; built after a production incident where a moved event
   silently lost its sign-up link while eighteen families sat claimed on a dead
   date). The move is a CONSEQUENCE of the event edit;
   `VolunteerSheetInput.occurrenceStart` stays create-only. Placement rules, in
   order: a sheet on a SURVIVING date never moves; otherwise it keeps its
   ORDINAL — gated on `oldStarts.length === newStarts.length`, because the
   ordinal only means anything when the list was translated, not cut (dropping
   one date from a series must strand that sheet, not relocate its families);
   a ONE-DATE event is unambiguous, so a sheet in neither list lands on it
   (heals an orphan on next save). Nothing moves onto a date another sheet
   holds (`UNIQUE (managed_event_id, occurrence_start)` would fail the batch);
   the unplaceable stays `orphaned` and is COUNTED — `sheetsStranded` and
   `sheetsMoved` are reported by every edit surface through `eventSavedNote`.
   `closes_at` and shift windows ride the same delta as OFFSETS — and note the
   clock: `expandEvent` works in UTC (invariant 11), so a series keeps its
   absolute INSTANT and its local wall clock shifts across a DST boundary.
   Two orderings are deliberate: `reanchorSheets` runs BEFORE `materialize`
   (the old→new mapping lives only in `oldStarts`, which materialize deletes —
   fail after it and a retry sees nothing to fix); each sheet's row and its
   positions share ONE `batch()` (a batch is atomic, a sequence isn't).
   `test/managedEventMove.test.ts` is behavioural — its fake D1 records binds
   and batch boundaries.
   **Stranded sheets are moved by hand**: `moveSheet` +
   `POST /admin/volunteer-sheets/:id/occurrence`. Not `updateSheet` taking a
   date — the objection (re-dating relocates everyone signed up) is answered by
   NARROWNESS: the target must be a date the event actually produces (read from
   `calendar_event`, never the client's word) and not already hold a sheet;
   the route re-checks both. `moveStatements` is ONE builder shared with
   `reanchorSheets`. A no-op move writes nothing. `volunteer.sheet.moved` is
   its own audit action (the departed date survives nowhere else) and is
   Slack-curated. `test/volunteerSheetMove.test.ts`.
   **Deleting an event cascades**: `deleteManagedEvent`/`deleteManagedCalendar`
   run `sheetCascade` (shared with `deleteSheet`) at the FRONT of their own
   batch — signups, positions, sheets, then the event — else a constraint
   failure or invisible orphans (`sheetRow` joins `managed_event`). Both
   deletes COUNT what they remove BEFORE removing it; counts go on the audit
   row and an admin confirmation. `ManagedEventDTO.sheetCount`/`signupCount`
   are admin-only. `test/managedEventDelete.test.ts` pins order and pre-count.
   **Emailing a sheet's volunteers**: `GET /admin/volunteer-sheets/:id/emails`
   → `sheetVolunteerEmails`, system-admin-only. The admin screen builds a
   `mailto:` with everyone **Bcc'd, never To** (a roster in To publishes every
   family's address to every other family), subject = event title. "Copy
   volunteer emails" sits beside it because `mailto:` opens nothing for
   browser-mail admins; on clipboard refusal the list is SHOWN on screen. Both
   share one read (`gatherEmails`). Not a field on `VolunteerSignupDTO` (that
   shape reaches every member). The address discloses nothing an admin can't
   already read: the Person's own email items at `visibility = 'service'` ONLY
   (no admin exemption from `private`), else controlling Users' account emails,
   skipping disabled accounts; ordering is `sort_order` then `since`. Reads no
   `person` rows. `test/volunteerEmails.test.ts` is behavioural (fake D1
   evaluates both WHERE clauses). Sending from the API was rejected: the mailer
   is for mail the SYSTEM sends.
   **The system DOES send one mail: a reminder, two evenings before the
   event** — `sendVolunteerReminders` (`lib/volunteerReminders.ts`) on its own
   cron (`15 0 * * *` ≈ 6:15pm Central). Due = published sheet with ≥1 signup,
   occurrence still on the calendar (an orphaned sheet's date is one the series
   no longer produces), 1–2 school-local days ahead — 2 is the design, 1 the
   catch-up for a missed tick or a late-published sheet. `reminder_sent_at`
   (migration 0041) is a CAS claim (guarded `UPDATE … WHERE … IS NULL`);
   `moveStatements` clears it on a real move so a re-dated event re-reminds for
   its new date, and a wholly failed send releases its own claim (matched by
   value) so the next evening retries. Addresses resolve through
   **`firstEmailByPerson`** — the same two rules as "Email volunteers",
   extracted from it so the clauses can't fork. One message per ADDRESS, every
   shift that address stands behind, duplicates collapsed. The email names
   NOBODY and the module reads no `person` row: position titles + shift windows
   (the public sheet's content) plus the `/v/:slug` link — and the sheet's
   **runbook link**, which stays members-only in spirit: the recipients ARE the
   sheet's signed-up families, the audience the event page already shows it to.
   `volunteer.reminder.sent` is written from the cron through `writeAudit`
   (null actor, like the email intake) and Slack-curated — counts and the
   public title only; the zero-recipient line is the one that needs a human.
   **Proofing is `POST /admin/volunteer-sheets/:id/test-reminder`**
   (`buildTestReminder` — same renderer, built from POSITIONS so a draft with
   no signups can be proofed; subject prefixed `[Test]`; mails the admin's own
   address or up to 10 they typed, never the volunteers; audited
   `volunteer.reminder.test_sent`, Slack-silent). The proof's BODY carries a
   banner saying it lists every position where a real reminder is per-family —
   without it the proof reads as a reminder for shifts the reader never
   claimed (reported the first evening it was tried, 2026-11-03). The button lives on the
   calendar's sheet admin screen. `test/volunteerReminders.test.ts`.

14. **Public newsletter sign-up is double opt-in; `POST
   /newsletter-public/subscribe` writes no subscription** — it only mints a
   `newsletter_confirmation` (migration 0013) and mails the link;
   `POST …/subscribe/confirm/:token` is the ONLY public path touching
   `newsletter_subscriber`. Rules: the **GET on the token stays read-only**
   (mail scanners follow every GET, so a confirming GET verifies the mail
   server, not the recipient — `test/newsletterSubscribe.test.ts` asserts it);
   the token is **not an `auth_token`** (`/auth/callback` matches `token_hash`
   without filtering `kind` and creates users for non-`signin` kinds — a
   newsletter token there is an account-creation vector); the **response never
   varies** — malformed, new, already-subscribed and rate-limited all answer
   `{ ok: true }` (invariant 4; the send cap must not be an existence oracle).
   Admin-side adds stay single opt-in on purpose (an admin asserts a
   relationship the form can't). `confirmed_at` (migration 0014) is stamped
   only by the public confirm route, so admin notifications key on it, not
   `created_at` (the upsert deliberately doesn't bump `created_at`, so
   re-subscription is invisible to window queries over it).
   `newSubscriberNotify` lives on the newsletter settings blob (each app owns
   its own admin); `lib/notify.ts` holds both digests on one cron.

15. **An issue page has ONE projection and TWO gates.** Everything a reader
   sees — archive page and review link alike — is built by `issuePageOf`
   (`lib/newsletter.ts`), field by field. Never spread a row into it:
   `newsletter_issue` holds `preview_token_hash`, so a spread publishes a live
   capability on an enumerable page. `/newsletter-public/issues/:slug` filters
   `published_at IS NOT NULL` **in SQL** (a guessed draft slug reveals
   nothing); `/newsletter-public/preview/:token` has no status filter —
   holding the token IS the authorization. The token (migration 0015) is
   hashed at rest, minted only by a system admin, revocable, no expiry,
   deliberately survives a send, and is not an `auth_token` (invariant 14's
   reason). **Token pages are never cacheable** — `/preview/:token` and its
   `/print` twin pass `cacheable: false` → `htmlPrivate()`; a shared cache
   would serve a revoked link from the edge.
   `test/newsletterIssuePage.test.ts` pins key set and both gates.

16. **"View as PDF" is printing, not a PDF renderer.** No PDF library or
   Browser Rendering binding, on purpose — a second renderer is a second place
   for the look to drift from the email (invariant 9). The `@media print`
   block lives in `NEWSLETTER_WEB_CSS`; `/print` routes add only the
   auto-firing dialog. The admin's print view is an SPA route, not a Pages
   Function (host-only session cookie — see `apps/newsletter/ROUTING.md`).
   **Paper carries a QR code to the live issue** (`.nl-qr`, print-only),
   encoding the sent issue's `/n/:slug` — built from the SLUG, never the
   request url (a print of a review link must not put the token on paper).
   `publishedIssueQrSvg` (`packages/shared/src/newsletterQr.ts`) refuses any
   other shape and returns "". Public prints draw it only for SENT issues; the
   admin print draws it for drafts too. `test/newsletterQr.test.ts`.
   **Every http(s)/mailto link in the body gets a numbered code in a rail down
   the right margin** (`qrBlock` in `newsletterRender.ts`): the body reserves
   the rail once as right padding (`nl-body-rail`, added only when a code
   exists) and codes FLOAT into it, so every block keeps the same measure.
   `linkQrSvg` draws in WEB mode only (email never carries one); one code per
   destination, repeats reuse the number (`.nl-qr-ref` superscripts); `tel:`
   and generated events-block links get none; `--qz` aligns the number with the
   quiet zone. Tests pin that the float margin matches the rail and no
   `min-height` returns.

17. **Removing a User is `disabled_at`; deleting one executes a shared impact
   report.** Disable (`POST /admin/users/:id/disabled`) is reversible and
   touches the `user` row alone — session middleware, newsletter audience and
   masquerade all filter on `disabled_at`. Two guards: the session sweep
   matches `acting_admin_id` as well as `user_id` (a disabled admin must not
   keep masquerading); the disable is refused unless another enabled system
   admin remains, enforced INSIDE the `UPDATE` (no transactions; two admins
   disabling each other concurrently must not brick the instance — nothing
   clears `disabled_at` without an admin session).
   **`DELETE /admin/users/:id` executes the report rather than re-deriving
   it**: `computeUserDeletionImpact` (`lib/userAdmin.ts`) is shared by
   `GET /admin/users/:id/impact` (shows it) and the delete (runs exactly it via
   `userDeletionStmts`). Guards: system admin only, never while masquerading,
   never yourself, and only an already-DISABLED account — so "take out of use"
   and "erase" are never one click, and no separate last-admin guard is needed.
   `control` is many-to-many: only a Person with NO other controller is this
   user's to take; co-controlled Persons are KEPT, losing only this control.
   `grp` records no creator: a household is removed only when left memberless;
   classroom/school groups never. **`audit_log` is never deleted for anyone**
   (append-only, hash-chained; also absent from `lib/sweep.ts`).
   **D1 ENFORCES foreign keys** and `batch()` is atomic — a forgotten
   reference fails the whole delete (an earlier version of this file said the
   opposite and the delete shipped broken on it; fake-D1 route tests have no
   schema to disagree with). The cascade is therefore COMPLETE by hand:
   DELETES account-owned rows (sessions, sign-in tokens, volunteer claims,
   board comments, shares — `created_by` NOT NULL, counted `sharesWithdrawn`)
   and NULLs attributions (`created_by`, `assigned_by`, `invited_by`, a
   `store_order`'s buyer link — the order is a financial record and stays).
   Per-Person cascade is `personCascadeStmts` (`lib/personDelete.ts`), shared
   with `DELETE /persons/:id` (invariant 25). `test/userDeletion.test.ts` pins
   guards, cascade, untouched `audit_log`, email-only Slack `notify`.
   **`test/deletionCoverage.test.ts` is the schema-shaped tripwire**: it reads
   `migrations/*.sql`, collects every column that `REFERENCES user(id)` or
   `person(id)`, and fails on one either cascade doesn't cover — a new
   `REFERENCES user(id)` fails it until `userDeletionStmts` says what happens.

18. **A search may not match on more than it renders.** `last_name` shown as
   an initial plus a naked `LIKE` is a surname oracle (and `COUNT(*)` over the
   same WHERE leaks it before a row is built). Every name search goes through
   **`personSearchSql`** (`lib/privacy.ts`) — surname term conjoined with the
   display rule + controller exemption — backing the directory listing AND its
   total, the share-target picker and the group add-member picker; no second
   copy of the predicate; pickers get no group-admin exemption.
   `test/privacyRoutes.test.ts` asserts all four statements. Before adding any
   search: ask what the response withholds and make the WHERE withhold it too.
   **The capability filter** (`?capability=`, OR'd into one `IN`) clears the
   bar: every role capability is already rendered as a tag on the row it
   selects. `household_admin` is refused (400, like unknown codes) — it's
   authority over a group, not a kind of person, and the UI hides it
   (`roleCapabilities`). The filter is ANDed onto `personSearchSql` (never in
   place of it), onto BOTH statements, written as a trailing fragment inside
   each `prepare` so `${search.sql}` stays visible to
   `test/personListable.test.ts`'s scan. An unrecognised code is a 400, never a
   dropped term (dropping answers a filtered request with the whole roster).
   **`PersonSummaryDTO.classrooms`** (rooms the Person is on the roster of) is
   the rule read the safe way round — the row renders MORE than the search
   matches on — and discloses nothing new (`GET /groups/:id` already serves
   every roster to any member). The read is batched over the page's ids, reads
   `membership` + `grp` and **never `person`** (spends no exemption budget),
   and does NOT filter `self_asserted` (that column decides what a membership
   lets a viewer READ — invariant 27 — not who is on a list; filtering would
   hide a placement from the parent who made it). `test/directoryClassroom.test.ts`
   is behavioural where possible; the absent `self_asserted` clause must stay a
   textual check. A future `?classroom=` filter would be legitimate, ANDed onto
   `personSearchSql`.
   **Labels are ELIDED by code, not CSS.** District room names run four
   segments; an ellipsis clips from the end, making every room in a grade
   identical. `shortClassroomName` (`packages/shared/src/text.ts`) renders
   `Gr 2 - Shrestha`, with the full name as `title`. It abbreviates
   `Grade`→`Gr`, `Kindergarten`→`K` (word-bounded, so `Kindergarten AM` →
   `K AM`; a bare `K` passes through) — both asked for by name; a third
   abbreviation wants the same deliberation. **It reads segments by SHAPE, not
   position** (production is grade-programme-teacher-room; the demo seed is
   teacher-first with no room): the grade is the segment saying "grade"/
   kindergarten; the room needs `Rm`/`Room` AND a digit; the teacher is the
   segment BEFORE the room (fallback: last non-grade segment) and must contain
   whitespace — both refusals turn a mislabel into no label (a programme must
   never be presented as a person). Surname = last whitespace-separated word
   (`Van Dyke` → `Dyke`, pinned as a known cost). Splits on the middle dot
   only. It is a RENDERING step and must stay one: `resolveGroup` in
   `lib/bulkImport.ts` matches `WHERE name = ?`, so normalising on write makes
   a re-import mint duplicates. `grp.name` stays the district's string.
   **`groupLabel(name, kind)`** (same file) dispatches: classroom →
   `shortClassroomName`, everything else untouched (the rule must know what
   its segments mean; households and generic groups are left alone). Every
   caller pairs it with `title={group.name}`; every list of groups is expected
   to use it. `GET /groups` matches the full name AND the elided label,
   accent-folded, in memory (`foldSearch` in `routes/groups.ts`) — typing what
   the table shows ("Gr 2") has to find the row, and SQLite's `lower()` is
   ASCII-only. Both directions are safe: everything matched derives from a
   name any member may already search and read (invariant 21).
   `test/groupsFilter.test.ts` pins label and accent matching behaviourally. `test/shortClassroomName.test.ts` pins the two-rooms-one-grade
   case, byte-for-byte passthrough, no invented characters, and that
   `groupLabel` stays a total dispatch over `GROUP_KINDS`.
   **Four listings carry the label; one reader serves them** —
   `classroomsByPerson` (`lib/serialize.ts`): directory row, profile household
   card (`householdsFor`), a household's group page, Home's neighbour cards.
   One function because `kind = 'classroom'` is the whole correctness (a fifth
   call site that forgot it would label people with their HOUSEHOLD). Same
   properties as above: batched, `membership`+`grp` only, no `self_asserted`
   filter. **The neighbour card asks household-first**: `classroomsByHousehold`
   resolves a household's members and hands them to `classroomsByPerson`;
   `routes/home.ts` resolves both card kinds to a household in one batched
   read; rooms dedupe by id across siblings, re-sorted by name. Its co-member
   read DOES compose `personListableSql` (the viewer named a HOUSEHOLD, never
   its members — an ungated read would let a room report an unlisted child;
   invariant 21). A household whose only student is unlisted shows no rooms,
   indistinguishable from one with none. `test/neighborClassrooms.test.ts` is
   behavioural. `ClassroomLine` in `components/parts.tsx` is the one rendering
   (in the non-copied half of that file).
   **`GroupMemberDTO.classrooms` is served for a household ONLY** (absent =
   route didn't look; `[]` = on nobody's roster) — a classroom's page would
   repeat its own title 25 times and `GET /groups/:id` rolls up subtrees.
   `test/groupClassroomLabels.test.ts` pins both states;
   `test/profileHouseholds.test.ts` evaluates `g.kind` behaviourally.
   **The reader answers for a `student` and nobody else** — rosters hold the
   adults who run the room, and the label answers "which room is this child
   in", not "what rooms touch this adult". Same capability
   `PUT /persons/:id/classroom` requires (invariant 27). `student` is
   self-mintable, which is fine: choosing what to LABEL is not choosing what
   to disclose. All three tests put an adult on the child's roster, so
   deleting the clause fails with that adult labelled by the room they run.

19. **The two ways in from an email are read-only GETs.** Mail scanners follow
   every GET before the recipient sees it; a GET that spends a single-use
   token hands the use to the scanner. `/auth/callback` GET validates and
   renders `signInHandoffPage` (the only HTML this API serves) whose form
   POSTs the token back; browsers auto-submit, scanners run no script.
   `POST /auth/callback` claims the token INSIDE the UPDATE
   (`AND consumed_at IS NULL`, checking `meta.changes`). `/auth/start` carries
   a send budget — per address and instance-wide, response unchanged either
   way (no oracle). **A rate limit that counts rows drags two things with
   it**: an index for the count (`auth_token (kind, created_at)`, migration
   0017) and a sweep (`lib/sweep.ts`) so the table doesn't grow forever. Where
   a sweep's retention exceeds the counting window it is a SECURITY parameter
   — `sweep.ts` spells out which two, and why neither may key its age test on
   `expires_at`.

20. **`/photos/:key` is members-only.** It is the only route serving `PHOTOS`,
   the objects are photographs of children, and a ULID key is not an access
   rule (a cached/referred/screenshotted URL would be permanently public).
   `sd_session` rides an ordinary same-site `<img src>`. Nothing anonymous
   serves a photo URL — `publicEventOf`, `publicSheetOf`, `issuePageOf` all
   omit it, and newsletter images live in `NEWSLETTER_MEDIA`, a separate
   bucket, precisely so the public media route can't reach one.

21. **Whether a Person exists to a viewer is decided before any field on them
   is.** `unlisted_at` (migration 0018) hides a Person from every ordinary
   member while staying visible to system admins and controlling Users. Only a
   system admin may flip it (`POST /persons/:id/unlisted`); a Controller SEES
   the flag (`buildProfile` returns `unlisted`; the profile shows the card
   without the button) — a family missing with no explanation is the confusing
   outcome, not the private one. The seam is **`personListableSql`**
   (`lib/privacy.ts`); `personSearchSql` is built ON it, not beside it — an
   empty query returns the gate, not `"1"`, because "no search term" is
   exactly the unfiltered listing an unlisted Person must stay out of. Two
   deliberate non-SQL uses: `buildProfile` bakes it into its single-row WHERE
   (an unlisted Person **404s** for a guessed ULID — serving the profile while
   hiding the listing is invariant 18's oracle one URL along), and
   `positionsOf` drops rows in memory with **`isPersonListable`** so a
   position's `filled` still counts an unlisted signer (a shrinking count
   advertises a taken shift as open).
   **`test/personListable.test.ts` is the tripwire**: it scans `apps/api/src`
   for `FROM person` / `JOIN person` and fails unless each composes the guard
   or carries `// UNLISTED-EXEMPT: <reason>` (file-level:
   `UNLISTED-EXEMPT-FILE:`). It catches the call site nobody tested; it is
   detection, not prevention (views and dynamic table names slip past).
   `DELETE FROM person` is excluded, narrowly: deletes need AUTHORITY
   (`isController`, pinned by route tests), not visibility — and in
   `DELETE /persons/:id` composing the gate would be actively wrong (the batch
   runs after `control` rows are gone, so the subquery is false and the row
   would survive its own delete). Exemption budget: 9 (see invariant 32).
   **Group-level hiding is deliberately not built**: `GET /groups` gives any
   member every group's name and raw `member_count`, and `children[].memberCount`
   is a plain count — numbers, never identities; a second flag on `grp` waits
   for a real case. **A profile's household roster is where that price stopped
   being free**: `householdsFor` (`lib/serialize.ts`) composes the gate (it's
   a listing), and because its output would sit beside the unfiltered count,
   the profile renders **faces or the count, never both** (a count next to a
   gated roster is an arithmetic oracle). Households only; a household the
   gate empties is omitted, not serialized empty.
   `test/profileHouseholds.test.ts` is behavioural — a guard collapsed to
   `"1"` fails with a real name.

22. **Slack is the first OUTBOUND boundary; what may cross is decided by a
   type, not by care.** A channel is a third party (its own retention, search,
   export, membership) — a value safe in `audit_log` is not thereby safe
   there. The seam is **`slackLinesOf`** (`lib/slackNotify.ts`), fed from the
   `waitUntil` in `middleware/audit.ts` on its own promise beside `writeAudit`.
   Two mechanisms, neither a rule to remember: `FORMATTERS` is a curated
   `Partial<Record<AuditAction, …>>` — no entry sends nothing, including for
   actions added next year (`satisfies` catches misspellings); and a
   formatter's input type has **no `detail` field at all** — there is nothing
   to forward (`calendar.source.created` puts a possibly-secret feed url in
   `detail`; invariant 12). What a formatter may say comes from
   **`AuditDraft.notify`**, filled by hand at the push site — scalars only,
   never persisted (`chainHash`/`writeAudit` don't read it; no column). A
   formatter that wants a NAME uses **`personLabel`**, which composes
   `personListableSql(NO_VIEWER, false)` — an unlisted Person renders as
   "A member", identically to a nonexistent one (or the channel becomes an
   oracle); `filled` still counts them (invariant 13).
   **Know the scan's blind spot**: `personListableSql(x, true)` short-circuits
   to the literal `"1"` — reads like a guard, gates nothing; two independent
   designs made exactly that mistake. `test/slackNotify.test.ts` is therefore
   behavioural (fake D1 honours the predicate), and also asserts an invented
   future action sends nothing, excluded actions send nothing, and
   `detail.url` never appears in a line.
   **Wanting a richer message must never move the push.** A draft is pushed
   the moment its write commits; anything a later read supplies is merged into
   `notify` afterwards, in place (`routes/volunteers.ts` is the worked
   example). Pushing after the read is wrong: the read can fail, and Hono's
   `compose` + `onError` turns a thrown handler into a response at that frame,
   so `auditMiddleware` still flushes whatever was pushed — pushing early
   genuinely saves the record. `test/volunteerSignupAudit.test.ts` fails on
   reorder. Delivery is fire-and-forget, coalesced to ONE post per request, no
   outbox/retry/cron (a dropped message is cosmetic; a dropped audit row
   isn't). `SLACK_WEBHOOK_URL` is a secret, absent-means-off (message logged,
   like the unconfigured mail channel), never logged even on failure.
   **Curate by counting, not reasoning** — the first allowlist excluded
   authoring CRUD on a per-request-noise theory and would have posted ~4
   messages a month. Before narrowing on a noise argument:
   `SELECT action, COUNT(*) FROM audit_log WHERE created_at > date('now','-30 day') GROUP BY action`.
   What stays out: routine member field edits (`person.updated`, `contact.*`,
   `share.*`), `auth.signin`/`auth.signout` (arrival, not existence —
   `auth.registered` is the one arrival and is on), `newsletter.issue.updated`
   (invariant 5). `control.granted` returns null when `notify.self` (22 of 22
   real grants were self-grants; it speaks only for a second parent by
   invitation). `auth.registered` has a null actor by construction and is
   pushed at the INSERT; `person.created` is NOT pushed by `bulkImport.ts`
   (`bulk.import` reports the batch). `admin.action` speaks twelve of ~17 ops;
   the rest fall through its switch's default.

23. **A newsletter is translated by linking out, never by us — and only its
   PUBLIC page may be linked.** The seam is
   `packages/shared/src/newsletterTranslate.ts` — an outbound boundary in
   invariant 22's sense, where the URL itself is what crosses (Google's proxy
   fetches it). A sent issue's archive page is already public (invariant 10),
   so nothing crosses that wasn't — which is why **a review-token url may
   never appear in one** (the token is a revocable authorization; a caching
   proxy outlives revocation). `renderNewsletterIssuePageHtml` takes
   `issueUrl` REQUIRED (a fifth issue-page route must state its answer);
   exactly one surface passes a value: `/n/:slug`. Prints and previews pass
   `""`. `translateProxyUrl` refuses by construction: not-https, a port,
   credentials, a dotless host, a relative path all return null.
   **Email and page carry DIFFERENT link forms, deliberately.** The email gets
   `?lang=xx` on our origin (a mailed link is permanent; naming
   `translate.goog` in it pins us to Google's url scheme forever); the
   redirect lives in `apps/newsletter/functions/n/[slug].ts` — the one place
   the service is chosen. The PAGE names the proxy outright, because Google's
   fetcher forwards a proxied page's query string verbatim (measured) — a
   `?lang=` link clicked inside the proxy would loop. Inside the proxy no href
   we write survives (Google rewrites all of them, and wraps external ones in
   a redirector that refuses to proxy itself), so in-proxy switching is
   `PROXY_LANGUAGE_SWITCH_JS`, re-deriving each link from `location` with
   ABSOLUTE urls; off `*.translate.goog` it does nothing.
   The bar emits **no copy** — its links are the language names from
   `localeNames`, each in its own language (hardcoded English would be
   legible only to the readers who least need it). Adding a locale adds a link
   for free; `PROXY_LANG` restates each code (the proxy names the script,
   `zh-CN`). `test/newsletterTranslate.test.ts` pins the exclusions — its last
   case asserts a token url WOULD produce a link, so the `""` at the call
   sites is understood as a guard.

24. **A duplicate child is an onboarding bug, not a matching problem — the fix
   is a JOIN path, never a name lookup.** A create-time "a Milo Ruiz already
   exists — yours?" check is FORBIDDEN: it is invariant 18's oracle one URL
   along, lets any member enumerate children by first name, confirms initialed
   surnames, and surfaces unlisted Persons. Do not build it.
   The actual bug: `bindInvite` granted control of the invitee's own Person
   only, so a second parent controlled a household MEMBER but not an ADMIN;
   `GET /me/households` filters `is_admin = 1`, `ensureHousehold` found
   nothing, and their first "add a child" founded a second household.
   **Migration 0021 puts `group_id` on `control_invite` AND `auth_token`**
   (neither reaches the other cheaply; callback resolves by `token_hash`
   alone). When set, accepting grants control of every Person in that
   household the INVITER controls — an `INSERT … SELECT` evaluated at accept
   time, not frozen at send (a child added in between should be included);
   reads `membership × control`, never `person` (the invitee is becoming a
   Controller, one of the gate's two admitted audiences) — promotes the
   invitee's membership to admin and carries `household_admin`. **Opt-in per
   call site** (`householdId` in the body, a checkbox on the partner form):
   "help me manage this one child" — a grandparent, the school nurse — must
   not quietly become "see my whole family". The wizard's family step renders
   who is already in the household (same gated `GET /groups/:id` roster, shown
   at the moment it decides something). `test/inviteHousehold.test.ts`.

25. **Removing a Person is permanent; sole control is the test.**
   `DELETE /persons/:id` is the one destructive act an ordinary member may
   perform; no tombstone. **Sole control, not authorship** — `control` is
   many-to-many; keying on `granted_by` would be wrong in both directions.
   Second refusal: a household the Person solely administers that still has
   other members (removing them leaves a group nobody can edit); a household
   they alone occupy is deleted with them. **Count before removing**:
   `GET /persons/:id/removal-impact` is its own route (a profile view
   shouldn't pay for six counts), and the DELETE re-runs the helper rather
   than trusting the client (a second Controller may have appeared). The
   cascade is children-first and includes an unconsumed **`auth_token`** aimed
   at the Person (a live capability pointing at nothing; `/auth/callback`
   creates users for non-`signin` kinds). Groups are the school's and stay.
   **`audit_log` is never touched.** The audit row carries the NAME in
   `detail` — in a second, nothing else will hold it — and that is why
   `person.deleted` has **no Slack formatter**: `personLabel`'s gated row is
   gone by flush time, so the only way to name them would be forwarding the
   ungated draft. Silence is the default `FORMATTERS` already gives.
   `test/personRemoval.test.ts` pins guards, cascade order, and both.

26. **A store order names a BUYER, not a Person — nothing in the store's
   schema may join `person`.** `store_order` captures shipping name/address/
   email typed fresh at checkout; nullable `user_id` for "my orders"; no
   `person` link. The outbound payloads — `PrintfulOrderRequest`
   (`lib/printful.ts`), `CheckoutSessionRequest` (`lib/stripe.ts`) — are
   hand-shaped from `store_order` columns only, with no field wide enough to
   carry a Person row (invariant 22's defence; Printful and Stripe are third
   parties in exactly that sense). The `store.order.paid` Slack line: total,
   item count, town — never a name, street or email.
   **Money correctness rests on three things, none a client's word**:
   `store_product` is the only place a price is read, per VARIANT; a **quote**
   freezes computed lines, a live Printful shipping rate and a total
   server-side before Stripe (hosted Checkout can't price shipping from an
   address, which is why the cart collects the address FIRST and the Session
   sets `shipping_address_collection` off); and
   `total_cents = subtotal_cents + shipping_cents` is a CHECK constraint.
   The quote is an **HMAC-signed token, not a row** (`lib/storeQuote.ts`):
   single-use, 30 minutes, one consumer; `sha256` won't do because the
   attacker controls the plaintext. `STORE_SECRET` keys it and is the ONE
   optional secret that does not degrade to logging — a guessable quote key is
   a guessable PRICE; the dev fallback exists only while `STRIPE_SECRET_KEY`
   is also absent. It also keys the derived order-status token (derived, not
   random, so the webhook-built confirmation email can rebuild the link while
   only the hash is stored).
   **`checkout.session.completed` is not proof money moved**: delayed methods
   (ACH, vouchers) fire it with `payment_status: "unpaid"` and settle days
   later or never, and `createCheckoutSession` doesn't restrict
   `payment_method_types`, so that path is one dashboard toggle from live.
   `routes/storeWebhooks.ts` gates `completed` on `payment_status`, fulfils
   delayed orders only on `async_payment_succeeded`, closes on
   `async_payment_failed` (no new state — such an order never left
   `awaiting_payment`). `test/storeWebhook.test.ts` pins all three at the
   route (invisible in a card-only test account).
   **Every state transition is a CAS on `status`** — that IS the idempotency:
   a redelivered Stripe event finds `paid` and changes nothing; a redelivered
   shipment finds `shipped` and mails nobody twice. No processed-event ledger
   because there is no read to race. The order row is minted BEFORE payment
   (minting from the webhook risks money taken with nothing here aware);
   `submitOrder`'s claim stops the inline `waitUntil` and the `*/15` cron
   double-printing. "Paid but not submitted" is just `status = 'paid'`; the
   cron makes it self-healing.
   **The storefront is indexed surface #2**: robots.txt, sitemap, `hreflang`
   honoured server-side (`functions/_lib/locale.ts`), nothing member-private.
   `publicProductOf` / `orderStatusOf` are the seams; both Printful ids stay
   server-side (re-pointing the catalog at the PTO's Printful is an admin
   re-point, not a migration). `test/storePublicProjection.test.ts` pins key
   sets; `test/storeCheckout.test.ts` pins quote, webhook signature, CAS.
   **Vendor hookup is a documented procedure**: `apps/store/SETUP.md` (token
   scopes, the four Stripe webhook events, `STORE_SECRET`-before-
   `STRIPE_SECRET_KEY` ordering, the DNS record Pages doesn't create; written
   to be run twice — personal accounts now, the PTO's later).

27. **A parent may edit ONE roster without administering it; `self_asserted`
   is what makes that safe.** `POST /groups/:id/members` stays behind
   `requireGroupAdmin`. `PUT /persons/:id/classroom` (+ DELETE twin) is a
   narrower door on `isController` — it exists because most classrooms have NO
   admin (teachers aren't Persons here), so without it a system admin places
   all 300 children. Keyed on the person, not the group: that's where the
   authority and the single-valued rule live.
   **The containment is `self_asserted` (migration 0023), not a cap.** Joining
   a group widens `viewerIsDirectMember` (the room's private contacts/address)
   and `effectiveGroupIdsForPerson` → `viewerGroupIds` (items shared with the
   room). The first design — "require `student`, cap at one room" — was rotten
   on both legs: `student` is self-mintable (`ASSIGNABLE_CAPABILITIES`,
   `POST /me/persons` asks nobody), and a cap on simultaneous membership
   bounds nothing when reading is a repeatable GET (walk one Person through
   all 34 rooms one PUT at a time). So: a weaker membership — the row carries
   `self_asserted = 1`, which puts the child ON the roster (the point, and
   free: any member can already read every roster) while both readers above
   SKIP it. Being on a list and being trusted by it part ways at that column.
   Both widened surfaces were empty when this shipped; don't read that as
   licence to reopen. `test/groupMembers.test.ts` pins the withholding
   behaviourally (reads a private contact back through the route both ways).
   **`student` is required** (a roster keeps meaning "the children in this
   room" — legibility, not confinement). **An `is_admin = 1` membership is
   never touched**: the route refuses if the Person holds one AND scopes every
   DELETE to `is_admin = 0`. `title`/`is_admin` are SQL literals — no body can
   mint either. **The one-room delete re-derives its set inside the batch**
   (`kind='classroom' AND is_admin=0 AND group_id <> ?`) — naming ids read a
   moment earlier is a read-then-write two concurrent PUTs break. **The DELETE
   names its room** (`?groupId=`) and removes only that one — a child can
   legitimately hold several classroom memberships (`bulkImport` defaults
   `groupKind: "classroom"`), and the UI says "remove from THIS class";
   `ClassroomCandidateDTO.currentClassrooms` is a LIST because a placement
   moves the child out of all of them.
   A move is **one `classroom.enrolled` row** carrying the room left behind in
   `detail` (`membership` keeps no history). Re-sending the same placement
   writes nothing and pushes no draft (an append-only log must not be paddable
   by a double tap). Neither action is Slack-curated (routine; ~once per child
   per year). The UI reads **`viewerEnrollable`** on `GroupDetailDTO` —
   field-by-field, classrooms only, composes `personListableSql` (a guarded
   read costs nothing; an exemption would spend budget to say "trust the
   join"), assembled from TWO queries in memory, and deliberately NOT gated on
   `viewerCanManageMembers` (different authorities, separate buttons).
   `test/classroomPlacement.test.ts` pins the literal, the race-free delete,
   the room-scoped removal, both halves of the admin guard, the silent no-op.

28. **The PTO's boards have no public half, and that absence is the design.**
   No `/pto-public/*` router, no `publicBoardOf`, no `Public*DTO` for any
   `pto_*` table — boards carry vendor notes, money and half-finished
   opinions, and the cheapest guarantee is that the seam doesn't exist. If a
   public surface is ever wanted, it is a hand-written projection like its
   four siblings (start from migration 0024's header and the PTO section of
   `types.ts`). The app's own public pages are INDEXED (surface #3); the
   landing page reads only the anonymous projections, for its volunteer block
   (`/calendar-public/events` + `/volunteers-public/sheets/:slug` — counts,
   never names), every failure hiding the block
   (`apps/pto/functions/_lib/volunteers.ts`); `/resource-center` reads
   NOTHING. Board data is unreachable from any Function.
   **The gate is `ptoAccess`** (`lib/ptoBoard.ts`) via `requirePto` on every
   route in `routes/pto.ts`, reads included. System admin always in; everyone
   else iff a Person they control sits on the roster of the
   `pto_board_group_id` group (plain `generic` group — no second membership
   model) **with `self_asserted = 0`** (can't be violated today — only
   classrooms self-assert — which is exactly why it was cheap to write before
   the day that door widens). No group configured → admins only; that is the
   bootstrap, not a hole. `GET /pto/access` is the one route OUTSIDE the gate
   and must stay there (a refused member needs an answer, not a spinner).
   **Names go through `ptoRosterOf`**, composing `personListableSql`
   (invariant 21; no exemption spent). A withheld assignee renders as a
   generic label, never dropped — `personLabel`'s answer, for both reasons
   (oracle; a claimed card must not advertise as unclaimed). `ptoAccess` and
   `setAssignees` read `membership` + `control`, never `person` — board
   membership is AUTHORIZATION; the enumeration gate there would make an
   unlisted board member un-assignable by people who can see them.
   **`position` is a REAL and a move is last-write-wins** — the one place
   that's the right answer: a drag is one `UPDATE` at the midpoint of its new
   neighbours (a renumber is a read-then-write over N rows that two drags
   scramble); nothing is over-committed by losing a drag race, and a CAS would
   snap a card back under someone's cursor. Re-dropping a card where it sits
   writes nothing and pushes no draft. **No `pto.*` action is Slack-curated**
   (cards move several times a day; `FORMATTERS`' default).
   `test/ptoAccess.test.ts` is behavioural (a `"1"` guard fails with a real
   name); `test/ptoRoutes.test.ts` pins that every route asks the gate.

29. **A backup deliberately does NOT narrow; the restore deliberately does not
   touch everything.** `GET /admin/backup` dumps the whole DB as JSON;
   `POST /admin/restore` reads one back; `lib/backup.ts` is both halves and
   its header is the long version.
   **The default is include; the seam is an EXCLUDED list.** Every other
   outbound shape is hand-built so an unremembered column reaches nobody; a
   backup inverts that, because there the unremembered column is one MISSING
   from the file, discovered on restore day. Tables are discovered from
   `sqlite_master`; the reviewable list is what's left out. The file holds
   `geo_lat`/`geo_lng` and every `private` contact item — it is the directory,
   not a view of it (stripped coordinates would silently turn neighbour
   discovery off on restore). Controls are elsewhere: system admin only, never
   masquerading, audited, Slack-announced.
   **`EXCLUDED_TABLES` is exactly `lib/sweep.ts`'s six**: four hold a live
   capability (`session.id` IS the cookie value in the clear — a file holding
   it signs its holder in as anyone; `auth_token`/`newsletter_confirmation`/
   `control_invite` store hashes but restoring one resurrects a SPENT
   capability, defeating single-use); `read_budget`/`ai_budget` are rate
   counters a restore would only reset. Two also back security-parameter caps.
   Consequences: pending invitations are re-sent, and every current session
   survives — the restoring admin stays signed in.
   **`audit_log` is exported and never written back**
   (`RESTORE_SKIPPED_TABLES`): a restore that emptied it would break the chain
   AND erase the record of the restore. The chain runs continuously across a
   restore, and that draft is pushed BEFORE the write — the one deliberate
   departure from invariant 22's ordering, because a restore that dies halfway
   has still destroyed data and the row is what explains the state.
   **Three refusals, all in `planRestore`, all before the first DELETE**: a
   table/column the live schema lacks (schema drift; identifiers can't be
   bound, so also the injection guard); a live table the file doesn't mention
   (`"x": []` to mean empty on purpose); no enabled system admin in the file
   (invariant 17's last-admin guard from the other direction — not being in it
   yourself is a warning, since sessions survive). Dry run is the default
   (`dryRun !== false`); a real restore needs `confirm: "RESTORE"`.
   **The executor is shaped by D1 enforcing FKs** (the naive
   empty-then-insert failed its first real DELETE): `runRestore` leads every
   batch with `PRAGMA defer_foreign_keys = true`; orders inserts parents-first
   (`restoreOrder` from `sqlite_master` REFERENCES; `parentFirst` within
   self-referencing `grp`); and **never empties a table an EXCLUDED table
   points at** — `user`, `person`, `grp` (`keptAliveTables`, closed under
   REFERENCES) are UPSERTED with `INSERT OR REPLACE` then TRIMMED by id in
   chunks of 100 (D1's bind limit), each chunk's batch first deleting the
   excluded rows that point at stale ids (where a not-in-file account's
   session ends). Limits: **D1 only** — R2 objects have to exist, so a fresh
   bucket means broken portraits, not a corrupt directory; and `readTable`
   interpolates the table name (the invariant-21 scan's blind spot), so its
   `UNLISTED-EXEMPT` note lives there — composing the gate would omit unlisted
   Persons from the file and the restore would DELETE those families.
   `test/backup.test.ts` is behavioural: its fake D1 records statements where
   they EXECUTE, batches included; the end-to-end check is `wrangler dev`
   against local D1.

30. **A bulk import's email column names an ACCOUNT, not a contact — and the
   import can mint that account.** Default: a row whose email has no account
   gets a pending `control_invite` (mailed only with `sendInvites`) — right
   for a family roster (the parent decides what the profile shows), wrong for
   a staff roster (`/auth/callback` binds an invite only from its token, so a
   teacher using "Email me a link" got an empty account or, with registration
   closed, nothing). `createAccounts` (`BulkImportOptions`,
   `lib/bulkImport.ts`) writes the `user` row like `POST /admin/users`
   (`joined_via 'admin'`, nothing sent) and attaches the Person; no invite
   exists in that mode, so the two options are alternatives. Either mode
   ADOPTS a Person left waiting by an earlier invite-mode import when the
   address now has an account. Two separate knobs: `contactVisibility`
   (default `private`, invariant 3 — an explicit per-import choice, never a
   new default) and `emailAsContact` (off — on a family roster that column is
   the parent's address and must not land on a child's profile).
   `test/bulkImportAccounts.test.ts` is behavioural.

31. **Newsletter authoring is gated by a roster, and the roster gate is ONE
   function.** `newsletterAccess` (`lib/newsletter.ts`) is `rosterAccess`
   (`lib/rosterGate.ts`) keyed on `newsletter_editor_group_id`; `ptoAccess` is
   the same function keyed on `pto_board_group_id`. Shared rather than copied
   because the clause worth defending — `self_asserted = 0` — is exactly what
   a second copy forgets. System admin always in; else a controlled Person on
   the named `generic` group's roster; no group named → admins only. Two
   committees, two keys (a shared one makes every board member an editor).
   **Two gates in `routes/newsletter.ts`**: `requireEditor` covers everything
   about ISSUES — list, draft, preview, review links, test sends, **send**
   (an editor who can't send needs an admin summoned every issue, the workflow
   this ends), retry, image upload — plus READING the settings blob (the
   composer needs it; it holds nothing an issue's email doesn't print).
   `isSystemAdmin` keeps settings writes, the subscriber list, and
   `PUT /newsletter/editors` itself (audited
   `newsletter.editors.configured`, Slack-silent). `GET /newsletter/access`
   stays outside both, for `GET /pto/access`'s reason. The app mirrors it
   (`RequireEditor` / `RequireAdmin`, `lib/access.tsx` copied from the PTO
   app). `test/newsletterAccess.test.ts` enumerates every route by hand and
   pins which gate each asks — a route added to the file and not the list is
   what nothing else will notice.

32. **Reading the directory is GRANTED, not conferred by signing up.**
   Migration 0029 adds `user.access_approved_at` (non-null IS the
   authorization); `AuthContext.isApproved` rides the session join.
   **Approval alone no longer opens the directory — reading is RECIPROCAL.**
   `isApproved` is now approval AND at least one contact item contributed by
   the family (`hasContactInfoSql` in `lib/directoryAccess.ts` — any Person
   the account controls, or their household; visibility deliberately not
   consulted, since requiring `service` would make invariant 3's
   privacy-first default fail the gate). System admins are exempt (theirs is
   administration, not browsing); the predicate rides the middleware's
   existing active-person read, so the combined gate still costs no round
   trip. The application form requires it too (`accessClaimStatus`,
   `accessNeedContact`), or a family would clear review and still meet a
   locked directory; an already-approved account that never entered contact
   info (or deletes its last item) re-closes on its next request, and
   `MeDTO.hasContactInfo` is how the app says "add contact info" instead of
   re-showing the form. Section 8 of `test/directoryAccess.test.ts` pins it
   through the real session middleware.
   **An application, not an allowlist**: an allowlist judges an EMAIL (which
   asserts nothing, and checking it would need the district's roster — FERPA
   obligations this system doesn't have); an application judges what the
   applicant TYPED — their name, their child, the room (picked from the
   classroom groups already here). It is not proof; it removes the ANONYMOUS
   population and gives attribution. Rate limiting is the other half.
   **Two seams.** `personListableSql` takes an `approved` argument: false
   resolves to the caller's OWN Persons — not `"1"`, and not the unlisted rule
   (true of almost every row; would leak the roster). Because
   `test/personListable.test.ts` already fails un-composed reads, every call
   site narrowed from one edit. `requireApproved` (`lib/directoryAccess.ts`)
   is a function called at the top of a handler, not path middleware — the
   routes aren't a prefix, and a prefix mount would lock a pending member out
   of their own family or silently not run. Five routes that don't read
   `person` name it explicitly: `GET /groups`, `GET /groups/:id`,
   `GET /photos/:key`, `GET /volunteers/sheets/:slug` (whose `positionsOf`
   still counts withheld names — invariant 13), and `GET /calendar/sources`
   (an imported feed's upstream URL may be a secret subscribe link —
   invariant 12's reason for mirroring it publicly).
   **Two routes deliberately survive the gate** (else a pending family is
   trapped in a form they can't finish): `GET /groups/:id` opens for a group
   one of their own Persons is on — the roster inside still narrowed by the
   predicate, so their child's classroom shows their own child, not 25
   families — and `GET /me/classroom-options` serves `kind='classroom'` id+name
   only (strictly less than the group-name search invariant 21 already
   grants). `GET /me` is outside the gate and reports the state (a refused
   member must be told why).
   **Approving does TWO things in ONE `batch()`**: sets the date AND promotes
   the applicant's classroom placements `self_asserted 1 → 0` — approval is
   the judgement the self-made placement lacked, so it starts counting for
   `rosterAccess` and `viewerIsDirectMember`. The promotion re-derives its set
   inside the batch (invariant 27's race). **Declining is reversible and
   quiet**: sets a date; calendar, newsletter, volunteering and their own
   family all keep working; approving later clears it; the common decline is
   "couldn't find your child in that room" and the answer is a corrected
   room. `screens/Access.tsx` never says "denied"; unmet conditions link to
   the screens that fix them.
   **One path to approval is vouching**: accepting a household invitation from
   an approved member (`bindInvite`) — and **`group_id` is the whole of what
   makes it safe**. A bare co-controller invite from
   `POST /persons/:id/controllers` carries the same `kind`/`invited_by` but no
   `group_id`; an unconditional vouch would let any member hand a stranger the
   whole directory by inviting help with one child (invariant 24's rule one
   level up). The household invite's checkbox means the vouch matches a choice
   the inviter made. Enforced inside the UPDATE; only ever grants.
   Asking twice while pending, and a decision that changes nothing, write
   nothing and push no draft. **`access.requested` is the one Slack-curated
   action** and names nobody — the claim is the most sensitive thing here and
   belongs on the queue screen; structurally guaranteed: the three drafts
   carry ONE `notify` value, the boolean `resubmitted`. `access.approved`/
   `access.declined` stay silent (answers to a message the channel has;
   per-applicant noise). `test/slackNotify.test.ts` pins all three, including
   that `detail.resubmitted` alone can't change the wording.
   **Exemption budget moved 8 → 9**, once, for `accessClaimsFor` in
   `routes/admin.ts` (system-admin-only; `personListableSql` short-circuits an
   admin to `"1"`, so composing it would read as a guard gating nothing). The
   feature's other two `person` reads compose it.
   `test/directoryAccess.test.ts` is behavioural and pins the batch boundary,
   the promotion and both no-ops.
   **Two routes to a complete claim** — the school is not only parents:
   `complete = selfNamed && (isStaff || (hasStudent && studentPlaced))`, where
   `isStaff` = a controlled Person holding `teacher`/`staff`. Both are
   self-asserted and that is fine (this decides what a REVIEWER is shown,
   never what anyone may read). Staff are not asked for a classroom (the
   office and custodian have none; the note is where a teacher says which
   room). `AccessRequestDTO.roles` carries it so a teacher doesn't read as a
   parent who forgot their family.
   **The budget is the other half; neither substitutes.** `enforceReadRate`
   (same file): a `[[ratelimits]]` binding at 60/min, keyed on the USER (a
   family behind one NAT must not throttle itself), admin NOT exempt (theirs
   is the session worth stealing). Absent binding = off (the
   `SLACK_WEBHOOK_URL` contract); a throwing limiter ADMITS (refusing every
   read on a config slip
   takes the directory down). `/photos/:key` unlimited (a page fires 50 at
   once; keys are only learnable from a limited listing). **The minute window
   slows a crawl; the daily one bounds it**: `read_budget` (migration 0030)
   counts one row per account per UTC day — refused reads included, so
   retrying against the 429 spends the day — refusing past `DAILY_READ_LIMIT`
   (500) with `Retry-After`. Either limit posts ONE Slack line per account per
   day, claimed by guarded `UPDATE … WHERE alerted_at IS NULL`; deliberately
   outside `slackLinesOf` (a refused GET changed nothing, so it's not an audit
   action); it names the ACCOUNT by email and never whom they read. The
   counter shares the binding's switch.
   **The grandfathering in 0029** approves every account controlling a Person
   (66 of 76 here; without it the deploy locks out the school).
   `seed/dev-seed.sql` approves its users directly (the seed runs AFTER
   migrations).

33. **Lost & found: the item is public; a NAME written on it is not — and
   neither is the photo until somebody has looked.**
   `lostandfound.eisenhower.school` (apps/lostandfound, routes/lostFound*.ts,
   lib/lostFound.ts, migration 0033): staff — and any signed-in member —
   photograph found items, a Workers AI vision model describes them, anyone may
   browse and claim. Four rules square that with `/privacy`:
   - **`visible_text` (ALL writing read off the item) and `name_text` (the
     person's name in it, migration 0038) are staff-only** (on a school water
     bottle the writing is a child's name). `publicItemOf` is the only builder
     of the public shape and reads neither; `scrubNames` cuts `name_text`'s
     words — and ONLY those — from title/description/tags (the prompt asks for
     names only in those two fields; asking a model is not a guarantee).
     Non-name writing stays on purpose: the first scrub cut every word read,
     and a brand on a hoodie ("NIKE") vanished from its description and
     search, so parents couldn't find their children's clothing (2026-10).
     What makes the narrower scrub safe is the HOLD below, not the model's
     judgement — any writing at all still parks the item in front of staff
     before it is published. `test/lostFound.test.ts` pins the key set.
   - **The public search can't confirm a name**: `search_text` and the
     Vectorize embedding are built WITHOUT `visible_text` and `name_text`
     (invariant 18 — "does any item say Milo?" is the oracle invariant 24
     forbids).
   - **Every item starts HELD** (`held_at` on insert). The model releases only
     when it read NO writing; writing, a failure, or no AI binding leaves it
     held until staff Publish (`lostfound.item.published`) — the PHOTO can
     show a name no text field does. The public gate is `LISTED` in
     `lib/lostFound.ts`, in SQL: found, not hidden, not held. A staff save
     never moves the hold; the model's write is guarded on
     `tag_status = 'pending'` so staff edits win.
     **Submitting is open to any session; publishing is not.** `POST /items` +
     the creator's own thumbnail PUT need only a session (`/submit` in the app,
     translated, unlike the staff screens) — and the thumbnail PUT only while
     the item is still HELD and PENDING, because the thumbnail is the public
     grid's image: past that window a creator's swap would put an unreviewed
     picture online, so only the roster touches a live item's images. A non-staff creation is flagged
     `member_submitted` (migration 0037) and the model NEVER releases its hold
     — reading no writing proves nothing about a photo a non-staff member
     chose — so it waits in the review queue until staff Publish; the flag is
     a column, not a request-time check, because `retagStuck` re-describes
     from the cron with no session in sight. There is deliberately NO
     per-member item cap (`MEMBER_ITEMS_PER_DAY`, 25/day, shipped first and
     cut a parent off mid-rack, 2026-10): the HOLD is the gate — nothing a
     member submits reaches the web until staff Publish — and a runaway
     account's spend is a pile of held items in front of staff, deletable
     from the review queue. The staff-verified email intake stays unflagged.
   - **The claim form is anonymous and bounded like invariant 14**: `website`
     honeypot; 3/day per contact, 10 open per item, 50/day instance-wide,
     counted from `lf_claim` rows; the SAME `{ ok: true }` for stored,
     suppressed, capped and unlisted. Claimant details never reach `detail`
     (audit rows are forever; claims aren't) or Slack —
     `lostfound.claim.created` is the only curated action and names nothing.
   - **Returning an item answers the claimant** (migration 0044): staff mark an
     item returned AGAINST a claim (`POST /lostfound/claims/:id/return`),
     saying how it went home (classroom / office / family); an email-shaped
     contact is then mailed ONE message — `lostFoundReturnMessage` in
     `packages/shared/src/lostFoundReturn.ts`, rendered in the language the
     claim form was filled in (`lf_claim.lang`, bucketed to LOCALES on write)
     and naming the item and the school, NEVER a child (the address was typed
     free-hand; a typo must not deliver a child's name to a stranger). The
     SAME builder feeds the dashboard's prefilled `sms:`/copy message for
     phone contacts, so the automatic and manual messages can't drift. The
     send is a CAS on `notified_at` (`reminder_sent_at`'s pattern); a failed
     send releases its own claim, matched by value.
     `lostfound.claim.return_notified` carries item id + method only and is
     Slack-silent. A DISMISSED claim is refused (409) — staff judged that
     person not the owner; every response counts the item's OTHER open claims
     (the return settles them messageless, and the dashboard says someone is
     still waiting to hear); a mail channel that is off answers `channel_off`,
     never "emailed them" about a logged message. The claim form PREFILLS: a
     signed-in member's account email (recorded as `contact_verified` when the
     typed contact matches, never while masquerading — a chip for staff,
     granting and gating nothing), else what this device last submitted
     (localStorage, written only KNOWN signed-out; `lib/claimDraft.ts`).
   Staff are a ROSTER (`lostfound_staff_group_id`, `rosterAccess` — invariant
   31), never the self-assertable `staff` capability. Photos live in
   `LOSTFOUND_MEDIA`, its own bucket behind a public route, so it can never
   reach `PHOTOS` (invariant 20). Retention rides the daily cron: returned
   items + photos/vector/claims after 30 days, settled claims after 60, failed
   descriptions retried. **No FTS5**: `lib/backup.ts` discovers tables from
   `sqlite_master` and FTS5 shadow tables don't round-trip; LIKE over
   `search_text` + Vectorize is plenty at school scale. AI and Vectorize are
   optional absent-means-off bindings. The model SUGGESTS orientation
   (`suggested_rotation`, migration 0035) and never applies it (a Worker has
   no canvas; a wrong guess turns a good photo sideways); staff apply with one
   tap and the browser re-encodes under a FRESH R2 key (both media routes
   cache for an hour — overwriting a key keeps serving the old orientation).
   **The model also suggests a square CROP** (`crop_x/y/w/h`, migration 0046),
   display-only: the photo is never cut, the grid tile (`CropImage`) just looks
   at that rectangle. Stored as fractions of the image, square in PIXELS
   (`cleanCrop` turns the model's centre+size into it, reading the JPEG header
   for dimensions), so a client needs no aspect ratio. It is geometry, so it is
   in `publicItemOf` on purpose. Rotating a photo turns the rectangle with it
   (`PUT …/photo?turn=`, `turnCrop`); a replacement with no `turn` clears it.
   `POST/DELETE /lostfound/items/:id/crop` are the edit page's "crop with AI"
   and "clear crop".
   **Photos also arrive by EMAIL**: Email Routing hands
   `found@sitemail.eisenhower.school` to the Worker's `email` handler
   (`src/email.ts` → `lib/lostFoundEmail.ts`). The ENVELOPE sender must be an
   enabled account on the SAME staff roster, refused at SMTP time BEFORE the
   body is parsed (a stranger costs one indexed read, not a 25 MiB MIME
   parse), never bounced. An explicit SPF/DKIM/DMARC *fail* is rejected;
   softer verdicts ADMIT, deliberately — the hold bounds a forgery to a held
   photo in front of staff, and what forgery taints is ATTRIBUTION, so each
   item's audit `detail` records the DMARC verdict it arrived under
   (tightening to require `dmarc=pass` is a one-line change, documented at
   `authFailed`). Each JPEG attachment (`isJpegBytes` + `MAX_PHOTO_BYTES`,
   shared with the upload route; ≤10/message, overflow reported as
   resendable) becomes an item that starts HELD like every other; the subject
   is the `location`; one attachment's storage failure is counted and
   reported, never thrown past a created item (a throw loses its audit draft
   AND makes the MTA redeliver, duplicating it — the intake throws only when
   nothing was created). The confirmation reply (counts + queue link, never
   message content) goes only to the verified staff address, is marked
   `Auto-Submitted: auto-replied`, and is withheld from machine-generated
   mail (`isAutoGenerated`) — both halves of the mail-loop guard. Audit
   drafts flush through the same `writeAudit` the middleware uses
   (`userAgent: "email-intake"`). The optional `IMAGES` binding makes the
   thumbnail a browser canvas would have; absent, the model reads the full
   photo (`tagItem`'s `photo_key` fallback, which is also why `retagStuck` no
   longer requires a thumbnail). Routing setup is BY HAND, like Pages custom
   domains — `apps/api/EMAIL-INTAKE.md`. **The same handler serves the plain
   forwarding aliases** (`admin@`, `pto@` — `lib/emailForward.ts`): an Email
   Routing RULE forwards to at most one verified destination, so
   multi-recipient aliases route to the Worker and fan out via
   `message.forward()`, skipping (never aborting on) a destination that
   hasn't verified. The map is the `EMAIL_FORWARDS` SECRET, never a
   wrangler var — the repo is public and the values are board members'
   personal addresses. Aliases get none of the intake's gauntlet (a
   forwarding alias behaves like a plain rule). **App mail rides the
   `sitemail.eisenhower.school` subdomain, both directions** (moved off the
   apex 2026-10-25; the apex MX is the SCHOOL's, going to Google Workspace —
   ForwardMX retired 2026-10-22 before that). No catch-all by choice —
   unconfigured addresses bounce. Cutover checklist and all routing/sending
   setup: `apps/api/EMAIL-INTAKE.md`.
   **`/privacy` changed first** (its own rule): the lost & found block and the
   Workers AI line, all four languages.

34. **Newsletter readership is a TALLY, never a visit log.** Migration 0042's
   two tables (`newsletter_issue_view`, `newsletter_issue_click`) hold counts
   per issue × school-local day × language / destination HOST — no row per
   reader, no IP/UA/cookie/member id anywhere in the schema, so a "who read
   it" can never be served because it is never held. The count comes from an
   inline beacon on the PUBLISHED issue page only (`viewBeacon` in
   `apps/newsletter/functions/_lib/page.ts`, keyed on `issueUrl` — print and
   review-token pages stay dark), because the page is edge-cached and counting
   server renders would miss most readers; it is also how TRANSLATED reads are
   seen at all (the script runs inside `translate.goog` and reads `_x_tr_tl`).
   The write path is `POST /newsletter-public/issues/:slug/view`
   (`lib/newsletterMetrics.ts`): the body is bucketed, never stored — `lang`
   to LOCALES+`other`, a click `href` to a parsed hostname with proxy hosts
   decoded back, new destinations capped per issue per day — so the beacon's
   word bounds nothing and the tables can't be grown by a script. The response
   is `{ ok: true }` for published, draft and missing slugs alike (invariant
   10's gate, restated for a POST), and the write pushes NO audit draft
   (`read_budget`'s reasoning — a counter bump is not a member action).
   `GET /newsletter/metrics` is `requireEditor` (the numbers describe the
   editors' own work and hold nothing the subscriber list does); the screen is
   `apps/newsletter/src/screens/Metrics.tsx`. The drafts-only issue DELETE
   clears both counter tables inside its batch, each child DELETE carrying the
   same draft-and-unpublished guard as a subquery — D1 enforces the
   REFERENCES, and an issue can be published, viewed, then unpublished back
   into a deletable draft. `/privacy` deliberately did NOT change: nothing new
   reaches a third party, and what we hold is strictly less than the zone-wide
   Cloudflare counting the page already names. Email opens are deliberately
   not tracked — no pixel, ever; the numbers are a floor and the screen says
   so. `test/newsletterMetrics.test.ts` pins the oracle posture, the
   bucketing, the school-local day and the delete cleanup.

35. **An event photo-album link is a capability, so it lives in its own table
   and is read by members only.** `event_album` (migration 0045) is keyed on the
   durable `(managed_event_id, occurrence_start)` pair (invariant 8), one album
   per OCCURRENCE. It is deliberately NOT a field on `CalendarEventDTO` (that
   type also feeds the agenda and the newsletter's frozen snapshots) and never
   reaches `publicEventOf`; the only readers are `GET /calendar/events/:date/:slug/album`
   and `GET /calendar/albums`, both `requireAuth`. Nothing talks to Google: the
   Photos Library API stopped sharing app-created albums (403, 2025-03-31), so a
   PTO admin makes the collaborative album by hand and pastes the share link
   (`PUT /admin/managed-events/:id/album`, held to https on `ALBUM_HOSTS` by
   `normalizeAlbumUrl`). The URL never goes in an audit `detail` or Slack
   `notify` (`calendar.album.set`/`.cleared` carry the date only). The list
   screen exists because `calendar_event` forgets an occurrence ~2 days after it
   ends — the page that holds the link would otherwise vanish when the photos
   exist — and for the same reason a NEW album can be added only while its date
   is still on the agenda (replace/clear always work). The two delete cascades
   remove `event_album` FIRST (FK to `managed_event`; their `res[]` indices
   shifted by one). `test/eventAlbums.test.ts`.

## Conventions

- TypeScript strict everywhere. `verbatimModuleSyntax` — `import type` for
  type-only imports, `.js` extensions on relative imports.
- D1 is raw prepared statements. `.bind()`, never string-interpolated values.
- Design tokens are CSS variables under `.sd`;
  `apps/web/src/styles/tokens.css` is the source of truth, the other five
  apps hold copies (see "Six front ends, one API").
- **Every clock time is 12-hour with AM/PM** — `CLOCK` / `formatClock` /
  `formatClockRange` in `packages/shared/src/clock.ts`. Written against
  `toLocaleTimeString`'s default, which follows the reader (24-hour for most
  locales); only the hour CYCLE is pinned — the locale still picks separator,
  numerals and day-period name, so no English lands on a Spanish page. Two
  deliberate exceptions, both `// CLOCK-EXEMPT:`: `toTimeInput` serializes
  `<input type="time">` (HTML defines the value as 24-hour; never use it for
  DISPLAY), and the zone-offset probes in `lib/calendar.ts` /
  `newsletterEvents.ts` set `h23` to read wall clocks as numbers.
  `test/clockFormat.test.ts` scans every `hour:` option and fails one that
  neither composes `CLOCK` nor says why.
- **Every timed event is read in the SCHOOL'S timezone, never the reader's.**
  One IANA zone, default `America/Chicago` (`DEFAULT_TIME_ZONE` in
  `packages/shared/src/timezone.ts`), set in FOUR places that must agree:
  `SCHOOL_TIMEZONE` in `apps/api`, `apps/home` and `apps/pto` wrangler.toml,
  and `VITE_SCHOOL_TIMEZONE` on the calendar build in `deploy.yml`. Always
  read through `resolveTimeZone` (a misspelled zone becomes the default, not
  a `RangeError`). In `apps/calendar` it is `SCHOOL_TIME_ZONE`
  (`lib/timezone.ts`) — day grouping, clock times, minted event paths, admin
  event and shift forms (an admin typing while travelling must store the
  school's 5:30 PM; the form used to read the browser zone). All-day events
  stay UTC (dates at UTC midnight). `apps/web`'s Home block and the PTO
  boards still use the reader's zone.
- Visibility chips: `members` (blue) / `private` (slate) / `shared` (orange).
  **No public state anywhere in the UI.**
- **Dark mode is `prefers-color-scheme` only** — no toggle, nothing persisted,
  in any app. It is a token re-declaration and nothing else: nothing outside
  the `@media` block knows which theme is on, so `var(--ink)` on
  `var(--paper)` is correct in both; anything broken hardcoded a colour. Know:
  **`--on-brand`** is why it works — text/icons on a brand fill use it (white
  in light, near-black in dark); never write `#fff` on a brand fill
  (exception: `.sd-avatar`, whose `avColor` palette is mid-dark in both,
  which is why `Avatar` picks by whether a colour was supplied).
  **`--blue-700`/`--blue-800`/`--orange-700`/`--orange-ink` INVERT** (they're
  foregrounds on a tint — backwards makes a chip's label vanish); `-tint`
  colours become deep low-chroma washes. **Some surfaces are dark in both
  themes and pinned to literals**: the landing `.join` band + its button,
  `.banner-offline`, the composer's `.nlx-block-preview` (it previews an
  EMAIL). **`@media print` restates the light values** (`NEWSLETTER_WEB_CSS`)
  and must stay BELOW the dark block — printing IS the PDF export (invariant
  16) and can't depend on the reader's theme; `test/newsletterIssuePage.test.ts`
  pins both. Contrast was measured (AA). A colour decision lands in NINE
  places: six `tokens.css` copies, the store's and PTO's
  `functions/_lib/styles.ts` subsets, and `apps/pto/src/styles/board.css`.
- **The mobile shell's one unskippable rule**: `.sd-app` is exactly `100dvh`;
  an `AppShell` screen must put scrolling content inside a `.sd-scroll` child
  (it carries the `min-height: 0`). Content placed directly in `AppShell` is
  clipped. **Corollary: an overlay may not live inside that scroller** —
  `SheetOver` portals every bottom sheet to `#sd-sheet-host` on `<body>` (all
  six copies), because a `position: fixed` child of `.sd-scroll` is clipped
  against the SCROLLER on iOS Safari (desktop looks fine; only a phone shows
  it). The host copies the app root's class list because the tokens live on
  `.sd` — portal without it and every `var(--…)` computes to nothing.

## Local dev

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local && pnpm db:seed:local
pnpm dev          # every app in apps/* with a dev script, in parallel:
                  # web :5173, calendar :5174, newsletter :5175, home :5176,
                  # store :5177, pto :5178, lostandfound :5179, bingo :5180,
                  # api :8787
pnpm dev:home     # just the apex landing page (wrangler dev) on :5176
```

`pnpm dev` is `pnpm --parallel --filter "./apps/*" dev` (picks up `apps/home`
too; `apps/redirect` has no dev script and is skipped).

Magic links print to the **API console** when the outbound channel is not
configured — locally that means no `BULK_EMAIL_FROM` var (production has both
halves of the Cloudflare channel; lib/email.ts; there is no fallback
channel) — so newsletter sends print there too. Demo login:
`dana@eisenhower.edu`.

`vite dev` serves only each SPA; the server-rendered public surfaces (the
newsletter archive, the storefront, the PTO pages) are Pages Functions and
exist only under `wrangler pages dev` and in production. To see one locally:

```bash
pnpm --filter @sd/pto exec wrangler pages dev --port 5178
```

(It reads `API_BASE` from that app's `wrangler.toml`, which points at the
PRODUCTION API — harmless, it only fetches the anonymous events feed; override
it to read your local calendar.)

Store vendor calls are off by default: no `PRINTFUL_API_KEY` /
`STRIPE_SECRET_KEY` means logged, not made — same contract as the mail
channel. `STORE_SECRET` is the one exception — invariant 26.

## When adding a migration

Create `apps/api/migrations/NNNN_description.sql` (next number). Update
`packages/shared/src/types.ts` if the wire shape changes. Re-run
`pnpm db:migrate:local`.

## Commit / PR

- Conventional-ish messages; one concern per commit.
- CI must pass `pnpm typecheck` and `pnpm test`.
- **Merging to `main` deploys to production**, and the deploy applies D1
  migrations to the live database first. `deploy.yml` gates on a `verify` job
  (typecheck + test + build) — but a migration that typechecks and still ruins
  data is not something that gate catches. A migration is the one change worth
  re-reading before merge.
- The Worker deploys (`api`, `redirect`, `home`) and the seven Pages projects
  (`school-directory`, `school-calendar`, `school-newsletter`, `school-store`,
  `school-pto`, `school-lostandfound`, `school-bingo`) ship from one workflow. A new front end
  means: an entry in its `pages` matrix, an origin in `ALLOWED_ORIGINS`, a line in the root
  `build` script (CI runs it, so an app missing from it never builds before it
  ships), and a Pages project + custom domain attached BY HAND — CI deploys to
  those, it does not create them.

# Email on sitemail.eisenhower.school — intake + forwarding aliases

The APPLICATION's mail — both directions — lives on the dedicated subdomain
**`sitemail.eisenhower.school`**. The apex's mail (`…@eisenhower.school`) is
the SCHOOL's, moving to Google Workspace: people-mailboxes and human aliases
belong there, and Google owning the apex MX means nothing of the app's can sit
on it. One subdomain, three jobs:

- **Inbound** (Cloudflare Email Routing, enabled per-subdomain on the zone):
  routed addresses point at the API Worker's `email` handler (`src/email.ts`).
- **Outbound — ALL of it** (Cloudflare Email Sending, since 2026-10-25):
  newsletter fan-out sends as `BULK_EMAIL_FROM =
  newsletter@sitemail.eisenhower.school` (wrangler.toml); transactional mail
  (magic links, invites, admin notifications, the intake's confirmation
  replies) keeps its own identity via the `EMAIL_FROM` secret — an address on
  the same onboarded domain sends as itself (lib/email.ts). There is NO
  fallback channel: half-unconfigured means mail is logged, not sent, which
  makes unsetting `BULK_EMAIL_FROM` the kill switch (if a newsletter fan-out
  is mid-flight, stop it first — logged sends report accepted, so its
  remaining rows would be marked 'sent' unmailed). Re-adopting any outside
  mail vendor means naming it on `/privacy`'s services list first.

The Worker's `email` handler does two jobs, keyed on the LOCAL PART only
(`forwardsFor` never looks at the domain, so the same handler served the apex
before the move and serves sitemail now):

- **Forwarding aliases**: fan out to the destinations named in the
  `EMAIL_FORWARDS` secret (`lib/emailForward.ts`). A Worker does this rather
  than plain routing rules because a rule forwards to at most ONE verified
  destination. The map is a SECRET, not a wrangler var — the repo is public
  and the values are board members' personal addresses.
- **Lost & found photo intake** (`found@sitemail.eisenhower.school`): each
  JPEG from a staff sender becomes a HELD item in the review queue
  (`lib/lostFoundEmail.ts`).

## The pieces (all account/zone config CI does not create)

1. **Email Routing enabled for the subdomain** — registered on the zone
   (dashboard: Email Routing → Settings → Subdomains; API:
   `POST /zones/:id/email/routing/dns {"name":"sitemail.eisenhower.school"}` —
   note `$CF_TOKEN` lacks that scope; wrangler's OAuth token has it). This
   mints the subdomain's own `route1-3.mx.cloudflare.net` MX + SPF records.
   Deliberately NO catch-all (and Email Routing doesn't offer one on a
   subdomain anyway): an address nobody configured bounces with a 550.
2. **Email Sending onboarded for the subdomain** —
   `npx wrangler email sending enable sitemail.eisenhower.school` (wrangler
   OAuth; done + verified by test send 2026-10-25). Auto-creates the
   `cf-bounce.sitemail` MX/SPF, the `cf-bounce._domainkey.sitemail` DKIM and a
   `_dmarc.sitemail` `p=reject` — all in the zone already.
3. **Destination addresses** (account-level): every address mail is forwarded
   TO must be created here, and its holder must click Cloudflare's
   verification email, or `forward()` to it throws (the handler skips it and
   delivers to the rest). Create one:
   ```
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/c3b373ae8a90a6494e520f962bdf462b/email/routing/addresses" \
     -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
     -d '{"email":"person@example.com"}'
   ```
   (Needs Account → Email Routing Addresses: Edit on the token.)
4. **Routing rules** (zone-level, needs Zone → Email Routing Rules: Edit):
   literal rules routing each address to the Worker
   `school-directory-api-production` (action type `worker`). Live today:
   `found@sitemail.eisenhower.school`.
5. **`EMAIL_FORWARDS` secret** on the API Worker:
   ```
   cd apps/api && npx wrangler secret put EMAIL_FORWARDS --env production
   # value: {"admin":["meandmybadself@gmail.com"],"pto":["…","…"]}
   ```

## Apex cutover to Google Workspace — DONE 2026-11-03

The split is now: **`sitemail` is the app's machine channel** (Email Sending
outbound; Email Routing inbound for `found@sitemail`), **the apex is Google
Workspace** for every human address, both directions. What was executed, for
the record (and for anyone who has to re-run it elsewhere):

1. Google Workspace org on `eisenhower.school` created/verified by hand, with
   `site@` (the app's Reply-To — `EMAIL_REPLY_TO` in wrangler.toml), and
   `admin@`/`pto@` re-homed there (replacing the Worker's apex fan-out).
2. The three apex routing rules (`found@`, `admin@`, `pto@`) deleted via the
   API ($CF_TOKEN has Rules Edit), then `POST /zones/:id/email/routing/disable`
   (wrangler's OAuth token — $CF_TOKEN lacks the settings scope, and the
   routing-managed MX records refuse direct DNS deletes with code 1046).
   **The zone-level disable removed only the APEX's routing DNS**: the
   `sitemail` subdomain registration, its MX records and the `found@sitemail`
   rule all survived, verified immediately after.
3. Apex Email Sending retired (`wrangler email sending disable
   eisenhower.school --force`); `sitemail` stays the one onboarded sender.
   **`cf2024-1._domainkey.eisenhower.school` was deliberately LEFT in place** —
   Email Sending may sign sitemail's mail with that zone-level selector (no
   `cf2024-1._domainkey.sitemail…` record exists), so deleting it risks the
   newsletter channel's DKIM for the price of one tidy TXT.
4. Apex DNS set Google's way: `MX 1 smtp.google.com`, SPF TXT
   `v=spf1 include:_spf.google.com ~all` (both propagated and verified via
   8.8.8.8). Google's DKIM (`google._domainkey` TXT from Admin console →
   Authenticate email) still to be added — do it promptly:
   `_dmarc.eisenhower.school` is `p=reject`, and while Google's own sending
   passes DMARC via aligned SPF, DKIM is what survives forwarding.
5. Lost & found staff must be told the intake address is
   **found@sitemail.eisenhower.school** (mail to the old apex `found@` now
   lands in Google's world and bounces or sits unread).

Nothing in the app changed on cutover day — every address it uses already
lived on `sitemail` or a third party.

## Adding the PTO board to the pto alias

Two steps per person: create their destination address (step 3 above — this
immediately sends them a "verify your email" message from Cloudflare, so warn
the board first), then add their address to the `pto` list in the
`EMAIL_FORWARDS` secret. Order doesn't matter: an unverified destination is
skipped, not fatal, and starts receiving as soon as they click verify.
(If the board lands on Google Groups at cutover instead, skip all of this and
leave `EMAIL_FORWARDS` for any future sitemail alias.)

## What the Worker enforces for found@ (lib/lostFoundEmail.ts)

- Sender must be an **enabled account on the lost & found staff roster**
  (`lostfound_staff_group_id`, invariant 31/33) — matched on the ENVELOPE
  sender, checked before the body is parsed. No group configured → system
  admins' addresses only, the same bootstrap as the routes.
- An explicit SPF/DKIM/DMARC **fail** in Cloudflare's Authentication-Results
  header is rejected even for a staff address. Softer verdicts (none,
  softfail, no header) are admitted — the hold bounds a forgery — but each
  item's audit row records the DMARC verdict it arrived under, so a row
  minted by envelope forgery is identifiable. Requiring `dmarc=pass` is a
  one-line tightening, documented at `authFailed`.
- JPEG attachments only (magic bytes, the upload route's own sniff), ≤ 6 MB
  each, at most 10 per message (the reply says to send the rest separately);
  the subject line becomes the item's `location` ("Fwd: gym" → "gym").
- Every item starts **HELD** (invariant 33) — email changes who can submit,
  never what the public sees without a staff Publish.
- The confirmation reply is marked `Auto-Submitted: auto-replied` and is
  never sent in answer to machine-generated mail (out-of-office, forwarding
  rules), so no mail loop can form.

The forwarding aliases deliberately get NONE of that gauntlet — a forwarding
alias behaves like a plain routing rule, which forwards whatever Cloudflare
accepted.

## Bindings involved

- `IMAGES` (wrangler.toml): makes the thumbnail the app's canvas would have
  made. Optional — absent, the model reads the full photo and listings use it
  as the thumb. Billed per unique transformation (one per photo); a school's
  volume sits inside the free monthly allowance.
- Inbound messages over Email Routing's 25 MiB cap never reach the Worker.

## History / gotchas

- 2026-10-25: app mail moved from the apex to `sitemail.eisenhower.school`
  so the apex MX could be handed to the school's Google Workspace. The
  handler needed no change (local-part matching).
- 2026-10-22: Cloudflare Email Routing took the apex from **ForwardMX**
  (`mx1/mx2.forwardmx.net`); any alias that existed only there died at
  cutover, by choice (no catch-all). The old apex SPF
  (`include:_spf.forwardmx.net`) was replaced by Cloudflare's.
- Outbound transactional mail rode Resend from `mailer.meandmybadself.com`
  until 2026-10-25, when all sending consolidated on Cloudflare Email
  Sending from sitemail (`/privacy`'s email line changed with it). Resend
  then survived as a dormant fallback until 2026-11-05, when it was retired
  entirely (secret deleted, code removed).
- Testing a forward by mailing yourself from Gmail LOOKS like it failed:
  Gmail dedupes the returning copy by Message-ID; check `wrangler tail` for
  the `Email … - Ok` line instead.

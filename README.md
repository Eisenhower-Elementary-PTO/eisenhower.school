# Eisenhower School Directory

A privacy-conscious contact directory for a single school community — teachers,
staff, parents, and students — and the services that have grown around it: a
shared calendar with volunteer sign-ups, a newsletter, and a merch store. People
sign in with **email only** (magic link) and act on behalf of one or more
**Persons** they control (themselves and their children).

The directory itself is **members-only**, and inside it "Public" means *visible
to authenticated members of this instance* and nothing stronger — there is no
world-readable state in the visibility model. A handful of surfaces around it
*are* deliberately open to the internet (the front door, the agenda, the
newsletter archive, the storefront); each is served through a hand-written
projection that decides field by field what may cross. See
[Who can see what](#who-can-see-what).

> Single-tenant: one school per deployment. Built to run on Cloudflare's free tier.

## Status

**Live in production**, deployed on merge to `main` (see
[Deploying](#deploying-to-cloudflare)). Hosts:

| Host | What |
|---|---|
| `eisenhower.school` | Public front door (`apps/home`), plus `www` → apex |
| `directory.eisenhower.school` | Directory SPA (`apps/web`) |
| `calendar.eisenhower.school` | Calendar SPA (`apps/calendar`) |
| `newsletter.eisenhower.school` | Newsletter app + public archive (`apps/newsletter`) |
| `store.eisenhower.school` | Storefront + cart + admin (`apps/store`) |
| `lostandfound.eisenhower.school` | Lost & found: public browse + "that's mine", staff upload/review (`apps/lostandfound`) |
| `api-directory.eisenhower.school` | The one API Worker (`apps/api`) |
| `ptomeet.eisenhower.school` | Vanity name; 301s to the PTO's Google Meet room (`apps/redirect`) |
| `directory.meandmybadself.com` | Retired host; 301s to the live one (`apps/redirect`) |

**[`CLAUDE.md`](./CLAUDE.md) is the live engineering contract** — its numbered
invariants are the rules the code actually enforces and the tests pin, and it is
the file to read before changing anything. The product spec is in
[`docs/`](./docs) (read `00-PLAN` → `01-SRD` → `02-SDD`).
[`PLAN.md`](./PLAN.md) is the original build plan and covers M0–M4 (the identity
core) only; everything after it — calendar, volunteers, newsletter, store, the
front door — landed without being tracked there, so treat it as history rather
than as status.

The hi-fi design board it was ported from (`design_handoff_school_directory/`)
has been **deleted** — every token, atom and icon it defined now lives in
`apps/web/src/styles/tokens.css`, `atoms.tsx` and `Icon.tsx`, which are the
source of truth. Source comments still say "ported from design_handoff/ds.jsx";
that folder is in git history at `48f80f6` if you ever need the original board.

## Architecture

| Package | Stack | Role |
|---|---|---|
| `apps/home` | Hono on **Workers** | The apex. One server-rendered HTML document per request, no client bundle: welcome, upcoming events, district contacts, language picker |
| `apps/web` | React + Vite → **Pages** | Directory SPA: design system, screens, i18n, offline service worker |
| `apps/calendar` | React + Vite → **Pages** | Agenda (public), event pages, volunteer sheets, calendar/event authoring, ICS feed admin |
| `apps/newsletter` | React + Vite → **Pages** (+ Functions) | TipTap authoring, subscribers, member preferences; Functions server-render the public archive |
| `apps/store` | React + Vite → **Pages** (+ Functions) | Cart and admin in the bundle; Functions server-render the indexed storefront. Printful fulfilment, Stripe checkout |
| `apps/lostandfound` | React + Vite → **Pages** | Public browse/search and claim form (not indexed); staff upload, review, claims. Photos described by Workers AI, searched with Vectorize. Invariant 33 |
| `apps/api` | Hono on **Workers** | Serves **all four** SPAs: auth, authz, **server-side privacy resolution**, audit, geocoding, calendars, newsletter, volunteers, store |
| `apps/redirect` | One-file **Worker** | Owns hostnames that only 301 elsewhere: the retired directory host, and `ptomeet` → the PTO's Google Meet |
| `packages/shared` | TypeScript | Domain types + i18n dictionaries (en/es/zh/so) shared by every app |
| `apps/api/migrations` | SQL | Cloudflare **D1** (SQLite) schema, ordered and append-only |

All four SPAs share one API, one D1, and one session cookie: the cookie is
host-only to the API's hostname, and because every host is an `eisenhower.school`
subdomain, credentialed requests from any SPA are same-site. Adding a front-end
origin means adding it to `ALLOWED_ORIGINS` in `apps/api/wrangler.toml`, which
doubles as the allowlist of valid magic-link return targets.

The three later apps **copy** `tokens.css`, `Icon.tsx`, `atoms.tsx` and the
generic half of `parts.tsx` from `apps/web` rather than importing them — they're
expected to drift, so a change to one is a decision about all four.

```
React SPA (Pages)  ──fetch (JSON, session cookie)──▶  Hono API (Workers)
  cache-first service worker (apps/web)                │  session + audit middleware
                                                       ├─ D1 (SQL)
Pages Functions ───────────────────────────────────────┤  ├─ R2 (member photos; newsletter media, separately)
  newsletter archive, storefront                       ├─ CF Email Sending (email; Resend fallback)
                                                       ├─ Nominatim (geocode, server-only)
apps/home (Worker) ────────────────────────────────────┘  ├─ Stripe + Printful (store)
  one subrequest: the public agenda                       └─ Slack (optional, system events)
```

## Who can see what

Three tiers, and the boundary between them is a type, not a habit:

- **Public and indexed** — the front door (`apps/home`) and the storefront. These
  ship `robots.txt`, a sitemap and `hreflang` alternates. Nothing member-private
  may ever appear on either.
- **Public but unindexed** — the calendar agenda and an event's own page,
  volunteer sheet *counts*, the sent-newsletter archive, published ICS feeds, and
  a store order's status page. Enumerable by design: these are the links that get
  pasted into a text message.
- **Members-only** — everything else, including every volunteer *name*, every
  contact item, and `/photos/:key`. The SPA bundles all send `noindex`.

Each public response is built by a hand-written projection — `publicEventOf`,
`publicSheetOf`, `issuePageOf`, `publicProductOf`, `orderStatusOf` — assembled
field by field, never by spreading a row or a wider DTO. That is what makes
adding a field to an internal DTO a no-op for the public surface until someone
edits the projection on purpose, and each one has a test pinning its exact key
set. Slack, Printful and Stripe are treated as a further boundary again: what may
cross is fixed by the shape of the outbound type, so a payload has no field wide
enough to carry a member row by mistake.

## Identity model

`User` (credential) ─< `Control` >─ `Person` (directory entity) ─< `Membership` >─
`Group`. A Person can have several Controllers (two parents); students are
Persons with no User. Privacy is resolved **only on the server** — clients never
receive data they can't see, and geo-coordinates are never serialized.

Two withholdings sit above per-field visibility: `unlisted_at` decides whether a
Person is visible to a viewer *at all* (before any field on them is), and a name
search may never match on more than it renders — both live in
`apps/api/src/lib/privacy.ts`, and a test scans the source to catch a query that
forgets them.

## Domain notes

**Calendars** come in two kinds. *Imported* calendars are public ICS feeds an
admin registers; a cron job re-fetches and expands them every 3 hours. *Managed*
calendars are authored in the calendar app and publish their own feed at
`/ics/<calendarId>.ics` (unauthenticated, so Google/Apple Calendar can
subscribe). Both materialize into the same `calendar_event` table, so the agenda
is a single query — which also means its row ids are **not stable**, and anything
needing a durable handle on an occurrence uses the `(managed_event_id,
starts_at)` pair instead.

**Volunteer sheets** hang off one occurrence of a managed event and render inline
on that event's page. Counts are public so a sheet can circulate in a text
message; names require a session, and signing up always does.

**Newsletters** are stored as TipTap JSON and turned into HTML by exactly one
renderer, shared by the email, the composer preview and the public archive — it
is also the sanitizer. A sent issue is immutable and its events are frozen into a
snapshot, so the archive keeps matching what was mailed. Public sign-up is double
opt-in; admin-side adds are single opt-in on purpose.

**The store** prices per *variant* server-side, freezes a shipping quote into an
HMAC-signed token before Stripe is involved, and treats
`checkout.session.completed` as *not* proof that money moved (a delayed payment
method settles days later, or never). Every state transition is a
compare-and-swap on `status`, which is also the idempotency mechanism for
redelivered webhooks. An order names a **buyer**, not a Person, and nothing in
its schema joins `person`.

## Prerequisites

- Node ≥ 22, [pnpm](https://pnpm.io) 10
- A Cloudflare account + [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) (for deploy)

## Quick start (local)

```bash
pnpm install

# API: copy local secrets template (magic links print to the console if no Resend key)
cp apps/api/.dev.vars.example apps/api/.dev.vars

# Create the local D1 database + apply migrations, then seed demo data
pnpm db:migrate:local
pnpm db:seed:local

# Run everything in parallel:
#   web 5173 · calendar 5174 · newsletter 5175 · home 5176 · store 5177 · api 8787
pnpm dev
```

Then open <http://localhost:5173>, enter `dana@eisenhower.edu`, and **read the
API terminal** — the magic-link URL is printed there (no email is sent without a
Resend key). Click it to land in the directory. Every app shares that session,
and signing in from one returns you there (each sends its own origin as
`returnTo`).

Two things local dev does not give you:

- **Pages Functions.** `vite dev` serves the SPA bundles only, so the newsletter
  archive (`/`, `/n/:slug`) and the storefront (`/`, `/p/:slug`, `/o/:token`)
  exist in `wrangler pages dev` and in production, not in `pnpm dev`. You get the
  cart and both admins, and a note where the shop would be.
- **Third-party calls.** With `RESEND_API_KEY`, `SLACK_WEBHOOK_URL`,
  `PRINTFUL_API_KEY` or `STRIPE_SECRET_KEY` empty, the call is logged rather than
  made — which also means a newsletter send prints to the API console instead of
  mailing anyone. `STORE_SECRET` is the one exception: it may only be empty while
  `STRIPE_SECRET_KEY` is too, because a guessable quote key is a guessable price.

## Useful scripts

| Command | What |
|---|---|
| `pnpm dev` | Run every app in parallel |
| `pnpm dev:web` / `:calendar` / `:newsletter` / `:store` / `:home` / `:api` | Run one app |
| `pnpm build` | Build every package in dependency order |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Run unit tests |
| `pnpm db:migrate:local` | Apply D1 migrations to the local SQLite |
| `pnpm db:migrate:remote` | Apply D1 migrations to the remote database |
| `pnpm db:seed:local` | Load demo data |

Adding a migration: create `apps/api/migrations/NNNN_description.sql` (next
number), update `packages/shared/src/types.ts` if the wire shape changes, and
re-run `pnpm db:migrate:local`. **Never edit an applied migration** — add a new
one.

## Deploying to Cloudflare

Deployment is automated. `.github/workflows/deploy.yml` runs on merge to `main`
(or manually from the Actions tab): it typechecks, tests and builds as a **gate**,
then applies D1 migrations to production and deploys the three Workers (`api`,
`redirect`, `home`) and the four Pages projects (`school-directory`,
`school-calendar`, `school-newsletter`, `school-store`). It no-ops cleanly until
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set as repository secrets.

The remote resources it deploys *into* were created once by hand:

```bash
cd apps/api
wrangler d1 create school-directory          # paste database_id into wrangler.toml
wrangler r2 bucket create school-directory-photos
wrangler r2 bucket create school-directory-newsletter-media

# Secrets (production)
wrangler secret put RESEND_API_KEY --env production
wrangler secret put EMAIL_FROM --env production
wrangler secret put SLACK_WEBHOOK_URL --env production        # optional
wrangler secret put STORE_SECRET --env production             # store; see below
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET --env production
wrangler secret put PRINTFUL_API_KEY --env production
wrangler secret put PRINTFUL_WEBHOOK_SECRET --env production
```

The Worker's own hostname is a custom domain in `wrangler.toml`, so wrangler
provisions its DNS record and cert. **Pages custom domains are not**: each Pages
project and its `*.eisenhower.school` domain was attached once by hand
(dashboard, or `wrangler pages project create`), and every front-end origin also
has to appear in `ALLOWED_ORIGINS` or the browser will reject the API's
credentialed responses.

The **store** has more moving parts than the other apps — two third-party
accounts, several env values, and a DNS record the Pages API does not create for
you — so its setup lives in its own runbook:
**[`apps/store/SETUP.md`](apps/store/SETUP.md)**. Read it before connecting
Printful or Stripe, and again when those accounts change hands.

Three cron schedules run against the API Worker: shared-calendar refresh every
3 hours, the new-member digest daily at 13:00 UTC (a no-op unless notifications
are set to "daily" in Admin), and a `*/15` sweep that re-drives paid store orders
that never reached Printful.

### First-run setup (bootstrapping a bare instance)

A fresh database has **no users** and ships with **registration closed**
(migration `0004`). The first admin is bootstrapped by config, not by signing up:

1. Set `BOOTSTRAP_ADMIN_EMAILS` in `apps/api/wrangler.toml` `[vars]` to the
   office/operator email(s), comma-separated, **before deploying**. These
   accounts can sign in even while registration is closed and are granted
   `system_admin` on sign-in (re-granted each time, so you can add admins later).
2. Deploy + apply migrations.
3. That email signs in at the app → it becomes an admin.
4. From **Admin**, bulk-import the roster (which queues invitations), and/or open
   registration if you want families to self-onboard.

There is intentionally **no "first user becomes admin"** auto-promotion — with
open registration that would be a footgun. Without a configured bootstrap email
on a closed instance, no one can sign in (by design); set the var to recover.
Local dev keeps registration open and seeds an admin (`dana@eisenhower.edu`).

Removing an admin is `disabled_at` (reversible, and refused if they are the last
enabled system admin) — not deletion. Permanent deletion of a User is
deliberately not implemented; `GET /admin/users/:id/impact` is the only statement
of what it would be allowed to touch.

## Privacy posture (enforced, not aspirational)

- New fields default to **private**; neighbor discovery is **opt-in** and
  independent of address visibility.
- Geo-coordinates never leave the server. Neighbor responses carry a rounded
  distance string only, and the address map thumbnail is rendered server-side.
- The **offline cache** (`apps/web` only) holds just what the User can already
  see, treated like a phone's contacts list — purged on signout. No client-side
  encryption.
- Magic-link tokens are single-use, short-lived and stored hashed; the link's
  **GET is read-only** (it renders a page that POSTs the token back), because
  mail scanners follow every GET in a message. Sign-in sends are rate-limited per
  address and instance-wide, and the tables that grow are swept.
- Sessions are long-lived but server-revocable, and disabling a user sweeps their
  masquerade sessions too.
- The audit log is append-only and hash-chained for tamper evidence, appended by
  compare-and-swap so concurrent writers can't fork the chain, and verifiable at
  `GET /admin/audit/verify`. It is never swept and never deleted — noise is fixed
  at the push site.

## Where the rules live

| File | What it settles |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | The 27 numbered invariants, the repo layout, and the reasoning behind each. Read first. |
| [`docs/`](./docs) | Product spec: `00-PLAN` → `01-SRD` → `02-SDD` |
| [`apps/store/SETUP.md`](./apps/store/SETUP.md) | Connecting Printful and Stripe, and moving those accounts |
| [`apps/store/ROUTING.md`](./apps/store/ROUTING.md), [`apps/newsletter/ROUTING.md`](./apps/newsletter/ROUTING.md) | Why neither app may have a `_redirects` file |

## Conventions

- TypeScript strict everywhere; `verbatimModuleSyntax` is on, so use
  `import type` and `.js` extensions on relative imports.
- D1 access is raw prepared statements — always `.bind()`, never interpolate.
- IDs are ULIDs; timestamps are ISO-8601 UTC strings.
- UI copy comes from the `@sd/shared` dictionaries — never hardcode user-facing
  English in a component. Member-entered content is never translated.
- Dark mode follows `prefers-color-scheme` only: no toggle, nothing persisted.
- Conventional-ish commit messages, scoped to one concern. CI must pass
  `pnpm typecheck` and `pnpm test`.

## License

GNU Affero General Public License v3.0 or later — see [LICENSE](LICENSE).

Copyright (c) 2026 Jeffery Bennett.

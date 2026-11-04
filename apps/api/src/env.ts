// Worker bindings + per-request context shared across routes/middleware.

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** Newsletter images and logos. A SEPARATE bucket from PHOTOS, not a prefix
   *  inside it: these objects are served by a fully public route, and a bucket
   *  with no private data co-resident cannot leak a member's profile photo
   *  through a forgotten prefix check. */
  NEWSLETTER_MEDIA: R2Bucket;
  /** Lost & found photos (invariant 33). Public for the same reason
   *  NEWSLETTER_MEDIA is, and separate from PHOTOS for the same reason too:
   *  a public route over a bucket with no member photos in it cannot leak one. */
  LOSTFOUND_MEDIA: R2Bucket;
  /** Workers AI — the lost & found vision model and its embeddings. Optional
   *  in the absent-means-off sense: with no binding, every item stays HELD for
   *  staff to describe and publish by hand, and search is keyword-only. That keeps `vitest` and a bare `wrangler dev` binding-free. */
  AI?: Ai;
  /** Semantic index over lost & found descriptions (384-dim, bge-small).
   *  Optional, same contract as AI. Holds only LISTED items (found, not
   *  hidden, not held); any other item's vector is deleted. */
  LOSTFOUND_VECTORS?: VectorizeIndex;
  /** Override the vision model (any Workers AI model that accepts an image and
   *  supports JSON mode). Unset → `LF_VISION_MODEL` in lib/lostFound.ts. */
  LOSTFOUND_VISION_MODEL?: string;
  /** Cloudflare Images transforms — makes thumbnails for photos that arrive by
   *  email (lib/lostFoundEmail.ts), where there is no browser canvas to do it.
   *  Optional in the absent-means-off sense: without it, emailed items simply
   *  have no thumbnail and the model reads the full photo. */
  IMAGES?: ImagesBinding;
  /** Override the newsletter composer's assist model (any Workers AI chat
   *  model with JSON mode). Unset → `ASSIST_MODEL` in lib/newsletterAssist.ts,
   *  which is the same model the lost & found runs. Rides the same optional
   *  `AI` binding: no binding, no assist buttons. */
  NEWSLETTER_ASSIST_MODEL?: string;
  // vars
  SCHOOL_NAME: string;
  APP_URL: string;
  ALLOWED_ORIGINS: string;
  /** Public origin of the newsletter app — where "view in browser" and
   *  unsubscribe links in a sent email point. */
  NEWSLETTER_URL: string;
  /** Public calendar site. Events blocks in a newsletter link out to it. */
  CALENDAR_URL?: string;
  /** Public origin of the store. Stripe's success/cancel URLs and the
   *  order-status links in confirmation email point here, so it must be the
   *  reader-facing host and not this API. */
  STORE_URL: string;
  /** Public origin of the PTO site. Nothing this API sends by email points at
   *  it yet — it is here so the origin has one home, beside its siblings. */
  PTO_URL?: string;
  /** Public origin of the lost & found. Like PTO_URL, nothing the API sends
   *  points at it yet; it lives here beside its siblings. */
  LOSTFOUND_URL?: string;
  /** Reply-To for member-facing app mail that invites an answer (today: the
   *  volunteer reminder). A HUMAN mailbox — site@eisenhower.school, in the
   *  school's Google Workspace — where the From identities live on `sitemail`,
   *  which no one reads. Absent-means-off like the rest of the email config:
   *  unset, the message carries no Reply-To and replies go to the From
   *  address. Only useful once the apex MX points at Google and the mailbox
   *  exists there (EMAIL-INTAKE.md's cutover). */
  EMAIL_REPLY_TO?: string;
  /** The school's IANA zone. Everything server-side reads timed events in it
   *  (email, public archive, Slack, unzoned feed times). Always read through
   *  `resolveTimeZone`, which falls back to America/Chicago. */
  SCHOOL_TIMEZONE?: string;
  /** Override the Nominatim search endpoint (e.g. a self-hosted instance). */
  NOMINATIM_URL?: string;
  /** Comma-separated emails granted system_admin on sign-in (bootstrap). They
   *  can sign in even when registration is closed. */
  BOOTSTRAP_ADMIN_EMAILS?: string;
  /** Static-map image URL template with {lat} {lon} {w} {h} {zoom} placeholders.
   *  Used server-side only to render an address thumbnail; coords never leave. */
  STATIC_MAP_URL?: string;
  // secrets (may be empty in local dev)
  /**
   * Rate limiter for the reads that serve one family's data to another
   * (invariant 32). Optional in the same sense `RESEND_API_KEY` is: absent
   * means the feature is off rather than the request failing, so `vitest` and
   * a bare `wrangler dev` need no binding and every route behaves as it did.
   *
   * That default is chosen knowing which way it fails. An unbound limiter
   * admits traffic it would have refused, which is the same posture as today
   * and is recoverable; refusing every read because a binding is missing
   * would take the directory down on a config slip.
   */
  READ_LIMIT?: RateLimit;
  /** JSON map of forwarding aliases on the school's domain — local part →
   *  verified destination addresses, e.g. `{"pto": ["…"], "admin": ["…"]}`
   *  (lib/emailForward.ts). A SECRET, not a var: the repo is public and the
   *  values are board members' personal addresses. Absent means no alias
   *  forwards and every routed address is the lost & found intake. */
  EMAIL_FORWARDS?: string;
  /** Cloudflare Email Sending (Workers Paid) — the outbound channel for ALL
   *  mail once BULK_EMAIL_FROM is also set (lib/email.ts). Optional in the
   *  absent-means-off sense: without either half, every message rides Resend
   *  as before (or the console, with no Resend key — local dev's magic
   *  links). */
  EMAIL?: SendEmail;
  /** The default From identity for mail sent through the EMAIL binding, e.g.
   *  "Eisenhower PTO <newsletter@sitemail.eisenhower.school>". Its DOMAIN
   *  must be onboarded to Email Sending, which is why the channel keys on
   *  this var: set it only after `wrangler email sending enable` has
   *  verified. App mail lives on the sitemail. subdomain — the apex's mail
   *  is the school's Google Workspace (EMAIL-INTAKE.md). A message asking
   *  for a From on that same domain (EMAIL_FROM) sends as itself; any other
   *  asked-for sender keeps its display name and survives as Reply-To. */
  BULK_EMAIL_FROM?: string;
  /** Resend — the FALLBACK channel while the Cloudflare one is
   *  half-configured. Dormant in production since app mail consolidated on
   *  the binding (2026-10-25); unsetting BULK_EMAIL_FROM falls back here. */
  RESEND_API_KEY?: string;
  /** The transactional From identity (magic links, invites, notifications),
   *  e.g. "Eisenhower PTO Directory <directory@sitemail.eisenhower.school>".
   *  On the Cloudflare channel its domain must be the onboarded one or it is
   *  demoted to Reply-To; on the Resend fallback it must be a
   *  Resend-verified sender. */
  EMAIL_FROM?: string;
  /** Slack Incoming Webhook posting system events to the admins' channel
   *  (invariant 22). Absent — the default, and the case in local dev — turns
   *  the feature off entirely and logs the message instead, exactly as an
   *  absent RESEND_API_KEY does for mail. The value is a bearer capability to
   *  post into that channel, so it lives here as a secret and is never logged. */
  SLACK_WEBHOOK_URL?: string;
  /** Printful v1 API key, and the store it acts on. Absent — the default, and
   *  the case in local dev — turns the catalog and fulfilment calls off and
   *  logs them instead, exactly as an absent RESEND_API_KEY does for mail, so
   *  the whole storefront is still walkable without a Printful account.
   *
   *  Both are expected to CHANGE ONCE: this instance starts against a personal
   *  Printful store and moves to the PTO's. Nothing durable is keyed on them —
   *  see migration 0022 — so that day is a secret rotation plus an admin
   *  re-point, not a migration. */
  PRINTFUL_API_KEY?: string;
  PRINTFUL_STORE_ID?: string;
  /** Stripe secret key and the signing secret for the webhook endpoint at
   *  /store-webhooks/stripe. Same absent-means-off contract; with no key the
   *  cart is walkable right up to the redirect. Also expected to change once,
   *  from a personal account to the PTO's — which is why every order freezes
   *  its own totals and lines rather than being re-derived from Stripe. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Shared secret Printful is configured to send with its webhooks. Printful's
   *  v1 webhooks are not signed the way Stripe's are, so this is what the
   *  shipment endpoint checks; see routes/storeWebhooks.ts for why a forged
   *  call is bounded even without it. */
  PRINTFUL_WEBHOOK_SECRET?: string;
  /** Keys the store's own HMACs: the signed shipping quote and the derived
   *  order-status token (lib/storeQuote.ts, lib/storeOrder.ts).
   *
   *  Unlike every other optional secret here it does NOT degrade gracefully in
   *  production. A guessable quote key is a guessable PRICE, so the dev
   *  fallback exists only while STRIPE_SECRET_KEY is also absent — the one
   *  configuration where no card can be charged. Rotating it invalidates every
   *  order-status link already emailed, which is why it is separate from
   *  anything on the auth path. */
  STORE_SECRET?: string;
}

/** Authenticated context attached to a request after session middleware. */
export interface AuthContext {
  /** Effective user — the one whose data is in scope (the target during masquerade). */
  userId: string;
  /** The real human behind the request — the admin during masquerade, else == userId. */
  realUserId: string;
  /** Effective user's email. */
  email: string;
  /** Effective user's system-admin flag (a masqueraded target is NOT admin). */
  isSystemAdmin: boolean;
  sessionId: string;
  /** Active Person the user is acting as (from cookie/preference), if any. */
  activePersonId: string | null;
  /** True when an admin is masquerading as `userId`. */
  isMasquerading: boolean;
  /**
   * May this account read OTHER families' data (migration 0029, invariant 32)?
   *
   * TWO conditions, resolved together by the session middleware:
   * `user.access_approved_at IS NOT NULL` AND the family has contributed at
   * least one piece of contact information (`hasContactInfoSql` in
   * lib/directoryAccess.ts — the directory is reciprocal). A system admin
   * short-circuits both — being one is a fact about the account rather than
   * something a review queue confers, the same short-circuit
   * `personListableSql` and `rosterAccess` both make.
   *
   * Both facts ride reads the middleware already makes, so the gate costs no
   * round trip. A masqueraded target resolves to the TARGET's state, which is
   * the point of masquerade: an admin viewing as a pending member sees the
   * pending member's directory.
   */
  isApproved: boolean;
}

/** Hono generic env: bindings + per-request variables. */
export interface HonoEnv {
  Bindings: Env;
  Variables: {
    auth?: AuthContext;
    /** Buffered audit entries flushed by audit middleware after the handler. */
    audit: import("./lib/audit.js").AuditDraft[];
    ip: string | null;
    userAgent: string | null;
  };
}

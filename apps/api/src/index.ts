// School Directory API — Hono on Cloudflare Workers.
// Pipeline: context → CORS → session → audit-flush, then routes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./env.js";
import { refreshAllSources } from "./lib/calendar.js";
import { refreshStoreCatalog } from "./lib/store.js";
import { retryStuckOrders, sweepAbandonedOrders } from "./lib/storeOrder.js";
import { resumePendingSends } from "./lib/newsletterSend.js";
import { allowedOrigins } from "./lib/db.js";
import { sendNewSubscriberDigest, sendNewUserDigest } from "./lib/notify.js";
import { sendVolunteerReminders } from "./lib/volunteerReminders.js";
import { runDailySweeps } from "./lib/sweep.js";
import { contextMiddleware } from "./middleware/context.js";
import { requireAuth, sessionMiddleware, UnauthorizedError } from "./middleware/session.js";
import { DirectoryAccessError, RateLimitedError } from "./lib/directoryAccess.js";
import { personListableSql } from "./lib/privacy.js";
import { auditMiddleware } from "./middleware/audit.js";
import { auth } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { persons } from "./routes/persons.js";
import { contacts } from "./routes/contacts.js";
import { controllers } from "./routes/controllers.js";
import { home } from "./routes/home.js";
import { directory } from "./routes/directory.js";
import { groups } from "./routes/groups.js";
import { shares } from "./routes/shares.js";
import { admin } from "./routes/admin.js";
import { settings } from "./routes/settings.js";
import { calendar } from "./routes/calendar.js";
import { calendarPublic } from "./routes/calendarPublic.js";
import { managedCalendar } from "./routes/managedCalendar.js";
import { ics } from "./routes/ics.js";
import { newsletter } from "./routes/newsletter.js";
import { newsletterPublic } from "./routes/newsletterPublic.js";
import { volunteers } from "./routes/volunteers.js";
import { volunteersPublic } from "./routes/volunteersPublic.js";
import { store } from "./routes/store.js";
import { storePublic } from "./routes/storePublic.js";
import { storeWebhooks } from "./routes/storeWebhooks.js";
import { pto } from "./routes/pto.js";
import { lostFound } from "./routes/lostFound.js";
import { lostFoundPublic } from "./routes/lostFoundPublic.js";
import { bingo } from "./routes/bingo.js";
import { bingoPublic } from "./routes/bingoPublic.js";
import { getItem as getLfItem, isListed, itemIdOfKey, retagStuck, sweepLostFound } from "./lib/lostFound.js";
import { emailHandler } from "./email.js";

const app = new Hono<HonoEnv>();

app.use("*", contextMiddleware);

app.use("*", (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = allowedOrigins(c.env);
      return origin && allowed.includes(origin) ? origin : allowed[0] ?? "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next),
);

app.use("*", sessionMiddleware);
app.use("*", auditMiddleware);

// Health / config probe.
app.get("/health", (c) => c.json({ ok: true, school: c.env.SCHOOL_NAME }));

// Routes.
app.route("/auth", auth);
app.route("/me", me);
app.route("/persons", persons);
app.route("/home", home);
app.route("/directory", directory);
app.route("/groups", groups);
app.route("/shares", shares);
app.route("/admin", admin);
app.route("/admin", managedCalendar); // managed-calendar CRUD, same /admin base
app.route("/settings", settings);
app.route("/calendar", calendar);
app.route("/calendar-public", calendarPublic); // anonymous agenda reads — no auth by design
app.route("/ics", ics); // public published feeds — no auth by design
app.route("/newsletter", newsletter); // authoring — system admins + the editors group (invariant 31)
app.route("/newsletter-public", newsletterPublic); // archive + subscribe/unsubscribe — no auth by design
app.route("/volunteers", volunteers); // signup reads with names + claims — members only
app.route("/volunteers-public", volunteersPublic); // signup counts, no names — no auth by design
app.route("/store", store); // admin catalog/orders, plus a member's own orders
app.route("/store-public", storePublic); // catalog, cart pricing, checkout, order status — no auth by design
// Vendor callbacks. Not "no auth by design" like the routers above: the trust
// boundary is a signature, checked inside each handler against the RAW body.
app.route("/store-webhooks", storeWebhooks);
// The PTO's planning boards. No `/pto-public/*` twin beside it, unlike every
// other feature router above: a board has ONE audience and the public seam
// deliberately does not exist (migration 0024).
app.route("/pto", pto);
app.route("/lostfound", lostFound); // staff — system admins + the staff group (invariant 33)
app.route("/lostfound-public", lostFoundPublic); // browse, search, "that's mine" — no auth by design
app.route("/bingo", bingo); // operating the game-night board — any session
app.route("/bingo-public", bingoPublic); // the live board, numbers only — no auth by design
// share-targets is exposed under /shares/targets via the shares router.
app.route("/", contacts); // /persons/:id/contacts + /contacts/:id
app.route("/", controllers); // /persons/:id/controllers + /control-invites
app.post("/control-invites/:id/accept", (c) =>
  // Acceptance happens via the magic-link callback (kind=invite); this endpoint
  // exists for admin-driven grants in a later milestone.
  c.json({ error: "use_magic_link" }, 400),
);

// Profile photo serving (R2). MEMBERS ONLY — these are photographs of children,
// and an unguessable key is not an access rule: a URL in a cache, a referrer or
// a screenshot would make one permanently public, with no way to revoke it short
// of replacing the photo. `sd_session` is host-only to this API and every SPA is
// a same-site subdomain, so an ordinary <img src> carries the cookie under
// SameSite=Lax and needs no crossorigin attribute. Still `private` in the cache
// header: the response varies by who asked.
app.get("/photos/:key", async (c) => {
  const auth = requireAuth(c);
  // A ULID key is not an access rule, and neither is a session on its own any
  // more (migration 0029): these are photographs of children, so an account
  // waiting on approval may load only the ones belonging to a Person it
  // controls. Checked against `person` rather than the key's own bytes,
  // because the key says nothing about whose face it is.
  if (!auth.isApproved) {
    // Composed rather than exempted. With `isApproved` false this reduces to
    // "a Person you control", which is the same set the join already implies —
    // so the guard costs nothing here and spends none of
    // test/personListable.test.ts's exemption budget, where an exemption would
    // have spent one to say "trust the join".
    const listable = personListableSql(auth.userId, auth.isSystemAdmin, "p", auth.isApproved);
    const mine = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM person p
         JOIN control ct ON ct.person_id = p.id
        WHERE p.photo_object_key = ? AND ct.user_id = ? AND ${listable.sql} LIMIT 1`,
    )
      .bind(c.req.param("key"), auth.userId, ...listable.binds)
      .first<{ ok: number }>();
    if (!mine) return c.notFound();
  }
  const obj = await c.env.PHOTOS.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
});

// Newsletter images (R2). Fully public and long-cached: these have to load
// inside an email client that sends no cookies, and on a public archive page.
// They live in their own bucket precisely so that being public here can never
// expose a member's profile photo. Keys are ULID-random, hence immutable.
app.get("/newsletter-media/:key", async (c) => {
  const obj = await c.env.NEWSLETTER_MEDIA.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");
  return new Response(obj.body, { headers });
});

// Lost & found photos (R2), from a bucket of their own (invariant 33). Served
// here ONLY while the item is listed — a held photo may show a child's name, a
// hidden one a face — so the key alone is not an access rule, the same lesson
// /photos learned (invariant 20). Staff see every photo through
// /lostfound/media/:key instead. An hour's cache rather than a year's, so that
// hiding an item takes the photo down within the hour, not whenever a browser
// gets round to it.
app.get("/lostfound-media/:key", async (c) => {
  const key = c.req.param("key");
  const id = itemIdOfKey(key);
  const item = id ? await getLfItem(c.env, id) : null;
  if (!item || !isListed(item)) return c.notFound();
  const obj = await c.env.LOSTFOUND_MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("access-control-allow-origin", "*");
  return new Response(obj.body, { headers });
});

app.onError((err, c) => {
  if (err instanceof UnauthorizedError) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // 403 rather than 401: the session is fine, the account just isn't approved
  // to read other families yet (migration 0029). The error code is named so the
  // SPA can route to the application screen instead of showing a dead end; it
  // tells the caller only about their own account, so it discloses nothing.
  if (err instanceof DirectoryAccessError) {
    return c.json({ error: "directory_access_required" }, 403);
  }
  // `Retry-After` because both windows are fixed: a client that honours it
  // recovers on its own, and one that ignores it is the case this exists for.
  // The error names the seconds — a minute, or the rest of the UTC day.
  if (err instanceof RateLimitedError) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": String(err.retryAfter) });
  }
  console.error("[api] unhandled", err);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Cron (see wrangler.toml [triggers]). Two schedules share this handler:
//   0 */3 * * *  — refresh the shared calendar from its ICS feeds. Errors are
//                  recorded per-source and never throw.
//   0 13 * * *   — send the admin digests (~8am Central): new members and new
//                  newsletter subscribers. Each is a no-op unless an admin has
//                  set that notification to "daily", and they are independent
//                  settings, so one may fire while the other doesn't.
// The two never collide: */3 fires on even hours only.
//
// A third schedule joins them for the store:
//   */15 * * * *  — re-drive paid orders that never reached Printful. Fifteen
//                   minutes rather than riding the 3-hourly refresh because the
//                   thing being recovered is a CHARGED order that hasn't been
//                   printed; the inline waitUntil handles it in seconds in the
//                   normal case, and this is only the backstop for a Worker that
//                   died mid-flight. Overlapping fires are harmless — the
//                   submission claim is a guarded UPDATE only one caller wins.
//                   The newsletter's send resumption rides this schedule too,
//                   with the same guarded-claim shape: each fan-out run is
//                   budgeted under the per-invocation subrequest cap, and this
//                   tick is what drains the remainder of a large audience.
//
// And a fourth for the volunteers:
//   15 0 * * *   — volunteer event reminders, two evenings before an event
//                  with sign-ups (lib/volunteerReminders.ts). 00:15 UTC is
//                  6:15pm CST / 7:15pm CDT — evening either side of the DST
//                  change with no zone math in the schedule; the due test
//                  itself is in school-local days.
//
// Cron budget: the account moved to Workers PAID with the Email Sending
// cutover (2026-10-25), so the Free plan's five-triggers-per-ACCOUNT ceiling
// that capped this list at three (plus bus-notify's two) no longer binds —
// Paid allows 250. Comments elsewhere that cite the old ceiling are history.
const DIGEST_CRON = "0 13 * * *";
const STORE_CRON = "*/15 * * * *";
const REMINDER_CRON = "15 0 * * *";

const scheduled: ExportedHandlerScheduledHandler<Env> = (event, env, ctx) => {
  if (event.cron === STORE_CRON) {
    ctx.waitUntil(retryStuckOrders(env));
    // Newsletter sends are budgeted per invocation (the subrequest cap — see
    // lib/newsletterSend.ts) and yield with recipients still pending; this is
    // what carries a yielded or killed run forward. It rides the store's
    // schedule (it predates the paid upgrade and a 15-minute cadence suits it)
    // and shares the invocation's subrequest budget with retryStuckOrders —
    // which is why SEND_BUDGET leaves headroom.
    ctx.waitUntil(resumePendingSends(env));
    return;
  }
  if (event.cron === REMINDER_CRON) {
    ctx.waitUntil(sendVolunteerReminders(env));
    return;
  }
  if (event.cron === DIGEST_CRON) {
    // Separately awaited inside their own try/catch, so one failing digest
    // can't swallow the other.
    ctx.waitUntil(sendNewUserDigest(env));
    ctx.waitUntil(sendNewSubscriberDigest(env));
    // Housekeeping for the four tables that would otherwise only ever grow.
    // Two of them back a rate limit that counts rows, which makes their
    // retention a security parameter rather than tidiness — see lib/sweep.ts.
    ctx.waitUntil(runDailySweeps(env));
    // Unpaid checkouts are marked `abandoned`, never deleted — see migration
    // 0022. It rides the daily sweep rather than lib/sweep.ts because it is an
    // UPDATE, and that file is deliberately only DELETEs of growing tables.
    ctx.waitUntil(sweepAbandonedOrders(env));
    // Lost & found: retention (returned items, settled claims) and a retry of
    // descriptions that failed — typically yesterday's photos taken after the
    // Workers AI daily allocation ran out (it resets at 00:00 UTC, well before
    // this fires). It rides this schedule because there is no slot for its own.
    ctx.waitUntil(sweepLostFound(env));
    ctx.waitUntil(retagStuck(env, 40));
    return;
  }
  ctx.waitUntil(refreshAllSources(env));
  // A design discontinued upstream should stop being for sale without waiting
  // for an admin to notice. Never throws; one bad product doesn't stop the rest.
  ctx.waitUntil(refreshStoreCatalog(env));
};

// Inbound email (Email Routing → this Worker): the lost & found photo intake.
// Routed addresses are configured by hand — see EMAIL-INTAKE.md.
export default { fetch: app.fetch, scheduled, email: emailHandler };

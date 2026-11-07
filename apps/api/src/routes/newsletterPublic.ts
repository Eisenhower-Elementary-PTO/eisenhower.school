// Public newsletter surface — no authentication, by design.
//
// Same trust posture as routes/ics.ts, and the same warning applies with more
// force: NOTHING member-specific may ever be added to these responses. The
// archive is deliberately addressed by a human-readable dated slug, so issues
// are enumerable and crawlable. That is the point — a newsletter link has to
// open from an inbox, a text message or a Facebook group with no sign-in — but
// it means an issue's body must never contain member-private content.
//
// Only PUBLISHED issues are visible (`published_at IS NOT NULL`, migration
// 0031) — sent ones, and any an editor put up without mailing. An unpublished
// draft's slug resolves to a 404, so guessing tomorrow's URL reveals nothing.
//
// Sign-up lives here too, and is DOUBLE opt-in: POST /subscribe only mails a
// confirmation link, and POST /subscribe/confirm/:token is the sole thing that
// writes to newsletter_subscriber. The form is anonymous and public, so the
// address it carries is an unproven claim until the link mailed to that address
// comes back. See migration 0013 for why the token is not an auth_token.

import { Hono } from "hono";
import type { NewsletterNode, PublicNewsletterIssueSummaryDTO } from "@sd/shared";
import { newsletterExcerpt } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { isExpired, isoPlus, nowIso, NEWSLETTER_CONFIRM_TTL } from "../lib/time.js";
import { normalizeEmail } from "../lib/db.js";
import { ulid } from "../lib/ids.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { sendEmail } from "../lib/email.js";
import { notifyNewSubscriber } from "../lib/notify.js";
import { recordIssueMetric } from "../lib/newsletterMetrics.js";
import {
  brandingOf,
  confirmSubscriptionUrl,
  getNewsletterSettings,
  isEmail,
  issuePageOf,
  subscribeConfirmEmailArgs,
  type IssuePageRow,
} from "../lib/newsletter.js";

export const newsletterPublic = new Hono<HonoEnv>();

const ARCHIVE_PAGE_SIZE = 50;

interface PublicRow {
  slug: string;
  title: string;
  subtitle: string | null;
  content_json: string;
  events_snapshot_json: string | null;
  published_at: string;
}

function parseDoc(json: string): NewsletterNode {
  try {
    return JSON.parse(json) as NewsletterNode;
  } catch {
    return { type: "doc", content: [] };
  }
}

function summaryOf(row: PublicRow): PublicNewsletterIssueSummaryDTO {
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    publishedAt: row.published_at,
    excerpt: newsletterExcerpt(parseDoc(row.content_json)),
  };
}

/** GET /newsletter-public/issues?limit= — published issues, newest first. Also backs
 *  the "latest issue" card on the directory's Home screen, which is why it
 *  takes a limit rather than always returning the whole archive. */
newsletterPublic.get("/issues", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || ARCHIVE_PAGE_SIZE, 1), ARCHIVE_PAGE_SIZE);
  const rows = await c.env.DB.prepare(
    `SELECT slug, title, subtitle, content_json, events_snapshot_json, published_at
       FROM newsletter_issue
      WHERE published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<PublicRow>();

  const settings = await getNewsletterSettings(c.env);
  return c.json({
    issues: rows.results.map(summaryOf),
    branding: brandingOf(settings),
  });
});

/** GET /newsletter-public/issues/:slug — one published issue.
 *
 *  Returns the stored document and the frozen events snapshot rather than
 *  pre-rendered HTML: the page runs the same @sd/shared renderer the email did,
 *  over the same inputs, so the archive can't drift from what was mailed. A
 *  published issue not yet SENT has no snapshot, and `issuePageOf` resolves its
 *  events live, as it does for a review link.
 *
 *  The `published_at IS NOT NULL` gate below is the whole reason a guessed
 *  draft slug reveals nothing (invariant 10). It stays in this query, in SQL — the review
 *  link added in migration 0015 is a SEPARATE route on a SEPARATE column, so
 *  sharing a draft never involved loosening this one. */
newsletterPublic.get("/issues/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT slug, title, subtitle, status, content_json, events_snapshot_json, sent_at,
            published_at, updated_at
       FROM newsletter_issue
      WHERE slug = ? AND published_at IS NOT NULL`,
  )
    .bind(c.req.param("slug"))
    .first<IssuePageRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const settings = await getNewsletterSettings(c.env);
  return c.json(await issuePageOf(c.env, row, brandingOf(settings)));
});

/** POST /newsletter-public/issues/:slug/view — the archive page's readership
 *  beacon (migration 0042; all the rules live in lib/newsletterMetrics.ts).
 *
 *  Anonymous and open, like the page that carries it. Three properties:
 *
 *   · the answer is ALWAYS `{ ok: true }` — a draft slug, an unknown slug, a
 *     junk body and a failed write all look identical, so the counter can't be
 *     turned into the slug oracle invariant 10's SQL gate exists to prevent;
 *   · the body is read as text, because `navigator.sendBeacon` sends
 *     text/plain — which is also what keeps the cross-origin POST a "simple
 *     request" that needs no preflight (it fires from the translate proxy's
 *     origin too, where CORS would never be configured);
 *   · no audit draft — a counter bump per public page load is `read_budget`'s
 *     kind of write, not a member action (see the lib header). */
newsletterPublic.post("/issues/:slug/view", async (c) => {
  const raw = await c.req.text().catch(() => "");
  await recordIssueMetric(c.env, c.req.param("slug"), raw);
  return c.json({ ok: true }, 200, { "cache-control": "no-store" });
});

/** GET /newsletter-public/preview/:token — one issue by its review link.
 *
 *  Holding the token IS the authorization, the same posture as the unsubscribe
 *  and confirm lookups: it carries 256 bits from randomToken() and only a system
 *  admin can mint one, so there is no anonymous path to abuse and nothing to
 *  walk. That is also why there is no rate limit here — entropy is the boundary,
 *  consistently with every other bearer-token lookup in this file.
 *
 *  Read-only and non-consuming, unlike the double opt-in token: the same link
 *  keeps working until an admin revokes it, and a mail scanner following it
 *  changes nothing.
 *
 *  No status filter on purpose. The point is reading an issue BEFORE it is sent,
 *  and a link already circulated should keep resolving afterwards rather than
 *  breaking the moment the issue goes out. What comes back is built by the same
 *  `issuePageOf` the public archive uses, so a reviewer sees neither more nor
 *  less of an issue than a reader eventually will. */
newsletterPublic.get("/preview/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "not_found" }, 404);

  const row = await c.env.DB.prepare(
    `SELECT slug, title, subtitle, status, content_json, events_snapshot_json, sent_at,
            published_at, updated_at
       FROM newsletter_issue
      WHERE preview_token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<IssuePageRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const settings = await getNewsletterSettings(c.env);
  return c.json(await issuePageOf(c.env, row, brandingOf(settings)));
});

/** GET /newsletter-public/branding — masthead + accent for a public page that
 *  isn't rendering an issue (the subscribe form). Same projection the archive
 *  gets; `brandingOf` remains the only builder, so sender identity stays out. */
newsletterPublic.get("/branding", async (c) => {
  const settings = await getNewsletterSettings(c.env);
  return c.json({ branding: brandingOf(settings) });
});

/** How many confirmation emails ONE address can be sent per day.
 *
 *  Anybody can type anybody's address into a public form, so the form is a
 *  remote control for somebody else's inbox unless the send path is bounded.
 *  Five leaves room for "it went to spam, try again" and makes the form
 *  useless as a mail bomb aimed at one person. */
const CONFIRM_EMAILS_PER_DAY = 5;

/** How many confirmation emails this instance sends per day, to ANY address.
 *
 *  The per-address cap above bounds what can be done to one victim; it does
 *  nothing about the other direction, where a script walks a harvested address
 *  list and has us send one unsolicited mail per address — under the
 *  newsletter's own From identity, spending its send quota and its domain
 *  reputation. This route is anonymous and the Pages Function's honeypot is
 *  bypassed by POSTing here directly, so a ceiling on the total is the only
 *  thing standing between a public form and a spam cannon.
 *
 *  Sized for a single school: an ordinary day sees a handful of sign-ups, and
 *  even a "we just launched" spike stays far under this. Hitting it means
 *  something is wrong, so it logs loudly. */
const CONFIRM_EMAILS_PER_DAY_TOTAL = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** POST /newsletter-public/subscribe { email } — self-serve sign-up, step one.
 *
 *  Double opt-in: this writes NOTHING to newsletter_subscriber. It mails a
 *  confirmation link to the address that was typed in, and only that link (see
 *  POST /subscribe/confirm/:token) puts anyone on the list. Whoever submitted
 *  the form is not assumed to own the address — that assumption is exactly what
 *  the confirmation exists to test.
 *
 *  Always answers `{ ok: true }` regardless of what happened, matching
 *  /auth/start (invariant 4): whether an address is already subscribed, already
 *  a member, or brand new is not something an anonymous caller gets to learn.
 *  The response is identical for a rate-limited address too, so the limit can't
 *  be used as an oracle either. */
newsletterPublic.post("/subscribe", async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isEmail(email)) return c.json({ ok: true });

  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = nowIso();

  try {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    // Both budgets in one round trip. A row is written ONLY when a mail is
    // actually sent (below), so these counts are send counts — a suppressed
    // attempt leaves no trace and therefore can't push the window further out
    // or grow the table. Replaying the form still can't reset either budget,
    // because what's counted is what was sent, not what was asked for.
    const counts = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email = ? THEN 1 ELSE 0 END) AS mine
       FROM newsletter_confirmation
       WHERE created_at > ?`,
    )
      .bind(email, since)
      .first<{ total: number; mine: number | null }>();

    const overPerAddress = (counts?.mine ?? 0) >= CONFIRM_EMAILS_PER_DAY;
    const overTotal = (counts?.total ?? 0) >= CONFIRM_EMAILS_PER_DAY_TOTAL;

    if (overTotal) {
      // Deliberately loud and deliberately not per-address: this one means the
      // form is being driven by something that isn't a family.
      console.error(
        `[newsletter] DAILY SEND CAP REACHED (${CONFIRM_EMAILS_PER_DAY_TOTAL}/day) — ` +
          `confirmation emails suppressed instance-wide until the window slides`,
      );
    } else if (overPerAddress) {
      console.warn("[newsletter] confirmation send suppressed; daily cap reached for one address");
    } else {
      await c.env.DB.prepare(
        `INSERT INTO newsletter_confirmation (id, email, token_hash, expires_at, consumed_at, created_at)
         VALUES (?,?,?,?,NULL,?)`,
      )
        .bind(ulid(), email, tokenHash, isoPlus(NEWSLETTER_CONFIRM_TTL), now)
        .run();

      const settings = await getNewsletterSettings(c.env);
      const msg = subscribeConfirmEmailArgs(c.env, settings, confirmSubscriptionUrl(c.env, token));
      msg.to = email;
      c.executionCtx.waitUntil(sendEmail(c.env, msg));
    }
  } catch (err: unknown) {
    // Same neutral answer on failure — a 500 here would tell an anonymous
    // caller something the success path deliberately doesn't.
    console.error(`[newsletter] subscribe failed: ${String(err)}`);
  }

  return c.json({ ok: true });
});

/** GET /newsletter-public/subscribe/confirm/:token — who the token belongs to.
 *
 *  Read-only, for the same reason the unsubscribe lookup is: mail scanners and
 *  link-preview crawlers follow GET links in email. If this endpoint completed
 *  the subscription, a corporate spam filter would confirm on the recipient's
 *  behalf and the double opt-in would verify nothing but the mail server. The
 *  confirm page uses this to show the address; the POST below is the act. */
newsletterPublic.get("/subscribe/confirm/:token", async (c) => {
  const row = await pendingConfirmation(c.env, c.req.param("token"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ email: row.email });
});

/** POST /newsletter-public/subscribe/confirm/:token — the address is proven.
 *
 *  Single-use, and clears the preference on BOTH sides the way the unsubscribe
 *  POST does: a member who had opted out and now deliberately re-subscribes
 *  from the public form means it, and leaving `newsletter_opt_out_at` set would
 *  have the subscriber row silently lose to it in `mergeAudience`. */
newsletterPublic.post("/subscribe/confirm/:token", async (c) => {
  const row = await pendingConfirmation(c.env, c.req.param("token"));
  if (!row) return c.json({ error: "not_found" }, 404);

  const now = nowIso();
  // Consume with a compare-and-swap, the same guard newsletter_issue's send
  // uses: D1 has no transaction here, and a double-clicked Confirm must not run
  // the body twice.
  const claim = await c.env.DB.prepare(
    "UPDATE newsletter_confirmation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
  )
    .bind(now, row.id)
    .run();
  if (claim.meta.changes !== 1) return c.json({ ok: true, email: row.email });

  try {
    await c.env.DB.batch([
      // confirmed_at is set on BOTH branches — a returning subscriber has just
      // consented again, and that is the timestamp the digest reports (migration
      // 0014). created_at is left alone, so the first-sighting date survives.
      c.env.DB.prepare(
        `INSERT INTO newsletter_subscriber (id, email, created_at, unsubscribed_at, confirmed_at)
         VALUES (?,?,?,NULL,?)
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL, confirmed_at = excluded.confirmed_at`,
      ).bind(ulid(), row.email, now, now),
      c.env.DB.prepare(
        "UPDATE user SET newsletter_opt_out_at = NULL WHERE email = ? AND newsletter_opt_out_at IS NOT NULL",
      ).bind(row.email),
      // Burn every other live token for this address, not just the one clicked.
      // Someone who pressed "send me a link" twice holds two 7-day tokens; if
      // they later unsubscribe and then clear out their inbox, clicking the
      // older mail would silently re-subscribe them AND clear the opt-out they
      // had just set. An unsubscribe has to stick.
      c.env.DB.prepare(
        "UPDATE newsletter_confirmation SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL",
      ).bind(now, row.email),
    ]);
  } catch (err: unknown) {
    // The token was consumed by the CAS above, so failing here would burn it:
    // the reader's retry would hit the consumed check and be told the link
    // expired, with nothing subscribed. Hand it back and let them click again.
    console.error(`[newsletter] confirm failed, releasing token: ${String(err)}`);
    await c.env.DB.prepare(
      "UPDATE newsletter_confirmation SET consumed_at = NULL WHERE id = ?",
    )
      .bind(row.id)
      .run()
      .catch(() => {});
    return c.json({ error: "internal" }, 500);
  }

  // After the write, and never in front of it: an admin notification failing
  // must not cost someone their subscription.
  c.executionCtx.waitUntil(
    notifyNewSubscriber(c.env, { email: row.email, confirmedAt: now }),
  );

  // Anonymous route, so the audit row has no actor — the confirmed address is
  // the identity it carries, and that is the fact worth being able to prove.
  c.var.audit.push({
    action: "newsletter.subscribed",
    entityKind: "newsletter_subscriber",
    entityId: null,
    detail: { email: row.email, via: "public_form" },
  });

  return c.json({ ok: true, email: row.email });
});

/** A confirmation that is still usable: exists, unconsumed, unexpired. Shared by
 *  the GET and the POST so the two can never disagree about what's valid. */
async function pendingConfirmation(
  env: HonoEnv["Bindings"],
  token: string,
): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT id, email, expires_at, consumed_at FROM newsletter_confirmation WHERE token_hash = ?",
  )
    .bind(await sha256(token))
    .first<{ id: string; email: string; expires_at: string; consumed_at: string | null }>();
  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;
  return { id: row.id, email: row.email };
}

/** GET /newsletter-public/unsubscribe/:token — who the token belongs to.
 *
 *  Read-only on purpose. Mail scanners and link-preview crawlers follow GET
 *  links in email; if this endpoint unsubscribed people, a corporate spam filter
 *  would quietly opt out half the school. The confirm page uses it to show whose
 *  address is about to be removed, and the removal itself is the POST below. */
newsletterPublic.get("/unsubscribe/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT email FROM newsletter_send WHERE unsubscribe_token = ?",
  )
    .bind(c.req.param("token"))
    .first<{ email: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ email: row.email });
});

/** POST /newsletter-public/unsubscribe/:token — stop sending to this address.
 *
 *  Clears the preference on BOTH sides — the member's own opt-out flag and any
 *  standalone subscriber row — because an address can be on the list twice and a
 *  reader who clicks unsubscribe means all of it. */
newsletterPublic.post("/unsubscribe/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT email FROM newsletter_send WHERE unsubscribe_token = ?",
  )
    .bind(c.req.param("token"))
    .first<{ email: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user SET newsletter_opt_out_at = ? WHERE email = ? AND newsletter_opt_out_at IS NULL",
    ).bind(now, row.email),
    c.env.DB.prepare(
      "UPDATE newsletter_subscriber SET unsubscribed_at = ? WHERE email = ? AND unsubscribed_at IS NULL",
    ).bind(now, row.email),
  ]);

  return c.json({ ok: true, email: row.email });
});

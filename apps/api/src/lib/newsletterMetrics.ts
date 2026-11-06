// Readership counters for the public newsletter archive (migration 0042).
//
// The archive page is edge-cached (apps/newsletter/functions/_lib/page.ts), so
// counting the Function's renders would miss most readers — the count instead
// comes from a small inline beacon on the published issue page, which POSTs to
// /newsletter-public/issues/:slug/view on every load. That endpoint is
// anonymous and open by construction (the page it sits on is), so everything
// here treats the request body as noise to be bucketed, never data to be
// stored:
//
//   · `lang` is reduced to LOCALES + "other" — five values, so the view table's
//     growth is bounded no matter what a script POSTs;
//   · a click's `href` is reduced to a parsed HOSTNAME (`destBucket`), with
//     Google-translate proxy hosts mapped back to the real one, and the number
//     of distinct destinations an issue can accrue per day is capped;
//   · nothing else in the body is read, and no request metadata (IP, UA,
//     cookie) is written anywhere. A row is a tally, not a visit.
//
// No audit draft on the write path, deliberately: like `read_budget`
// (invariant 32), a counter bump is not a member action, and one audit row per
// public page load would be exactly the padding invariant 5's coalescing rules
// exist to prevent. The response is the same `{ ok: true }` whatever happened,
// so the endpoint can't be used to distinguish a draft slug from a missing one
// (invariant 10's gate, restated for a POST).

import { LOCALES, isoToZonedDate, resolveTimeZone } from "@sd/shared";
import type { NewsletterMetricsDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";

type Env = HonoEnv["Bindings"];

/** Longest body the beacon ever sends is well under this; anything bigger is
 *  not our beacon and is not worth parsing. */
const MAX_BEACON_BYTES = 2048;

/** Distinct click destinations one issue may accrue per day. Real pages link to
 *  a handful of hosts; the cap is what keeps an open endpoint from minting
 *  unbounded rows out of invented hostnames. */
const MAX_DESTS_PER_ISSUE_DAY = 50;

/** A reading language the view table may hold: one of the site's own four, or
 *  "other" for a translate-proxy target outside them. Never the client's raw
 *  string — the bucket is what bounds the table. */
export function langBucket(value: unknown): string {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
    ? value
    : "other";
}

/** A clicked link reduced to the hostname it leads to, or null for anything
 *  that shouldn't be counted (unparseable, non-http(s)).
 *
 *  A click made INSIDE the translate proxy sees Google's rewritten hrefs
 *  (`calendar-eisenhower-school.translate.goog`), so proxy hosts are decoded
 *  back to the real hostname — Google's encoding is dots→dashes with literal
 *  dashes doubled, the same scheme PROXY_LANGUAGE_SWITCH_JS works around in
 *  newsletterTranslate.ts. Normalizing HERE, server-side, keeps the beacon dumb
 *  and the rule testable. */
export function destBucket(href: unknown): string | null {
  if (typeof href !== "string" || href.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  let host = url.hostname.toLowerCase();
  const proxySuffix = ".translate.goog";
  if (host.endsWith(proxySuffix)) {
    const encoded = host.slice(0, -proxySuffix.length);
    // "--" is a literal "-"; a single "-" is a ".". Split on the doubles first
    // so they can't be misread as two dots.
    host = encoded
      .split("--")
      .map((part) => part.replace(/-/g, "."))
      .join("-");
  }
  return host.slice(0, 100) || null;
}

/** Today as the school sees it — the `day` dimension of both counter tables. */
export function schoolDay(env: Env, now: Date = new Date()): string {
  return isoToZonedDate(now.toISOString(), resolveTimeZone(env.SCHOOL_TIMEZONE));
}

/** Record one beacon hit against a PUBLISHED issue. Never throws to the route:
 *  a counter that could turn a public page load into a 500 would be worse than
 *  no counter. */
export async function recordIssueMetric(env: Env, slug: string, rawBody: string): Promise<void> {
  try {
    if (rawBody.length > MAX_BEACON_BYTES) return;
    let body: { kind?: unknown; lang?: unknown; href?: unknown } = {};
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      // An empty/unparseable body still counts as a view: the beacon always
      // sends one, so this is a degraded client, not a different intent.
    }

    // Published only, resolved here rather than trusted from the path: a draft
    // or unknown slug writes nothing, and the caller answers identically either
    // way (invariant 10 — the counter must not become a slug oracle).
    const issue = await env.DB.prepare(
      "SELECT id FROM newsletter_issue WHERE slug = ? AND published_at IS NOT NULL",
    )
      .bind(slug)
      .first<{ id: string }>();
    if (!issue) return;

    const day = schoolDay(env);

    if (body.kind === "click") {
      const dest = destBucket(body.href);
      if (!dest) return;
      // Increment-or-insert, with the insert gated on the per-day destination
      // cap. The UPDATE-first shape means an existing destination keeps
      // counting even once the cap is reached — the cap bounds ROWS, not
      // clicks.
      const bumped = await env.DB.prepare(
        "UPDATE newsletter_issue_click SET clicks = clicks + 1 WHERE issue_id = ? AND day = ? AND dest = ?",
      )
        .bind(issue.id, day, dest)
        .run();
      if (bumped.meta.changes === 1) return;
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM newsletter_issue_click WHERE issue_id = ? AND day = ?",
      )
        .bind(issue.id, day)
        .first<{ n: number }>();
      if ((row?.n ?? 0) >= MAX_DESTS_PER_ISSUE_DAY) return;
      // ON CONFLICT rather than plain INSERT: two first-clicks racing both
      // land, one as the insert and one as the bump.
      await env.DB.prepare(
        `INSERT INTO newsletter_issue_click (issue_id, day, dest, clicks) VALUES (?,?,?,1)
         ON CONFLICT (issue_id, day, dest) DO UPDATE SET clicks = clicks + 1`,
      )
        .bind(issue.id, day, dest)
        .run();
      return;
    }

    await env.DB.prepare(
      `INSERT INTO newsletter_issue_view (issue_id, day, lang, views) VALUES (?,?,?,1)
       ON CONFLICT (issue_id, day, lang) DO UPDATE SET views = views + 1`,
    )
      .bind(issue.id, day, langBucket(body.lang))
      .run();
  } catch (err: unknown) {
    console.error(`[newsletter] metrics beacon failed: ${String(err)}`);
  }
}

/** How many days of the per-day series the admin screen gets. The tallies
 *  themselves are kept indefinitely (they're tiny and the archive is forever);
 *  this only trims the wire shape. */
const SERIES_DAYS = 60;

interface IssueMetricsRow {
  id: string;
  slug: string;
  title: string;
  published_at: string;
  sent_at: string | null;
}

/** The editor-facing read (GET /newsletter/metrics). Lists PUBLISHED issues —
 *  an unpublished issue has no page, so its (kept) history returns with it if
 *  it is ever republished. */
export async function newsletterMetrics(env: Env): Promise<NewsletterMetricsDTO> {
  const sinceDay = schoolDay(env, new Date(Date.now() - SERIES_DAYS * 24 * 60 * 60 * 1000));
  // The tuple assertion is for noUncheckedIndexedAccess: batch() types as an
  // array, but four statements in produce four results out.
  const [issues, byLang, days, clicks] = (await env.DB.batch([
    env.DB.prepare(
      `SELECT id, slug, title, published_at, sent_at FROM newsletter_issue
        WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 100`,
    ),
    env.DB.prepare(
      "SELECT issue_id, lang, SUM(views) AS views FROM newsletter_issue_view GROUP BY issue_id, lang",
    ),
    env.DB.prepare(
      `SELECT day, SUM(views) AS views FROM newsletter_issue_view
        WHERE day >= ? GROUP BY day ORDER BY day`,
    ).bind(sinceDay),
    env.DB.prepare(
      "SELECT dest, SUM(clicks) AS clicks FROM newsletter_issue_click GROUP BY dest ORDER BY SUM(clicks) DESC LIMIT 20",
    ),
  ])) as [D1Result, D1Result, D1Result, D1Result];

  const langRows = (byLang.results ?? []) as { issue_id: string; lang: string; views: number }[];
  const perIssue = new Map<string, Record<string, number>>();
  for (const r of langRows) {
    const langs = perIssue.get(r.issue_id) ?? {};
    langs[r.lang] = (langs[r.lang] ?? 0) + r.views;
    perIssue.set(r.issue_id, langs);
  }
  let totalViews = 0;
  for (const r of langRows) totalViews += r.views;

  return {
    issues: ((issues.results ?? []) as unknown as IssueMetricsRow[]).map((row) => {
      const langs = perIssue.get(row.id) ?? {};
      return {
        issueId: row.id,
        slug: row.slug,
        title: row.title,
        publishedAt: row.published_at,
        sentAt: row.sent_at,
        total: Object.values(langs).reduce((a, b) => a + b, 0),
        byLang: langs,
      };
    }),
    days: ((days.results ?? []) as { day: string; views: number }[]).map((d) => ({
      day: d.day,
      views: d.views,
    })),
    clicks: ((clicks.results ?? []) as { dest: string; clicks: number }[]).map((r) => ({
      dest: r.dest,
      clicks: r.clicks,
    })),
    totalViews,
  };
}

// GET /e/:date/:slug — the SPA's event page, with a real link preview.
//
// The calendar is a static bundle, and unfurlers (Slack, iMessage, SMS) read
// meta tags without running it. This Function serves the SAME index.html the
// bundle would get, with the event's title/when/where written into the head.
// Nothing else about the page changes; the SPA boots and renders as before.
//
// Reads ONE anonymous route, `/calendar-public/events/:date/:slug`
// (`publicEventOf`, invariant 12) — the very response the page itself fetches —
// so the card can't carry anything the open page doesn't. EVERY failure (unset
// API_BASE, timeout, 404, bad shape) serves the untouched SPA: the preview
// degrades to the generic one and the page never breaks. See ROUTING.md.

import { localeFromSearch, resolveTimeZone, type PublicCalendarEventDTO } from "@sd/shared";
import { cardTags, eventCard } from "../../_lib/unfurl.js";

interface Env {
  API_BASE?: string;
  SCHOOL_TIMEZONE?: string;
}

const TIMEOUT_MS = 1500;
/** An event's time can move; a couple of minutes of staleness is invisible. */
const CACHE_S = 120;

async function lookup(env: Env, date: string, slug: string): Promise<PublicCalendarEventDTO | null> {
  const base = env.API_BASE?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}/calendar-public/events/${encodeURIComponent(date)}/${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cf: { cacheTtl: CACHE_S, cacheEverything: true } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { event?: PublicCalendarEventDTO };
    const e = body.event;
    if (!e || typeof e.title !== "string" || !e.title.trim() || Number.isNaN(Date.parse(e.start))) {
      return null;
    }
    return e;
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  // Start the asset fetch alongside the lookup; both are needed on the happy path.
  const [shellRes, event] = await Promise.all([
    context.next(),
    lookup(
      context.env,
      String(context.params.date ?? ""),
      String(context.params.slug ?? ""),
    ),
  ]);
  if (!event || !shellRes.ok || !(shellRes.headers.get("content-type") ?? "").includes("text/html")) {
    return shellRes;
  }

  const locale = localeFromSearch(url.search) ?? "en";
  const card = eventCard(event, resolveTimeZone(context.env.SCHOOL_TIMEZONE), locale);
  const tags = cardTags(card, `${url.origin}${url.pathname}`, `${url.origin}/icon-512.png`);

  const out = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(card.title);
      },
    })
    .on("head", {
      element(el) {
        el.append(tags, { html: true });
      },
    })
    .transform(shellRes);

  const res = new Response(out.body, out);
  res.headers.set("cache-control", `public, max-age=0, s-maxage=${CACHE_S}`);
  return res;
};

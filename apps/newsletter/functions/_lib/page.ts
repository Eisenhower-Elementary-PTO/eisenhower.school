// Shared HTML shell for the server-rendered public pages.
//
// These run as Cloudflare Pages Functions rather than inside the SPA bundle for
// one reason: link previews. A newsletter gets pasted into text messages, class
// Facebook groups and Slack, and every crawler that builds those previews reads
// the initial HTML without executing JavaScript. A client-rendered page shows
// them an empty document. Rendering here also means a reader opening an issue
// from their inbox never downloads the ~590 kB authoring bundle.
//
// The session cookie is host-only to the API's hostname, so it is NEVER present
// on a navigation to this origin. These pages therefore cannot be — and never
// try to be — auth-aware. That is also why the footer link below is an
// unconditional, static "/app" rather than a "signed in as…" affordance: it
// hands off to the SPA, which resolves who you are and routes accordingly. It
// exists because these pages own `/`, so without it the bare origin is a dead
// end with no way into the app at all.
//
// The footer copy here is English, unlike its counterpart in the SPAs, because
// these pages have no i18n at all: they are rendered before any client runs, so
// there is nothing to read a language preference from and no `?lang=` handling.
// Translating them means giving these functions a locale of their own — worth
// doing, but a larger change than duplicating two lines.

import { formatIssueDate, NEWSLETTER_WEB_CSS, PTO_URL, renderNewsletterIssuePageHtml, SOURCE_URL } from "@sd/shared";
import type { NewsletterIssuePageDTO } from "@sd/shared";

export interface PagesEnv {
  /** Origin of the API Worker, e.g. https://api-directory.eisenhower.school. */
  API_BASE: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ShellInput {
  title: string;
  description: string;
  canonical: string;
  accentColor: string;
  css: string;
  body: string;
  /** Absolute image URL for the link preview card, when there is one. */
  image?: string | null;
  /** Sent when an issue can't be found, so crawlers don't index a 404. */
  noindex?: boolean;
  /** Opens the browser's print dialog on load — this project's "save as PDF".
   *  There is no PDF renderer here and adding one would be a second place for a
   *  newsletter's look to drift from the email (invariant 9), so the browser's
   *  own print engine does the job. The markup is identical either way; the
   *  @media print block in NEWSLETTER_WEB_CSS does the rest. */
  print?: boolean;
}

export function shell(input: ShellInput): string {
  const og = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escapeHtml(input.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}" />`,
    input.image ? `<meta property="og:image" content="${escapeHtml(input.image)}" />` : "",
    `<meta name="twitter:card" content="${input.image ? "summary_large_image" : "summary"}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0f151b" media="(prefers-color-scheme: dark)" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <title>${escapeHtml(input.title)}</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <link rel="canonical" href="${escapeHtml(input.canonical)}" />
    <link rel="alternate" type="application/rss+xml" title="RSS" href="/rss.xml" />
    ${input.noindex ? '<meta name="robots" content="noindex" />' : ""}
    ${og}
    <style>
      :root { --nl-accent: ${escapeHtml(input.accentColor)}; }
      ${input.css}
    </style>
  </head>
  <body>
${input.body}
    <div class="nl-site-foot">
      <div>
        <a href="${PTO_URL}">Eisenhower PTO</a>
        <span aria-hidden="true"> · </span>
        Feedback to <a href="mailto:EisenhowerPTO@hopkinsschools.org">EisenhowerPTO@hopkinsschools.org</a>
        <span aria-hidden="true"> · </span>
        <a href="${SOURCE_URL}">GitHub</a>
      </div>
      <div style="margin-top:10px"><a href="/app">Members: sign in</a></div>
    </div>
${input.print ? PRINT_SCRIPT : ""}
  </body>
</html>`;
}

/** The readership beacon carried by the PUBLIC page of a published issue — the
 *  one page of the four issue routes that is counted, because it is the one
 *  readers get. It POSTs to the API's anonymous counter
 *  (/newsletter-public/issues/:slug/view, lib/newsletterMetrics.ts) on load,
 *  and again for each outbound link click. It runs client-side because the page
 *  itself is edge-cached (html() below): counting server renders would miss
 *  every reader the cache served.
 *
 *  What it sends is deliberately everything it will ever send: a `kind`, a
 *  `lang`, a clicked `href`. No identifier exists on this origin to include —
 *  the session cookie is host-only to the API and never present here — and the
 *  server buckets even these fields before writing (the beacon's word bounds
 *  nothing).
 *
 *  `lang` is how translated readership is seen at all: a translated issue is
 *  read ON translate.goog (invariant 23), where this same script runs inside
 *  Google's rewritten page and reads the target language from `_x_tr_tl`. The
 *  `sessionStorage` guard trims reloads to one view per tab session; it is
 *  best-effort (private windows may throw) and wrapped accordingly.
 *  `navigator.sendBeacon` with a string body is a no-preflight simple request,
 *  which is what lets it fire cross-origin from the proxy's origin too. */
function viewBeacon(env: PagesEnv, slug: string): string {
  const url = `${env.API_BASE}/newsletter-public/issues/${encodeURIComponent(slug)}/view`;
  return `    <script>
(function(){try{
var u=${JSON.stringify(url)};
var send=function(p){var b=JSON.stringify(p);
  if(navigator.sendBeacon){navigator.sendBeacon(u,b)}
  else{fetch(u,{method:"POST",body:b,mode:"no-cors",keepalive:true}).catch(function(){})}};
var lang="en";
if(/\\.translate\\.goog$/.test(location.hostname)){
  lang=new URLSearchParams(location.search).get("_x_tr_tl")||"other"}
var seen=false,k="nl-viewed:"+${JSON.stringify(slug)};
try{seen=sessionStorage.getItem(k)==="1";if(!seen)sessionStorage.setItem(k,"1")}catch(e){}
if(!seen&&!navigator.webdriver)send({kind:"view",lang:lang});
addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a)return;var h=a.href||"";
  if(h.indexOf("http")!==0)return;
  send({kind:"click",href:h});
},true);
}catch(e){}})();
    </script>`;
}

/** Fires the print dialog once the page has settled.
 *
 *  On `load` rather than immediately: a masthead logo that hasn't decoded yet
 *  prints as a gap, and `load` is the one event that waits for images. The
 *  optional chaining is for the rare embedded viewer that exposes no `print`. */
const PRINT_SCRIPT = `    <script>addEventListener("load",function(){window.print&&window.print()})</script>`;

/** Fetch JSON from the API. Returns null on any failure so a page can render a
 *  "not found" rather than a stack trace. */
export async function apiJson<T>(env: PagesEnv, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST JSON to the API and report only whether it was accepted.
 *
 *  Server-to-server from the Function, so these calls never touch CORS and
 *  never carry a cookie — which is the point on the subscribe path: the API's
 *  public routes are the trust boundary, and this is just a browser-friendly
 *  front for them. Returns null on transport failure so a page can say "that
 *  didn't work" rather than 500. */
export async function apiPost<T>(
  env: PagesEnv,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T | null } | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = res.headers.get("content-type")?.includes("application/json")
      ? ((await res.json()) as T)
      : null;
    return { status: res.status, data };
  } catch {
    return null;
  }
}

/** Re-exported so these pages and the SPA's print view can't drift into two
 *  date formats. Lives in @sd/shared next to the renderer that lays out the
 *  page it appears on. */
export { formatIssueDate };

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Short public cache: an issue is immutable once sent, but the archive
      // index changes whenever one is, and a minute of staleness is invisible.
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}

/** Same, but never stored anywhere. For pages whose URL contains a token or
 *  whose body names an address: the shared cache above is keyed on the URL, so
 *  caching a confirmation page would hand the next reader of that URL somebody
 *  else's email address — and would let an already-consumed link keep rendering
 *  as if it were live. */
export function htmlPrivate(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export interface IssuePageOptions {
  /** API path to read the issue from — by public slug or by review token. */
  apiPath: string;
  canonical: string;
  /** "" on a token-reached page: it has no archive entry to go back to. */
  archiveHref: string;
  /** "" on a print view, so the printed page carries no link to itself. */
  printHref: string;
  print: boolean;
  /** false ⇒ htmlPrivate(), which is MANDATORY when the URL contains a token.
   *  A shared cache is keyed on the URL, so caching one would let a revoked link
   *  keep being served from the edge after DELETE …/preview-link — silently
   *  undoing the one guarantee the feature makes. It also keeps the token out of
   *  referrers and out of search indexes. */
  cacheable: boolean;
  /** What the 404 page says when the issue isn't there. */
  notFoundHint: string;
  /** This page's PUBLIC absolute url, for the machine-translation bar, or ""
   *  for no bar. Only /n/:slug passes one — see newsletterTranslate.ts in
   *  @sd/shared: these links are fetched BY Google, so a token url in one would
   *  hand a live review capability (invariant 15) to a caching third party.
   *  It is deliberately its own field rather than reusing `canonical`, which
   *  the token pages also set. Required rather than defaulted for that reason:
   *  a fifth issue-page route has to state its answer, and "" is a decision. */
  issueUrl: string;
}

/** Load one issue and render it as a whole document, or as a 404.
 *
 *  The four issue-page routes — public and review-token, each with a print
 *  twin — differ only in the fields above. Everything after the fetch is
 *  identical, which is exactly what keeps them from drifting back into four
 *  near-copies of the same template as the page grows. */
export async function renderIssuePage(
  env: PagesEnv,
  opts: IssuePageOptions,
): Promise<Response> {
  const send = opts.cacheable ? html : htmlPrivate;
  const issue = await apiJson<NewsletterIssuePageDTO>(env, opts.apiPath);

  if (!issue) {
    return send(
      shell({
        title: "Not found",
        description: "This newsletter issue isn't available.",
        canonical: opts.canonical,
        accentColor: "#0068A8",
        css: NEWSLETTER_WEB_CSS,
        noindex: true,
        body: `    <div class="nl-wrap">
      <div class="nl-empty">
        <p>${escapeHtml(opts.notFoundHint)}</p>
        ${opts.archiveHref ? `<p><a href="${escapeHtml(opts.archiveHref)}">See all issues</a></p>` : ""}
      </div>
    </div>`,
      }),
      404,
    );
  }

  const { branding } = issue;
  // "Draft" to a reader means "not public yet" — a page an editor published
  // without mailing it is the real thing, and must not wear the banner.
  const isDraft = issue.publishedAt === null;
  const body = renderNewsletterIssuePageHtml({
    branding,
    title: issue.title,
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: (attrs) => issue.eventsSnapshot[attrs.blockId] ?? [],
    // "" for an unpublished issue: no "Last edited" bookkeeping on a page
    // whose point is showing a reviewer the issue as readers will get it.
    dateLabel:
      issue.publishedAt !== null ? formatIssueDate(issue.sentAt ?? issue.publishedAt) : "",
    isDraft,
    archiveHref: opts.archiveHref,
    printHref: opts.printHref,
    issueUrl: opts.issueUrl,
    // The printed QR code, on all four routes — a print of a review link for an
    // issue that has since been published should point at it too. It is built
    // from the issue's SLUG, never from this request's url, which on a token
    // page is the token; and the slug is null while the issue is unpublished.
    publishedUrl: issue.slug
      ? `${new URL(opts.canonical).origin}/n/${encodeURIComponent(issue.slug)}`
      : "",
  });

  // Counted: the public page of a published issue, and nothing else. `issueUrl`
  // is non-"" on exactly one route (/n/:slug — see IssuePageOptions); the print
  // twin and both token routes stay dark, so a review link's reads never land
  // in the readership numbers.
  const beacon = opts.issueUrl && !opts.print && issue.slug ? viewBeacon(env, issue.slug) : "";

  return send(
    shell({
      title: `${issue.title} — ${branding.newsletterTitle}`,
      description: issue.subtitle ?? issue.excerpt,
      canonical: opts.canonical,
      accentColor: branding.accentColor,
      css: NEWSLETTER_WEB_CSS,
      image: branding.logoUrl,
      // Exactly one of these four pages is meant to be indexed: the plain,
      // cacheable page of a sent issue. A print view is a second rendering of a
      // page that already exists, and anything reached by a token is nobody's
      // business but the holder's — including after the issue is sent, which is
      // why this keys on `cacheable` rather than on `isDraft`. htmlPrivate()
      // already sends `x-robots-tag` for those, and the header is authoritative;
      // this is the belt to its braces, and it costs a boolean.
      noindex: opts.print || !opts.cacheable,
      print: opts.print,
      body: body + (beacon ? `\n${beacon}` : ""),
    }),
  );
}

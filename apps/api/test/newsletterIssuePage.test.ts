// The public/private seam for newsletter issue pages — the companion to
// calendarPublic.test.ts and volunteersPublic.test.ts, written for the same
// reason: to fail loudly when someone widens what an issue page carries and the
// new field reaches a reader who was never meant to see it.
//
// This seam guards two distinct things.
//
//   The obvious one: `issuePageOf` is fed a row straight out of
//   `newsletter_issue`, a table that now holds `preview_token_hash` — the hash
//   of a live capability URL. A spread instead of a field-by-field projection
//   would publish it on an ENUMERABLE public page.
//
//   The subtler one: an issue page is reachable two ways, by public slug and by
//   review token, and only the first is gated — on `published_at IS NOT NULL`
//   since migration 0031, which split publishing from sending. The tests
//   below pin both — that a draft slug still 404s on the public route, and that
//   the token route answers without a session — because "is gated" is expressed
//   by a WHERE clause in one query and its ABSENCE in the other, and absence is
//   what a diff is worst at showing.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { CalendarEventDTO, NewsletterBrandingDTO } from "@sd/shared";
import {
  NEWSLETTER_PRINT_PAGE,
  NEWSLETTER_PRINT_RULES,
  NEWSLETTER_WEB_CSS,
  renderNewsletterIssuePageHtml,
} from "@sd/shared";
import { issuePageOf, type IssuePageRow } from "../src/lib/newsletter.js";
import { newsletterPublic } from "../src/routes/newsletterPublic.js";
import type { HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";
import { sha256 } from "../src/lib/crypto.js";

/** Every key a reader of an issue page may see. Changing this list is a
 *  deliberate act — if a test failure sent you here, confirm the new field is
 *  safe for a logged-out stranger before adding it. */
const PAGE_KEYS = [
  "slug",
  "title",
  "subtitle",
  "status",
  "sentAt",
  "publishedAt",
  "updatedAt",
  "excerpt",
  "content",
  "eventsSnapshot",
  "branding",
].sort();

const EVENT: CalendarEventDTO = {
  id: "01EVENT",
  kind: "managed",
  seriesId: "01SERIES",
  recurrenceId: "2099-09-10T18:00:00.000Z",
  title: "General Meeting",
  location: "Media Center",
  description: null,
  meetingUrl: null,
  start: "2099-09-10T18:00:00.000Z",
  end: null,
  allDay: false,
  sourceIds: ["01MC"],
  source: { name: "PTO events", color: "#0068A8" },
  volunteerSlug: null,
};

const BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Eisenhower PTO Newsletter",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "<p>Because you're part of the community.</p>",
  calendarUrl: "https://calendar.eisenhower.school",
};

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello families." }] }],
};

function row(over: Partial<IssuePageRow> = {}): IssuePageRow {
  return {
    slug: "2099-09-01-back-to-school",
    title: "Back to school",
    subtitle: "What to expect",
    status: "sent",
    sent_at: "2099-09-01T12:00:00.000Z",
    published_at: "2099-09-01T12:00:00.000Z",
    updated_at: "2099-08-30T12:00:00.000Z",
    content_json: JSON.stringify(DOC),
    events_snapshot_json: JSON.stringify({ blk: [EVENT] }),
    ...over,
  };
}

/** `issuePageOf` only touches the DB when a row has no frozen snapshot; every
 *  case here supplies one, so the env is never read. */
const NO_ENV = {} as HonoEnv["Bindings"];

describe("issuePageOf — the issue-page projection", () => {
  it("emits exactly the agreed key set, and nothing off the row", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    expect(Object.keys(page).sort()).toEqual(PAGE_KEYS);
  });

  it("cannot leak a column added to newsletter_issue", async () => {
    // The row a route hands over may carry more than the projection names —
    // preview_token_hash is the live example, and it is the hash of a working
    // capability URL.
    const wide = {
      ...row(),
      preview_token_hash: "d34db33f",
      preview_token_created_at: "2099-08-30T12:00:00.000Z",
      created_by: "01USER",
      subject: "Back to school",
    } as unknown as IssuePageRow;

    const page = await issuePageOf(NO_ENV, wide, BRANDING);
    expect(Object.keys(page).sort()).toEqual(PAGE_KEYS);
    expect(JSON.stringify(page)).not.toContain("d34db33f");
    expect(JSON.stringify(page)).not.toContain("01USER");
  });

  it("narrows events, withholding the durable handle a signup keys on", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    const event = page.eventsSnapshot.blk?.[0];
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty("seriesId");
    expect(event).not.toHaveProperty("recurrenceId");
    // Present in the source, absent from the response — proving the narrowing
    // ran rather than the fixture simply lacking them.
    expect(EVENT.seriesId).toBe("01SERIES");
    expect(JSON.stringify(page)).not.toContain("01SERIES");
  });

  it("withholds the slug of an issue that isn't published", async () => {
    // That slug names a page which 404s. Handing it to a reviewer invites them
    // to circulate the wrong URL.
    const page = await issuePageOf(
      NO_ENV,
      row({ status: "draft", sent_at: null, published_at: null, events_snapshot_json: "{}" }),
      BRANDING,
    );
    expect(page.slug).toBeNull();
    expect(page.status).toBe("draft");
    expect(page.sentAt).toBeNull();
    expect(page.publishedAt).toBeNull();
  });

  it("reports the slug of a published draft — publishing, not sending, decides", async () => {
    const page = await issuePageOf(
      NO_ENV,
      row({ status: "draft", sent_at: null, published_at: "2099-09-02T00:00:00.000Z", events_snapshot_json: "{}" }),
      BRANDING,
    );
    expect(page.slug).toBe("2099-09-01-back-to-school");
  });

  it("withholds the slug of a sent issue that was unpublished", async () => {
    const page = await issuePageOf(NO_ENV, row({ published_at: null }), BRANDING);
    expect(page.slug).toBeNull();
  });

  it("still reports the slug of a sent one", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    expect(page.slug).toBe("2099-09-01-back-to-school");
  });

  it("survives a corrupt stored snapshot rather than throwing", async () => {
    const page = await issuePageOf(NO_ENV, row({ events_snapshot_json: "{oh no" }), BRANDING);
    expect(page.eventsSnapshot).toEqual({});
  });
});

// ── The rendered page ───────────────────────────────────────────────────────

function render(over: Partial<Parameters<typeof renderNewsletterIssuePageHtml>[0]> = {}) {
  return renderNewsletterIssuePageHtml({
    branding: BRANDING,
    title: "Back to school",
    subtitle: null,
    doc: DOC,
    resolveEvents: () => [],
    dateLabel: "September 1, 2099",
    isDraft: false,
    archiveHref: "/",
    printHref: "/n/x/print",
    issueUrl: "",
    publishedUrl: "",
    ...over,
  });
}

describe("the issue page renderer", () => {
  it("says so, loudly, when the issue has not been sent", () => {
    expect(render({ isDraft: true })).toContain("nl-draft-banner");
    expect(render({ isDraft: false })).not.toContain("nl-draft-banner");
  });

  it("omits the archive link when there is no archive entry to return to", () => {
    // A review link reaches an issue whose /n/ page may not exist.
    const html = render({ archiveHref: "", printHref: "" });
    expect(html).not.toContain("See all issues");
    expect(html).toContain("Back to school");
  });

  it("does not link a print view to itself", () => {
    expect(render({ printHref: "" })).not.toContain("View as PDF");
    expect(render()).toContain("View as PDF");
  });

  it("escapes the title rather than trusting it", () => {
    const html = render({ title: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("wraps the title's and subtitle's emojis so paper can drop them", () => {
    const html = render({ title: "🎉 Back to school", subtitle: "See you there 👋" });
    expect(html).toContain('<span class="nl-emoji">🎉</span>');
    expect(html).toContain('<span class="nl-emoji">👋</span>');
  });
});

describe("the print stylesheet", () => {
  it("ships inside the one stylesheet, so any Ctrl+P comes out clean", () => {
    expect(NEWSLETTER_WEB_CSS).toContain("@media print");
    // Site chrome and the affordance itself are meaningless on paper.
    expect(NEWSLETTER_WEB_CSS).toMatch(/@media print\{[\s\S]*\.nl-site-foot/);
    expect(NEWSLETTER_WEB_CSS).toMatch(/@media print\{[\s\S]*\.nl-print-link/);
  });

  it("hides the footer on paper — the printed copy ends with the issue's content", () => {
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    expect(NEWSLETTER_WEB_CSS.slice(printAt)).toContain(".nl-foot{display:none}");
    // On screen the footer stays — the hide must live in the print block only.
    expect(NEWSLETTER_WEB_CSS.slice(0, printAt)).not.toMatch(/\.nl-foot\{[^}]*display:none/);
  });

  it("keeps the newsletter's NAME off paper — the issue's own title leads the page", () => {
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    // The masthead title is the Settings "newsletter title": site chrome, not
    // content. A configured logo deliberately still prints.
    expect(NEWSLETTER_WEB_CSS.slice(printAt)).toContain(".nl-masthead-title{display:none}");
    // On screen the masthead stays — the hide lives in the print block only.
    expect(NEWSLETTER_WEB_CSS.slice(0, printAt)).not.toMatch(
      /\.nl-masthead-title\{[^}]*display:none/,
    );
  });

  it("keeps the draft banner in ink — that is when it matters most", () => {
    const printBlock = NEWSLETTER_WEB_CSS.slice(NEWSLETTER_WEB_CSS.indexOf("@media print"));
    expect(printBlock).not.toContain("nl-draft-banner");
  });

  it("hides emojis on paper only — black-and-white printing ruins them", () => {
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    const printBlock = NEWSLETTER_WEB_CSS.slice(printAt);
    expect(printBlock).toContain(".nl-emoji{display:none}");
    // No rule outside the print block: on screen the wrapper must stay inert.
    expect(NEWSLETTER_WEB_CSS.slice(0, printAt)).not.toContain(".nl-emoji");
  });

  it("is NEWSLETTER_PRINT_RULES, wrapped — the composer's page estimate measures the same rules", () => {
    // The composer applies these rules on screen in a hidden iframe to estimate
    // printed pages (apps/newsletter/src/lib/printEstimate.ts). The estimate is
    // only honest while what prints and what is measured are ONE constant; a
    // print rule written into the @media block directly would print without
    // ever being measured.
    expect(NEWSLETTER_WEB_CSS).toContain(`@media print{\n${NEWSLETTER_PRINT_RULES}\n}`);
  });

  it("pins the paper and the margins, so a page estimate has a denominator", () => {
    const { widthIn, heightIn, marginIn, contentWidthIn, contentHeightIn } = NEWSLETTER_PRINT_PAGE;
    expect(NEWSLETTER_PRINT_RULES).toContain(`@page{size:${widthIn}in ${heightIn}in;margin:${marginIn}in}`);
    // The content box the estimator lays out against really is page minus margins.
    expect(contentWidthIn).toBeCloseTo(widthIn - 2 * marginIn);
    expect(contentHeightIn).toBeCloseTo(heightIn - 2 * marginIn);
  });

  it("undoes dark mode rather than inheriting it", () => {
    // The failure this catches is silent and only happens to SOME readers: a
    // browser in a dark system theme prints near-white body text onto white
    // paper. Printing IS the PDF export here (invariant 16), so it cannot
    // depend on which theme the reader happens to be in.
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    const darkAt = NEWSLETTER_WEB_CSS.indexOf("@media (prefers-color-scheme:dark)");
    expect(darkAt).toBeGreaterThan(-1);
    // Order IS the precedence — equal specificity, so the later block wins.
    // Moving the dark block below print would silently un-fix this.
    expect(printAt).toBeGreaterThan(darkAt);

    const printBlock = NEWSLETTER_WEB_CSS.slice(printAt);
    // Not just a white background: the text colour has to come back too.
    expect(printBlock).toMatch(/body\{background:#fff;color:#[0-9A-Fa-f]{6}\}/);
    // …and so do the muted greys the dark block lightened.
    expect(printBlock).toContain(".nl-site-foot");
  });

  it("leaves the issue card, and the instance's accent, alone in dark mode", () => {
    const darkAt = NEWSLETTER_WEB_CSS.indexOf("@media (prefers-color-scheme:dark)");
    const darkBlock = NEWSLETTER_WEB_CSS.slice(darkAt, NEWSLETTER_WEB_CSS.indexOf("@media print"));
    // The card stays a light document: the archive has to keep matching what
    // was mailed (invariants 9 and 10). A background here would break that.
    expect(darkBlock).not.toMatch(/\.nl-card\{[^}]*background/);
    // And nothing re-maps --nl-accent, which an admin sets per instance and we
    // have no safe substitute for.
    expect(darkBlock).not.toContain("--nl-accent");
  });

  it("pins dark ink on every surface that stays paper-white", () => {
    // The dark block turns the BODY's colour near-white. A light surface that
    // inherited its text colour then rendered the whole issue light-on-white —
    // which shipped, because nothing checked what the card's text inherits.
    for (const sel of [".nl-card", ".nl-archive-item", ".nl-input"]) {
      const rule = NEWSLETTER_WEB_CSS.match(new RegExp(`\\${sel}\\{([^}]*)\\}`))?.[1] ?? "";
      expect(rule, sel).toMatch(/background:#[0-9A-Fa-f]{6}/);
      expect(rule, sel).toMatch(/(^|;)color:#[0-9A-Fa-f]{6}/);
    }
  });
});

// ── The two routes that reach a page ────────────────────────────────────────

/** D1 stand-in that EVALUATES the slug gate rather than matching its text: the
 *  slug lookup filters on `published_at` only if the SQL says so, so a route
 *  that dropped the clause would serve the unpublished draft and fail here.
 *  `draft` is also reachable by token hash.
 *
 *  The hash is computed with the real `sha256`, not hard-coded: the route hashes
 *  the token before looking it up, and a fixture that hard-coded a digest would
 *  keep passing if that hashing were ever dropped — which is the one thing here
 *  worth catching. */
function testEnv(goodHash: string): HonoEnv["Bindings"] {
  const sent = row();
  const draft = row({
    slug: "2099-10-01-october",
    title: "October news",
    status: "draft",
    sent_at: null,
    published_at: null,
    events_snapshot_json: "{}",
  });
  // Up on the web, never mailed.
  const publishedDraft = row({
    slug: "2099-10-15-printed",
    title: "Printed only",
    status: "draft",
    sent_at: null,
    published_at: "2099-10-15T12:00:00.000Z",
    events_snapshot_json: "{}",
  });
  // Mailed, then taken down.
  const unpublished = row({ slug: "2099-08-01-oops", published_at: null });
  const bySlug = [sent, draft, publishedDraft, unpublished];

  return {
    // getNewsletterSettings falls back to defaults built from these when the
    // `setting` row is absent, which is what the stub below reports.
    SCHOOL_NAME: "Eisenhower PTO",
    NEWSLETTER_URL: "https://newsletter.eisenhower.school",
    CALENDAR_URL: "https://calendar.eisenhower.school",
    SCHOOL_TIMEZONE: "America/Chicago",
    DB: {
      prepare(sql: string) {
        return {
          bind: (arg: string) => ({
            first: async () => {
              if (sql.includes("preview_token_hash = ?")) {
                // Only the hash of the token "good" resolves. The value is
                // sha256("good"); anything else misses, as a revoked or
                // guessed token would.
                return arg === goodHash ? draft : null;
              }
              // The public slug route.
              if (sql.includes("slug = ?")) {
                const hit = bySlug.find((r) => r.slug === arg) ?? null;
                if (!hit) return null;
                return sql.includes("published_at IS NOT NULL") && hit.published_at === null ? null : hit;
              }
              return null;
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/newsletter-public", newsletterPublic);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

describe("issue pages answer without a session", () => {
  const envFor = async () => testEnv(await sha256("good"));

  it("serves a sent issue by its public slug", async () => {
    const res = await appWith().request(
      "/newsletter-public/issues/2099-09-01-back-to-school",
      {},
      await envFor(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS);
  });

  it("404s a slug that names an unpublished draft — the gate review links never touched", async () => {
    const res = await appWith().request(
      "/newsletter-public/issues/2099-10-01-october",
      {},
      await envFor(),
    );
    expect(res.status).toBe(404);
  });

  it("serves a published draft that was never mailed", async () => {
    const res = await appWith().request("/newsletter-public/issues/2099-10-15-printed", {}, await envFor());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("draft");
    expect(body.slug).toBe("2099-10-15-printed");
  });

  it("404s a sent issue that was taken down", async () => {
    const res = await appWith().request("/newsletter-public/issues/2099-08-01-oops", {}, await envFor());
    expect(res.status).toBe(404);
  });

  it("serves that same unsent issue to whoever holds its review token", async () => {
    const res = await appWith().request("/newsletter-public/preview/good", {}, await envFor());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The reviewer sees the real thing, marked as not yet sent — and gets
    // exactly the same key set a public reader eventually will, no more.
    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS);
    expect(body.title).toBe("October news");
    expect(body.status).toBe("draft");
    expect(body.slug).toBeNull();
  });

  it("404s an unknown review token, exactly as a revoked one now does", async () => {
    const res = await appWith().request("/newsletter-public/preview/nope", {}, await envFor());
    expect(res.status).toBe(404);
  });
});

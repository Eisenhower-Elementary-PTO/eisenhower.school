import { describe, it, expect } from "vitest";
import {
  EVENTS_BLOCK_TYPE,
  NEWSLETTER_WEB_CSS,
  NO_EVENTS,
  eventKey,
  newsletterExcerpt,
  renderNewsletterBodyHtml,
  renderNewsletterEmailHtml,
  renderNewsletterText,
  sanitizeNewsletterDoc,
  sanitizeFooterHtml,
  footerHtmlOf,
  footerTextOf,
  collectEventsBlocks,
  type CalendarEventDTO,
  type NewsletterNode,
  issueSlug,
  slugifyTitle,
} from "@sd/shared";
import {
  coerceNewsletterSettings,
  mergeAudience,
  isEmail,
  parseSubscriberList,
} from "../src/lib/newsletter.js";

const doc = (...content: NewsletterNode[]): NewsletterNode => ({ type: "doc", content });
const para = (text: string): NewsletterNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("newsletter sanitizer", () => {
  it("rejects anything that isn't a document", () => {
    expect(sanitizeNewsletterDoc(null)).toBeNull();
    expect(sanitizeNewsletterDoc("<p>hi</p>")).toBeNull();
    expect(sanitizeNewsletterDoc({ type: "paragraph" })).toBeNull();
  });

  it("drops unknown node types but keeps their text", () => {
    const out = sanitizeNewsletterDoc(
      doc({ type: "script", content: [{ type: "text", text: "alert(1)" }] }),
    );
    // The node is gone; the text survives as a bare text node, exactly as
    // htmlToText keeps content while stripping tags.
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).toContain("alert(1)");
  });

  it("strips link marks whose href isn't http(s) or mailto", () => {
    const withJs = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "click",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    });
    const out = sanitizeNewsletterDoc(withJs)!;
    expect(JSON.stringify(out)).not.toContain("javascript");
    // The text itself is preserved — only the dangerous mark is removed.
    expect(JSON.stringify(out)).toContain("click");
  });

  it("keeps a legitimate link", () => {
    const out = sanitizeNewsletterDoc(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://x.test/a" } }] },
        ],
      }),
    )!;
    expect(JSON.stringify(out)).toContain("https://x.test/a");
  });

  it("drops images that aren't remote URLs", () => {
    expect(
      JSON.stringify(sanitizeNewsletterDoc(doc({ type: "image", attrs: { src: "data:image/png;base64,AAA" } }))),
    ).not.toContain("data:");
    expect(
      JSON.stringify(sanitizeNewsletterDoc(doc({ type: "image", attrs: { src: "https://cdn.test/a.png" } }))),
    ).toContain("https://cdn.test/a.png");
  });

  it("demotes an out-of-range heading level rather than emitting it", () => {
    const out = sanitizeNewsletterDoc(doc({ type: "heading", attrs: { level: 9 }, content: [] }))!;
    expect((out.content![0]!.attrs as { level: number }).level).toBe(3);
  });

  it("clamps an events block's lookahead window", () => {
    const out = sanitizeNewsletterDoc(
      doc({ type: EVENTS_BLOCK_TYPE, attrs: { blockId: "a", lookaheadDays: 99999 } }),
    )!;
    expect((out.content![0]!.attrs as { lookaheadDays: number }).lookaheadDays).toBe(365);
  });

  it("keeps a table and enforces its structure", () => {
    const cell = (type: "tableCell" | "tableHeader", text: string, attrs?: Record<string, unknown>): NewsletterNode => ({
      type,
      attrs,
      content: [para(text)],
    });
    const out = sanitizeNewsletterDoc(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "Day"), cell("tableHeader", "Menu")] },
          { type: "tableRow", content: [cell("tableCell", "Mon"), cell("tableCell", "Pizza")] },
          // A non-row smuggled into the table is flattened out, not kept.
          para("stray"),
        ],
      }),
    )!;
    const table = out.content![0]!;
    expect(table.type).toBe("table");
    expect(table.content!.every((r) => r.type === "tableRow")).toBe(true);
    expect(JSON.stringify(out)).toContain("Pizza");
    expect(JSON.stringify(out)).not.toContain("stray");
  });

  it("clamps cell spans and drops colwidth", () => {
    const out = sanitizeNewsletterDoc(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 999, rowspan: "2", colwidth: [340] },
                content: [para("wide")],
              },
            ],
          },
        ],
      }),
    )!;
    const cell = out.content![0]!.content![0]!.content![0]!;
    // colspan clamped to the cap; a non-number rowspan falls back to 1; a
    // stored pixel width never survives to break the 600px email.
    expect(cell.attrs).toEqual({ colspan: 20, rowspan: 1 });
    expect(JSON.stringify(out)).not.toContain("colwidth");
  });

  it("keeps a percentage column width and drops anything else", () => {
    const withWidth = (widthPct: unknown) =>
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", attrs: { widthPct }, content: [para("x")] }],
          },
        ],
      });
    const cellOf = (d: NewsletterNode) => d.content![0]!.content![0]!.content![0]!;
    // A valid percentage survives, rounded to one decimal place.
    expect(cellOf(sanitizeNewsletterDoc(withWidth(33.333))!).attrs).toEqual({
      colspan: 1,
      rowspan: 1,
      widthPct: 33.3,
    });
    // Out of range, non-numeric, or pixel-shaped values leave the column
    // flexible rather than guessing.
    for (const bad of [0, 0.4, 101, -20, "40", "40%", [40], Number.NaN, null]) {
      expect(cellOf(sanitizeNewsletterDoc(withWidth(bad))!).attrs).toEqual({
        colspan: 1,
        rowspan: 1,
      });
    }
  });

  it("keeps an image float and drops anything else", () => {
    const img = (float: unknown) =>
      doc({ type: "image", attrs: { src: "https://cdn.test/a.png", float } });
    expect(sanitizeNewsletterDoc(img("left"))!.content![0]!.attrs).toEqual({
      src: "https://cdn.test/a.png",
      alt: "",
      float: "left",
    });
    expect(sanitizeNewsletterDoc(img("right"))!.content![0]!.attrs).toMatchObject({ float: "right" });
    // Anything else leaves the image the full-width block it has always been.
    for (const bad of ["center", "LEFT", true, 1, null]) {
      expect(sanitizeNewsletterDoc(img(bad))!.content![0]!.attrs).toEqual({
        src: "https://cdn.test/a.png",
        alt: "",
      });
    }
  });

  it("keeps a known text size and drops anything else, keeping the text", () => {
    const sized = (attrs: Record<string, unknown>) =>
      doc({ type: "paragraph", content: [{ type: "text", text: "big news", marks: [{ type: "fontSize", attrs }] }] });
    const ok = sanitizeNewsletterDoc(sized({ size: "large", style: "color:red" }))!;
    // Only the size name survives — no other attribute rides along on the mark.
    expect(ok.content![0]!.content![0]!.marks).toEqual([{ type: "fontSize", attrs: { size: "large" } }]);
    for (const size of ["72px", "huge", "large;background:url(x)", 3, null]) {
      const out = sanitizeNewsletterDoc(sized({ size }))!;
      expect(out.content![0]!.content![0]).toEqual({ type: "text", text: "big news" });
    }
  });
});

describe("newsletter renderer", () => {
  it("escapes text rather than emitting it as markup", () => {
    const html = renderNewsletterBodyHtml(doc(para('<img src=x onerror="alert(1)">')), NO_EVENTS, {
      mode: "email",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("inlines styles for email and uses classes for web", () => {
    const email = renderNewsletterBodyHtml(doc(para("hi")), NO_EVENTS, { mode: "email" });
    const web = renderNewsletterBodyHtml(doc(para("hi")), NO_EVENTS, { mode: "web" });
    // Email clients strip <style> blocks, so every rule has to ride inline.
    expect(email).toContain("style=");
    expect(email).not.toContain("class=");
    expect(web).toContain('class="nl-p"');
    expect(web).not.toContain("style=");
  });

  it("renders a table inline-styled for email and classed for web", () => {
    const table: NewsletterNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para("Day")] },
            { type: "tableHeader", content: [para("Menu")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", attrs: { colspan: 2 }, content: [para("Mon <3")] },
          ],
        },
      ],
    };
    const email = renderNewsletterBodyHtml(doc(table), NO_EVENTS, { mode: "email" });
    expect(email).toContain("<table");
    expect(email).toContain('<th style="');
    expect(email).toContain('<td colspan="2" style="');
    // Cell text is escaped like any other text, and the single-paragraph cell
    // is unwrapped so no <p> margins bloat the rows.
    expect(email).toContain("Mon &lt;3");
    expect(email).not.toContain("<p");
    // Not a layout table: screen readers should navigate an author's table.
    expect(email).not.toContain('<table role="presentation"');

    const web = renderNewsletterBodyHtml(doc(table), NO_EVENTS, { mode: "web" });
    expect(web).toContain('class="nl-table"');
    expect(web).toContain('<th class="nl-th">');
    expect(web).toContain('<td colspan="2" class="nl-td">');
  });

  it("emits percentage column widths the same way for email, web and print", () => {
    const row = (type: "tableHeader" | "tableCell"): NewsletterNode => ({
      type: "tableRow",
      content: [
        { type, attrs: { widthPct: 70 }, content: [para("What")] },
        { type, attrs: { widthPct: 30 }, content: [para("When")] },
      ],
    });
    const table: NewsletterNode = { type: "table", content: [row("tableHeader"), row("tableCell")] };

    const email = renderNewsletterBodyHtml(doc(table), NO_EVENTS, { mode: "email" });
    // Fixed layout is what makes a percentage bind; the width rides as both the
    // attribute (Outlook's Word engine) and the inline style.
    expect(email).toContain("table-layout:fixed");
    expect(email).toMatch(/<th width="70%" style="[^"]*;width:70%"/);
    expect(email).toMatch(/<td width="30%" style="[^"]*;width:30%"/);

    const web = renderNewsletterBodyHtml(doc(table), NO_EVENTS, { mode: "web" });
    expect(web).toContain('class="nl-table nl-table-fixed"');
    expect(web).toContain('<th width="70%" class="nl-th">');
    expect(web).toContain('<td width="30%" class="nl-td">');
    // Print is the same markup under NEWSLETTER_WEB_CSS's print block, so the
    // fixed-layout class existing in that stylesheet is what carries widths to
    // paper.
    expect(NEWSLETTER_WEB_CSS).toContain(".nl-table-fixed{table-layout:fixed}");

    // A widthless table keeps auto layout — fixed would force equal columns
    // the author never asked for.
    const plain: NewsletterNode = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para("x")] }] }],
    };
    const plainWeb = renderNewsletterBodyHtml(doc(plain), NO_EVENTS, { mode: "web" });
    expect(plainWeb).not.toContain("nl-table-fixed");
    expect(plainWeb).not.toMatch(/<t[dh][^>]*width=/);
  });

  it("re-checks widths at render, so an unsanitized width is never emitted", () => {
    const table: NewsletterNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", attrs: { widthPct: 500 }, content: [para("a")] },
            { type: "tableCell", attrs: { widthPct: "60%" }, content: [para("b")] },
          ],
        },
      ],
    };
    const email = renderNewsletterBodyHtml(doc(table), NO_EVENTS, { mode: "email" });
    expect(email).not.toContain('width="500%"');
    expect(email).not.toContain('width="60%"');
    expect(email).not.toContain("table-layout:fixed");
  });

  it("floats an image for email, web and print alike, text wrapping beside it", () => {
    const img: NewsletterNode = {
      type: "image",
      attrs: { src: "https://cdn.test/a.png", alt: "Kids", float: "left" },
    };
    const email = renderNewsletterBodyHtml(doc(img, para("wraps")), NO_EVENTS, { mode: "email" });
    // Outlook's Word engine floats on align/hspace and the pixel width
    // attribute; CSS clients float on the style, whose percentage cap wins.
    expect(email).toContain('align="left"');
    expect(email).toContain('width="288"');
    expect(email).toContain("float:left");
    expect(email).toContain("max-width:48%");

    const web = renderNewsletterBodyHtml(doc(img, para("wraps")), NO_EVENTS, { mode: "web" });
    expect(web).toContain('class="nl-img nl-img-left"');
    // One stylesheet serves screen and print, so the classes existing there is
    // what carries the wrap to paper.
    expect(NEWSLETTER_WEB_CSS).toContain(".nl-img-left{float:left");
    expect(NEWSLETTER_WEB_CSS).toContain(".nl-img-right{float:right");

    const right = renderNewsletterBodyHtml(
      doc({ type: "image", attrs: { src: "https://cdn.test/a.png", float: "right" } }),
      NO_EVENTS,
      { mode: "email" },
    );
    expect(right).toContain('align="right"');
    expect(right).toContain("float:right");

    // An unfloated image renders exactly as it always has.
    const plain = renderNewsletterBodyHtml(
      doc({ type: "image", attrs: { src: "https://cdn.test/a.png" } }),
      NO_EVENTS,
      { mode: "web" },
    );
    expect(plain).toContain('class="nl-img"');
    expect(plain).not.toContain("nl-img-left");
    expect(plain).not.toContain("align=");
  });

  it("re-checks the float at render, so an unsanitized value is never emitted", () => {
    const html = renderNewsletterBodyHtml(
      doc({ type: "image", attrs: { src: "https://cdn.test/a.png", float: 'left" onload="x' } }),
      NO_EVENTS,
      { mode: "email" },
    );
    expect(html).not.toContain("onload");
    expect(html).not.toContain("align=");
    // The image itself survives, as the ordinary full-width block.
    expect(html).toContain("https://cdn.test/a.png");
  });

  it("never emits table markup for a row or cell outside a table", () => {
    const stray = doc(
      { type: "tableCell", content: [para("loose cell")] },
      { type: "tableRow", content: [{ type: "tableCell", content: [para("loose row")] }] },
    );
    // Unsanitized on purpose: the renderer is the allowlist of record and must
    // hold the shape on its own.
    const html = renderNewsletterBodyHtml(stray, NO_EVENTS, { mode: "email" });
    expect(html).not.toContain("<td");
    expect(html).not.toContain("<tr");
    expect(html).toContain("loose cell");
    expect(html).toContain("loose row");
  });

  it("flattens a table to pipe-separated rows in the text part", () => {
    const table: NewsletterNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para("Day")] },
            { type: "tableHeader", content: [para("Menu")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [para("Mon")] },
            { type: "tableCell", content: [para("Pizza")] },
          ],
        },
      ],
    };
    const text = renderNewsletterText(doc(table), NO_EVENTS);
    expect(text).toContain("Day | Menu");
    expect(text).toContain("Mon | Pizza");
  });

  it("renders a text size as a style for email and a class for web", () => {
    const sized = (size: unknown) =>
      doc({ type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "fontSize", attrs: { size } }] }] });
    expect(renderNewsletterBodyHtml(sized("large"), NO_EVENTS, { mode: "email" })).toContain(
      '<span style="font-size:1.25em">hi</span>',
    );
    expect(renderNewsletterBodyHtml(sized("small"), NO_EVENTS, { mode: "web" })).toContain(
      '<span class="nl-fs-small">hi</span>',
    );
    // The renderer re-checks rather than trusting its input: an unsanitized
    // size never reaches a style attribute.
    const bad = renderNewsletterBodyHtml(sized('1em" onmouseover="x'), NO_EVENTS, { mode: "email" });
    expect(bad).not.toContain("onmouseover");
    expect(bad).not.toContain("<span");
  });

  it("wraps emojis for print hiding on the web, and leaves the email alone", () => {
    const d = doc(para("Fall Festival 🎃 tickets 🇺🇸 👩‍👩‍👧 1️⃣ done ⚠️"));
    const web = renderNewsletterBodyHtml(d, NO_EVENTS, { mode: "web" });
    expect(web).toContain('<span class="nl-emoji">🎃</span>');
    // Sequences stay whole — half a ZWJ family or one flag letter on paper
    // would be worse than either showing or hiding.
    expect(web).toContain('<span class="nl-emoji">🇺🇸</span>');
    expect(web).toContain('<span class="nl-emoji">👩‍👩‍👧</span>');
    expect(web).toContain('<span class="nl-emoji">1️⃣</span>');
    expect(web).toContain('<span class="nl-emoji">⚠️</span>');
    // The email is the artifact of record and clients don't honour @media
    // print; it keeps its emojis and gains no markup.
    const email = renderNewsletterBodyHtml(d, NO_EVENTS, { mode: "email" });
    expect(email).toContain("🎃");
    expect(email).not.toContain("nl-emoji");
  });

  it("never mistakes text-presentation characters or digits for emojis", () => {
    // © and ™ default to TEXT presentation; a plain digit or # is a word.
    // Hiding any of them from paper would change what the issue says.
    const web = renderNewsletterBodyHtml(doc(para("© 2026 PTO™ — room #3, grade 5")), NO_EVENTS, {
      mode: "web",
    });
    expect(web).not.toContain("nl-emoji");
  });

  it("renders resolved events and says so when there are none", () => {
    const block: NewsletterNode = {
      type: EVENTS_BLOCK_TYPE,
      attrs: { blockId: "b1", calendarIds: [], lookaheadDays: 14, heading: "This week" },
    };
    const event: CalendarEventDTO = {
      id: "e1",
      kind: "imported",
      title: "Fall Concert",
      location: "Gym",
      description: null,
      meetingUrl: null,
      start: "2026-09-15T23:00:00.000Z",
      end: null,
      allDay: false,
      sourceIds: ["s1"],
      source: { name: "Events", color: "#0068A8" },
      volunteerSlug: null,
    };

    const withEvents = renderNewsletterBodyHtml(doc(block), () => [event], {
      mode: "email",
      timeZone: "America/Chicago",
    });
    expect(withEvents).toContain("Fall Concert");
    expect(withEvents).toContain("This week");
    expect(withEvents).toContain("Gym");

    const empty = renderNewsletterBodyHtml(doc(block), NO_EVENTS, { mode: "email" });
    expect(empty).toContain("No upcoming events");
  });

  it("wraps an event's emojis on the web too — titles are where they live", () => {
    const block: NewsletterNode = {
      type: EVENTS_BLOCK_TYPE,
      attrs: { blockId: "b1", calendarIds: [], lookaheadDays: 14, heading: "This week 📅" },
    };
    const event: CalendarEventDTO = {
      id: "e1",
      kind: "imported",
      title: "Fall Concert 🎶",
      location: "Gym 🏀",
      description: null,
      meetingUrl: null,
      start: "2026-09-15T23:00:00.000Z",
      end: null,
      allDay: false,
      sourceIds: ["s1"],
      source: { name: "Events", color: "#0068A8" },
      volunteerSlug: null,
    };
    const web = renderNewsletterBodyHtml(doc(block), () => [event], { mode: "web" });
    expect(web).toContain('<span class="nl-emoji">📅</span>');
    expect(web).toContain('<span class="nl-emoji">🎶</span>');
    expect(web).toContain('<span class="nl-emoji">🏀</span>');
    const email = renderNewsletterBodyHtml(doc(block), () => [event], { mode: "email" });
    expect(email).not.toContain("nl-emoji");
  });

  it("reads an all-day event's date in UTC, not the render zone", () => {
    // Stored at midnight UTC. Read in Central it would slide back to the 14th.
    const allDay: CalendarEventDTO = {
      id: "e2",
      kind: "imported",
      title: "No School",
      location: null,
      description: null,
      meetingUrl: null,
      start: "2026-09-15T00:00:00.000Z",
      end: null,
      allDay: true,
      sourceIds: ["s1"],
      source: { name: "Events", color: "#0068A8" },
      volunteerSlug: null,
    };
    const html = renderNewsletterBodyHtml(
      doc({ type: EVENTS_BLOCK_TYPE, attrs: { blockId: "b", calendarIds: [], lookaheadDays: 7, heading: null } }),
      () => [allDay],
      { mode: "email", timeZone: "America/Chicago" },
    );
    expect(html).toContain("Sep 15");
    expect(html).not.toContain("Sep 14");
  });

  it("drops an event the author removed, from both the HTML and the text part", () => {
    const keep: CalendarEventDTO = {
      id: "e3", kind: "imported", title: "Book Fair", location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    // Same shape the composer's ✕ writes: an eventKey, not the row id.
    const drop: CalendarEventDTO = { ...keep, id: "e4", title: "Chess Club", start: "2026-08-11T17:00:00.000Z" };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null,
        excluded: [eventKey(drop)],
        heading: null,
      },
    };
    const resolve = () => [keep, drop];

    const html = renderNewsletterBodyHtml(doc(block), resolve, { mode: "email" });
    expect(html).toContain("Book Fair");
    expect(html).not.toContain("Chess Club");

    const text = renderNewsletterText(doc(block), resolve);
    expect(text).toContain("Book Fair");
    expect(text).not.toContain("Chess Club");
  });

  it("says there are no events when every one was removed", () => {
    const only: CalendarEventDTO = {
      id: "e5", kind: "imported", title: "Only Thing", location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const html = renderNewsletterBodyHtml(
      doc({
        type: EVENTS_BLOCK_TYPE,
        attrs: {
          blockId: "b", calendarIds: [], lookaheadDays: 30,
          rangeStart: null, rangeEnd: null, excluded: [eventKey(only)], heading: null,
        },
      }),
      () => [only],
      { mode: "email" },
    );
    expect(html).toContain("No upcoming events");
  });

  it("links out to the calendar site from an events block", () => {
    const e: CalendarEventDTO = {
      id: "e6", kind: "imported", title: "Book Fair", location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const opts = { calendarUrl: "https://calendar.x.test" };

    const email = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "email", ...opts });
    expect(email).toContain('href="https://calendar.x.test"');
    expect(email).toContain("See all events");

    // The archive page renders the same block in web mode.
    const web = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "web", ...opts });
    expect(web).toContain('href="https://calendar.x.test"');
    expect(web).toContain("nl-events-more");

    // Plain text can't hyperlink, so it spells the destination out.
    const text = renderNewsletterText(doc(block), () => [e], opts);
    expect(text).toContain("See all events: https://calendar.x.test");
  });

  it("links each event to its own page on the calendar site", () => {
    const e: CalendarEventDTO = {
      id: "e7", kind: "managed", seriesId: "01SERIES", recurrenceId: "2026-10-18T00:00:00.000Z",
      title: "Fall Carnival", location: "Gym", description: null, meetingUrl: null,
      start: "2026-10-18T00:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const opts = { calendarUrl: "https://calendar.x.test/", timeZone: "America/Chicago" };

    // 7pm Chicago on Oct 17 is Oct 18 in UTC. The path is minted in the ISSUE'S
    // zone, so the link says the day the newsletter says — and the trailing
    // slash on the configured URL must not double up.
    const email = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "email", ...opts });
    expect(email).toContain('href="https://calendar.x.test/e/2026-10-17/fall-carnival"');
    expect(email).not.toContain("test//e/");

    const web = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "web", ...opts });
    expect(web).toContain('href="https://calendar.x.test/e/2026-10-17/fall-carnival"');
    expect(web).toContain("nl-event-title-link");

    // Plain text can't hyperlink, so the destination is spelled out under the
    // title — same convention as every other link in this renderer.
    const text = renderNewsletterText(doc(block), () => [e], opts);
    expect(text).toContain("https://calendar.x.test/e/2026-10-17/fall-carnival");
    expect(text).toContain("Fall Carnival");
  });

  it("leaves event titles unlinked when no calendar URL is configured", () => {
    // Same rule "See all events" follows: a deployment with no calendar host
    // renders as it did before rather than emitting a dead link.
    const e: CalendarEventDTO = {
      id: "e8", kind: "imported", title: "Book Fair", location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "email" });
    expect(html).toContain("Book Fair");
    expect(html).not.toContain("<a href");
    expect(renderNewsletterText(doc(block), () => [e])).not.toContain("http");
  });

  it("refuses to link events through an unsafe calendar URL", () => {
    const e: CalendarEventDTO = {
      id: "e9", kind: "imported", title: "Book Fair", location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), () => [e], {
      mode: "email",
      calendarUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a href");
  });

  it("escapes a title before putting it in a link", () => {
    // The slug is percent-encoded by eventPath; the visible text still has to
    // survive escapeHtml, or a crafted event title is stored XSS on the archive.
    const e: CalendarEventDTO = {
      id: "e10", kind: "imported", title: '<img src=x onerror=alert(1)> "Party"',
      location: null, description: null, meetingUrl: null,
      start: "2026-08-10T14:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" }, volunteerSlug: null,
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), () => [e], {
      mode: "email",
      calendarUrl: "https://calendar.x.test",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    // And the href itself carries no raw quote that could break out of it.
    expect(html).toMatch(/href="https:\/\/calendar\.x\.test\/e\/[^"]*"/);
  });

  it("flags an event that has a volunteer sheet, and links its durable URL", () => {
    // The sheet is rendered on the event's page, but the link is /v/:slug: the
    // slug is the only DURABLE handle a sheet has, where the event path is a
    // content identity a retitle invalidates — and a newsletter outlives both.
    const needs: CalendarEventDTO = {
      id: "e11", kind: "managed", seriesId: "01SERIES", recurrenceId: "2026-10-18T00:00:00.000Z",
      title: "Fall Carnival", location: null, description: null, meetingUrl: null,
      start: "2026-10-18T00:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" },
      volunteerSlug: "fall-carnival-2026",
    };
    const quiet: CalendarEventDTO = { ...needs, id: "e12", title: "Book Fair", volunteerSlug: null };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const opts = { calendarUrl: "https://calendar.x.test/", timeZone: "America/Chicago" };
    const resolve = () => [needs, quiet];

    const email = renderNewsletterBodyHtml(doc(block), resolve, { mode: "email", ...opts });
    expect(email).toContain("Volunteers needed");
    expect(email).toContain('href="https://calendar.x.test/v/fall-carnival-2026"');
    expect(email).not.toContain("test//v/");
    // Exactly one row carries it — an event with no sheet renders as before.
    expect(email.match(/Volunteers needed/g)).toHaveLength(1);

    // The archive page renders the same block in web mode.
    const web = renderNewsletterBodyHtml(doc(block), resolve, { mode: "web", ...opts });
    expect(web).toContain("nl-event-volunteer");
    expect(web).toContain('href="https://calendar.x.test/v/fall-carnival-2026"');

    // Plain text can't hyperlink, so the destination is spelled out.
    const text = renderNewsletterText(doc(block), resolve, opts);
    expect(text).toContain("Volunteers needed: https://calendar.x.test/v/fall-carnival-2026");
  });

  it("says volunteers are needed even with no calendar URL, but links nothing", () => {
    // Same rule the title and "See all events" follow: no calendar host means no
    // link, not a dead one — and the flag itself is still worth saying.
    const e: CalendarEventDTO = {
      id: "e13", kind: "managed", seriesId: "01SERIES", recurrenceId: "2026-10-18T00:00:00.000Z",
      title: "Fall Carnival", location: null, description: null, meetingUrl: null,
      start: "2026-10-18T00:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" },
      volunteerSlug: "fall-carnival-2026",
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), () => [e], { mode: "email" });
    expect(html).toContain("Volunteers needed");
    expect(html).not.toContain("<a href");
    expect(renderNewsletterText(doc(block), () => [e])).toContain("Volunteers needed");
    expect(renderNewsletterText(doc(block), () => [e])).not.toContain("http");
  });

  it("keeps the volunteer link out of an event the author removed", () => {
    const dropped: CalendarEventDTO = {
      id: "e14", kind: "managed", seriesId: "01SERIES", recurrenceId: "2026-10-18T00:00:00.000Z",
      title: "Fall Carnival", location: null, description: null, meetingUrl: null,
      start: "2026-10-18T00:00:00.000Z", end: null, allDay: false,
      sourceIds: ["s1"], source: { name: "Events", color: "#0068A8" },
      volunteerSlug: "fall-carnival-2026",
    };
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [eventKey(dropped)], heading: null,
      },
    };
    const opts = { calendarUrl: "https://calendar.x.test" };
    expect(renderNewsletterBodyHtml(doc(block), () => [dropped], { mode: "email", ...opts }))
      .not.toContain("Volunteers needed");
    expect(renderNewsletterText(doc(block), () => [dropped], opts)).not.toContain("Volunteers needed");
  });

  it("still offers the link when the block came up empty", () => {
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), NO_EVENTS, {
      mode: "email",
      calendarUrl: "https://calendar.x.test",
    });
    expect(html).toContain("No upcoming events");
    expect(html).toContain("See all events");
  });

  it("emits no link at all when no calendar URL is configured", () => {
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), NO_EVENTS, { mode: "email" });
    expect(html).not.toContain("See all events");
    expect(renderNewsletterText(doc(block), NO_EVENTS)).not.toContain("See all events");
  });

  it("refuses a calendar URL that isn't a safe http(s) link", () => {
    const block = {
      type: EVENTS_BLOCK_TYPE,
      attrs: {
        blockId: "b", calendarIds: [], lookaheadDays: 30,
        rangeStart: null, rangeEnd: null, excluded: [], heading: null,
      },
    };
    const html = renderNewsletterBodyHtml(doc(block), NO_EVENTS, {
      mode: "email",
      calendarUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("See all events");
  });

  it("spells out link destinations in the plain-text part", () => {
    const text = renderNewsletterText(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "sign up", marks: [{ type: "link", attrs: { href: "https://x.test/f" } }] },
        ],
      }),
      NO_EVENTS,
    );
    expect(text).toContain("sign up (https://x.test/f)");
  });

  it("leaves events blocks out of the excerpt entirely", () => {
    // Otherwise an archive card reads "Coming up No upcoming events." as though
    // that were the issue's own text.
    const excerpt = newsletterExcerpt(
      doc(
        para("Welcome back!"),
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "b", lookaheadDays: 14, heading: "Coming up" } },
      ),
    );
    expect(excerpt).toBe("Welcome back!");
  });

  it("builds an excerpt that stops at a word boundary", () => {
    const long = para("word ".repeat(80).trim());
    const excerpt = newsletterExcerpt(doc(long), 40);
    expect(excerpt.length).toBeLessThanOrEqual(41); // + the ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("finds every events block in document order", () => {
    const blocks = collectEventsBlocks(
      doc(
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "first", lookaheadDays: 7 } },
        para("between"),
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "second", lookaheadDays: 30 } },
      ),
    );
    expect(blocks.map((b) => b.blockId)).toEqual(["first", "second"]);
    expect(blocks[1]!.lookaheadDays).toBe(30);
  });
});

describe("slugs", () => {
  it("folds accents and punctuation into a URL segment", () => {
    expect(slugifyTitle("Año Nuevo: What's New!")).toBe("ano-nuevo-what-s-new");
  });

  it("prefixes the date so the URL reads as a date", () => {
    expect(issueSlug("Back to School", "2026-08-15T12:00:00.000Z")).toBe("2026-08-15-back-to-school");
  });

  it("falls back to the date alone when the title has no Latin characters", () => {
    expect(issueSlug("学校通讯", "2026-08-15T12:00:00.000Z")).toBe("2026-08-15");
  });
});

describe("audience", () => {
  const user = (id: string, email: string, optedOut = false) => ({ id, email, optedOut });
  const sub = (id: string, email: string, unsubscribed = false) => ({ id, email, unsubscribed });

  it("unions members and standalone subscribers", () => {
    const out = mergeAudience([user("u1", "a@x.test")], [sub("s1", "b@x.test")]);
    expect(out.map((m) => m.email).sort()).toEqual(["a@x.test", "b@x.test"]);
  });

  it("dedupes one address reachable both ways, keeping both handles", () => {
    const out = mergeAudience([user("u1", "A@x.test")], [sub("s1", "a@x.test")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ email: "a@x.test", userId: "u1", subscriberId: "s1" });
  });

  it("excludes opted-out members", () => {
    expect(mergeAudience([user("u1", "a@x.test", true)], [])).toEqual([]);
  });

  it("excludes unsubscribed subscribers", () => {
    expect(mergeAudience([], [sub("s1", "a@x.test", true)])).toEqual([]);
  });

  it("lets a member's opt-out override a stale subscriber row for the same address", () => {
    // Otherwise unsubscribing in the app would silently keep mailing anyone an
    // admin had also added to the standalone list.
    expect(mergeAudience([user("u1", "a@x.test", true)], [sub("s1", "a@x.test")])).toEqual([]);
  });
});

describe("footer html sanitizer", () => {
  // This is the only raw-HTML seam in the newsletter, and its output lands on
  // the PUBLIC archive pages — so these assert what must never survive, not
  // just what should.
  it("keeps ordinary footer markup", () => {
    const out = sanitizeFooterHtml(
      '<p style="text-align:center">Sent by the <strong>PTO</strong> — <a href="https://x.test/board">the board</a></p>',
    );
    expect(out).toContain("<strong>PTO</strong>");
    expect(out).toContain('style="text-align:center"');
    expect(out).toContain('href="https://x.test/board"');
  });

  it("drops scripts along with their contents", () => {
    expect(sanitizeFooterHtml('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
    expect(sanitizeFooterHtml('<style>body{display:none}</style>ok')).toBe("ok");
    expect(sanitizeFooterHtml('<iframe src="https://evil.test"><p>fallback</p></iframe>')).toBe("");
  });

  it("cannot be escaped by an unclosed opaque element", () => {
    // An unterminated <script> must swallow the rest, not resume emitting.
    expect(sanitizeFooterHtml("<p>a</p><script>alert(1)<p>b</p>")).toBe("<p>a</p>");
    // …and a nested one must not end the skip early.
    expect(sanitizeFooterHtml("<script><script></script>alert(1)</script>x")).toBe("x");
  });

  it("strips event handlers and unsafe urls", () => {
    expect(sanitizeFooterHtml('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeFooterHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeFooterHtml('<img src="javascript:alert(1)" />')).toBe("<img />");
    expect(sanitizeFooterHtml('<a href="https://x.test" onmouseover="x">y</a>')).not.toContain(
      "onmouseover",
    );
  });

  it("refuses css that fetches or executes", () => {
    expect(sanitizeFooterHtml('<div style="background:url(https://t.test/p.gif)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(sanitizeFooterHtml('<div style="width:expression(alert(1))">x</div>')).toBe("<div>x</div>");
    // A quote-escape attempt loses the attribute, never the surrounding tag.
    expect(sanitizeFooterHtml('<div style="color:red&quot; onload=&quot;x">y</div>')).toBe(
      "<div>y</div>",
    );
  });

  it("forces external links to open safely", () => {
    const out = sanitizeFooterHtml('<a href="https://x.test" target="_self">x</a>');
    expect(out).toBe('<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("keeps the contents of unknown-but-harmless tags", () => {
    expect(sanitizeFooterHtml("<section><font size=7>PTO</font></section>")).toBe("PTO");
  });

  it("balances tags so a footer can't swallow the page", () => {
    expect(sanitizeFooterHtml("<div><p>hi")).toBe("<div><p>hi</p></div>");
    // A close tag that opened nothing is dropped rather than closing an ancestor.
    expect(sanitizeFooterHtml("<div>a</span>b</div>")).toBe("<div>ab</div>");
    // Crossed nesting closes the inner element rather than leaving it open.
    expect(sanitizeFooterHtml("<em><strong>x</em></strong>")).toBe("<em><strong>x</strong></em>");
  });

  it("escapes a stray angle bracket that didn't parse as a tag", () => {
    expect(sanitizeFooterHtml("5 < 6 & 7 > 2")).toBe("5 &lt; 6 & 7 > 2");
    expect(sanitizeFooterHtml("<p>a<!-- comment -->b</p>")).toBe("<p>ab</p>");
  });

  it("returns an empty string for anything unusable", () => {
    expect(sanitizeFooterHtml(null)).toBe("");
    expect(sanitizeFooterHtml("   ")).toBe("");
    expect(sanitizeFooterHtml(42)).toBe("");
  });

  it("caps how much markup one setting can inject", () => {
    expect(sanitizeFooterHtml("x".repeat(50_000)).length).toBeLessThanOrEqual(20_000);
  });
});

describe("footer selection", () => {
  const branding = (footerHtml: string) => ({
    newsletterTitle: "T",
    accentColor: "#0068A8",
    logoUrl: null,
    footerHtml,
    calendarUrl: "",
  });

  it("passes the stored markup through untouched", () => {
    expect(footerHtmlOf(branding("<p>rich</p>"))).toBe("<p>rich</p>");
    expect(footerHtmlOf(branding(""))).toBe("");
  });

  it("flattens the HTML footer for the text part", () => {
    expect(footerTextOf(branding("<p>rich</p>"))).toBe("rich");
    expect(footerTextOf(branding(""))).toBe("");
  });

  it("reaches the email as markup, not as escaped text", () => {
    const html = renderNewsletterEmailHtml({
      // What's stored is what the sanitizer produced, so that's what's rendered.
      branding: branding(sanitizeFooterHtml('<p><a href="https://x.test">Board</a></p>')),
      title: "Issue",
      subtitle: null,
      doc: doc(para("hello")),
      resolveEvents: NO_EVENTS,
      unsubscribeUrl: "https://x.test/u/1",
      unsubscribeWording: "Done with these?",
      mailingAddress: "1 Main St",
      webUrl: "https://x.test/n/issue",
    });
    expect(html).toContain('<a href="https://x.test" target="_blank" rel="noopener noreferrer">Board</a>');
    expect(html).not.toContain("&lt;p&gt;");
  });
});

describe("settings coercion", () => {
  const base = {
    senderName: "Base",
    senderEmail: "base@x.test",
    replyTo: null,
    footerHtml: "<p>footer</p>",
    mailingAddress: "addr",
    unsubscribeWording: "wording",
    logoUrl: null,
    accentColor: "#0068A8",
    newsletterTitle: "Title",
    defaultCalendarIds: [],
    defaultLookaheadDays: 14,
    timeZone: "America/Chicago",
    calendarUrl: "https://calendar.x.test",
    newSubscriberNotify: "off" as const,
  };

  it("keeps the previous value for a malformed field", () => {
    const out = coerceNewsletterSettings({ accentColor: "not-a-color", senderEmail: "nope" }, base);
    expect(out.accentColor).toBe("#0068A8");
    expect(out.senderEmail).toBe("base@x.test");
  });

  it("accepts an empty sender address as 'fall back to EMAIL_FROM'", () => {
    expect(coerceNewsletterSettings({ senderEmail: "" }, base).senderEmail).toBe("");
  });

  it("clamps the default lookahead window", () => {
    expect(coerceNewsletterSettings({ defaultLookaheadDays: 0 }, base).defaultLookaheadDays).toBe(1);
    expect(coerceNewsletterSettings({ defaultLookaheadDays: 5000 }, base).defaultLookaheadDays).toBe(365);
  });

  it("ignores a non-https logo URL", () => {
    expect(coerceNewsletterSettings({ logoUrl: "javascript:x" }, base).logoUrl).toBeNull();
  });

  it("stores the footer HTML already sanitized", () => {
    const out = coerceNewsletterSettings(
      { footerHtml: '<p>Sent by the PTO</p><script>alert(1)</script>' },
      base,
    );
    expect(out.footerHtml).toBe("<p>Sent by the PTO</p>");
  });

  it("promotes a pre-HTML footerText so an existing footer isn't blanked", () => {
    const out = coerceNewsletterSettings({ footerText: "Sent by the PTO & friends" }, base);
    expect(out.footerHtml).toBe("<p>Sent by the PTO &amp; friends</p>");
  });

  it("prefers stored HTML over a leftover footerText", () => {
    const out = coerceNewsletterSettings(
      { footerText: "old wording", footerHtml: "<p>new</p>" },
      base,
    );
    expect(out.footerHtml).toBe("<p>new</p>");
  });

  it("lets an admin clear the footer instead of resurrecting the default", () => {
    expect(coerceNewsletterSettings({ footerHtml: "" }, base).footerHtml).toBe("");
  });

  it("accepts each valid new-subscriber notification mode", () => {
    for (const mode of ["off", "instant", "daily"] as const) {
      expect(coerceNewsletterSettings({ newSubscriberNotify: mode }, base).newSubscriberNotify)
        .toBe(mode);
    }
  });

  it("refuses to start emailing on an unrecognized notification mode", () => {
    // This field decides whether mail gets sent, so anything unrecognized has
    // to fall back rather than be stored.
    const on = { ...base, newSubscriberNotify: "instant" as const };
    expect(coerceNewsletterSettings({ newSubscriberNotify: "hourly" }, on).newSubscriberNotify)
      .toBe("instant");
    expect(coerceNewsletterSettings({ newSubscriberNotify: true }, base).newSubscriberNotify)
      .toBe("off");
    expect(coerceNewsletterSettings({}, base).newSubscriberNotify).toBe("off");
  });
});

describe("email validation", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(isEmail("a@x.test")).toBe(true);
    expect(isEmail("a@x")).toBe(false);
    expect(isEmail("a b@x.test")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});

describe("parseSubscriberList", () => {
  it("splits on newlines, commas, semicolons and spaces", () => {
    const out = parseSubscriberList("a@x.test\nb@x.test, c@x.test; d@x.test e@x.test");
    expect(out.valid).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"]);
    expect(out.invalid).toEqual([]);
    expect(out.duplicates).toBe(0);
  });

  it("normalizes case/whitespace and dedupes, counting the duplicates", () => {
    const out = parseSubscriberList("  Jane@X.Test \n jane@x.test \n JANE@x.test");
    expect(out.valid).toEqual(["jane@x.test"]);
    expect(out.duplicates).toBe(2);
  });

  it("ignores a name column and reads only the address", () => {
    const out = parseSubscriberList("Jane Doe,jane@x.test\nBob Roe,bob@x.test");
    expect(out.valid).toEqual(["jane@x.test", "bob@x.test"]);
    // "Jane", "Doe", "Bob", "Roe" have no @ and must not be reported as invalid.
    expect(out.invalid).toEqual([]);
  });

  it("strips mailto:, wrapping quotes and angle brackets", () => {
    const out = parseSubscriberList('mailto:a@x.test\n"b@x.test"\nJane <c@x.test>');
    expect(out.valid).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });

  it("reports @-bearing tokens that fail validation as invalid, once each", () => {
    const out = parseSubscriberList("good@x.test\nbad@nope\nbad@nope\nalso@bad");
    expect(out.valid).toEqual(["good@x.test"]);
    expect(out.invalid).toEqual(["bad@nope", "also@bad"]);
  });

  it("returns nothing for blank or address-free input", () => {
    expect(parseSubscriberList("").valid).toEqual([]);
    expect(parseSubscriberList("Jane Doe\nBob Roe").valid).toEqual([]);
    expect(parseSubscriberList("Jane Doe\nBob Roe").invalid).toEqual([]);
  });
});

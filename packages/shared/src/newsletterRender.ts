// The one newsletter renderer. A newsletter issue is stored as a TipTap
// (ProseMirror) JSON document; this module turns that document into HTML three
// times over — the email that gets mailed, the live preview in the composer,
// and the public archive page — so those three can never disagree about what an
// issue says. It is the same reasoning as the calendar's "one recurrence
// engine" rule (CLAUDE.md invariant 9), applied to prose.
//
// Two things follow from being the only renderer:
//
//   1. It is PURE and dependency-free. No DOM, no prosemirror-model. TipTap's
//      own `generateHTML` goes through DOMSerializer, which needs a `document`
//      that neither Workers nor Pages Functions have.
//
//   2. It is the sanitizer. Rendering switches over a fixed allowlist of node
//      and mark types and escapes every text value on the way out, so it
//      CANNOT emit a tag it doesn't know about — there is no string
//      pass-through anywhere. `sanitizeNewsletterDoc` applies the identical
//      allowlist at write time, so a hand-crafted PATCH that bypasses the
//      editor is rejected before it is ever stored.
//
// The ONE exception is the settings footer, where an admin may hand-write HTML.
// It goes through `sanitizeFooterHtml` below, which is a tag-level allowlist
// with the same "can't emit what it doesn't know" property, and it is applied at
// write time so nothing unsanitized is ever stored. Do not add a second raw-HTML
// seam without routing it through that function.
//
// Events are resolved, not stored: a caller supplies `resolveEvents`, which
// looks up one block's events live (while drafting) or from the frozen snapshot
// (at send time and forever after on the archive page). Data resolution is
// impure and differs per call site; rendering is pure and identical.

import { formatClock } from "./clock.js";
import { DEFAULT_TIME_ZONE } from "./timezone.js";
import type {
  CalendarEventDTO,
  NewsletterBrandingDTO,
  NewsletterEventsBlockAttrs,
  NewsletterNode,
} from "./types.js";
import { EVENTS_BLOCK_TYPE, LOCALES } from "./types.js";
import { visibleEvents } from "./newsletterEvents.js";
import { eventPath, type EventPathInput } from "./eventPath.js";
import { htmlToText } from "./text.js";
import { linkQrCode, publishedIssueQrSvg } from "./newsletterQr.js";
import { localeNames } from "./i18n.js";
import {
  newsletterLanguageLinks,
  PROXY_LANG,
  PROXY_LANGUAGE_SWITCH_JS,
  type NewsletterLanguageLink,
} from "./newsletterTranslate.js";

/** Resolves one events block to the events it should render. */
export type EventsResolver = (attrs: NewsletterEventsBlockAttrs) => CalendarEventDTO[];

/** No events anywhere — for excerpts and other text-only passes. */
export const NO_EVENTS: EventsResolver = () => [];

export interface NewsletterRenderOptions {
  /** `email` inlines every style (clients strip <style> unpredictably);
   *  `web` emits class names styled by NEWSLETTER_WEB_CSS. */
  mode: "email" | "web";
  accentColor?: string;
  /** Zone used to name the day/time of a *timed* event. All-day events denote a
   *  calendar date and are always read in UTC (see the note in
   *  apps/web/src/lib/calendar.ts). There is no viewer zone on the server, so
   *  this has to be stated rather than inferred. */
  timeZone?: string;
  locale?: string;
  /** Public calendar site. When set, every events block gets a "See all events"
   *  link out to it. Omitted → no link, so a deployment without a calendar host
   *  configured renders exactly as it did before. */
  calendarUrl?: string;
}

const DEFAULT_ACCENT = "#0068A8";
const DEFAULT_LOCALE = "en-US";

const INK = "#1F2933";
const MUTED = "#56636F";
/** The design system's `--orange`, for the one thing on an issue page that is a
 *  warning rather than content: the "this is a draft" banner. Not the accent —
 *  that is the school's, and an admin may set it to anything, including
 *  something that reads as ordinary chrome. */
const DEFAULT_ORANGE = "#FAAB1C";
/** The "volunteers needed" flag on an event row. A darkened `--orange` rather
 *  than DEFAULT_ORANGE itself, which is a fill colour and fails contrast as
 *  13px text on white; it matches the same flag on the calendar's agenda. Not
 *  the accent, deliberately — this is the one thing in an events block a reader
 *  is being ASKED something by, and it has to survive an accent set to orange. */
const VOLUNTEER = "#A06A00";
const RULE = "#E4E7EB";
const PAPER = "#FFFFFF";
const BACKDROP = "#F4F6F8";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Heading levels TipTap is configured to produce. Anything else is demoted. */
const HEADING_LEVELS = [1, 2, 3] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One emoji, whole, as a reader sees one: a keycap (#️⃣), a flag (a
 *  regional-indicator pair), or a pictographic — either default-emoji, or a
 *  text-default character FORCED emoji by VS16 — together with any skin tone,
 *  VS16, ZWJ continuation and tag characters that belong to it, so a family or
 *  a flag is matched as one unit and never split in half. Characters like ©
 *  and ™ default to TEXT presentation and are deliberately NOT matched without
 *  a VS16: they are words, and hiding "©" from a printed footer line would
 *  change what the issue says. A bare digit or # never matches either — the
 *  keycap branch requires the combining keycap itself. */
const EMOJI =
  /[#*0-9]️?⃣|[\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:[\u{1F3FB}-\u{1F3FF}]|️)*(?:‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:[\u{1F3FB}-\u{1F3FF}]|️)*)*[\u{E0020}-\u{E007F}]*/gu;

/** Wraps each emoji in ALREADY-ESCAPED text so the print stylesheet can drop
 *  it: a black-and-white printer turns an emoji into a grey smudge or an empty
 *  box, so paper goes without them (`.nl-emoji`, hidden under `@media print`
 *  only — on screen the span is inert and the emoji shows as always). Safe to
 *  run after escapeHtml because every branch of EMOJI requires a character no
 *  entity contains. Web mode only, applied via `inlineText`: email clients
 *  don't honour `@media print`, and the mailed issue is the artifact of record
 *  (invariant 10). The one web surface this cannot reach is the hand-written
 *  settings footer, which is stored HTML — wrapping inside it would mean
 *  re-parsing the one seam `sanitizeFooterHtml` already owns, and an emoji
 *  could sit inside an attribute value where a span would break the markup. */
function hideEmojiOnPaper(escaped: string): string {
  return escaped.replace(EMOJI, (m) => `<span class="nl-emoji">${m}</span>`);
}

/** Only protocols that are safe to put in front of a reader. Notably excludes
 *  `javascript:` and `data:`. */
function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** Images must be real remote URLs — an inbox can't render a relative path, and
 *  `data:` URIs are both a bloat and an obfuscation vector. */
function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const src = raw.trim();
  return /^https?:\/\//i.test(src) ? src : null;
}

// ── Sanitization ────────────────────────────────────────────────────────────

const ALLOWED_MARKS = new Set(["bold", "italic", "strike", "code", "link", "fontSize"]);

/** The text sizes an author may pick, as multiples of the surrounding text.
 *  A fixed set rather than a number for the same reason the rest of this file
 *  is an allowlist: the stored value is a NAME, so no attribute can carry a
 *  `font-size` the renderer didn't write — and a newsletter with five sizes on
 *  it reads as a ransom note anyway. Relative (`em`), so "Large" inside a
 *  heading is larger than the heading, and the email's 16px body and the
 *  archive's 17px each scale their own way. "Normal" is the absence of the mark.
 *  The composer's size picker reads this list, so the two cannot disagree. */
export const NEWSLETTER_FONT_SIZES = { small: 0.875, large: 1.25 } as const;
export type NewsletterFontSize = keyof typeof NEWSLETTER_FONT_SIZES;

export function isNewsletterFontSize(v: unknown): v is NewsletterFontSize {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(NEWSLETTER_FONT_SIZES, v);
}

/** Where a block appears. Absent means everywhere — the email, the archive
 *  page and the printed copy. `screen-only` keeps a block off PAPER while the
 *  email and the page still carry it (a photo spread the two-page print can't
 *  afford); `print-only` is the inverse, for a line that only makes sense on
 *  paper ("scan the code for the photos"), and never reaches the email at all.
 *  A NAME from a fixed list, not CSS, for NEWSLETTER_FONT_SIZES' reason: the
 *  renderer writes every style itself (invariant 9). */
export type NewsletterPrintVisibility = "screen-only" | "print-only";

export function isNewsletterPrintVisibility(v: unknown): v is NewsletterPrintVisibility {
  return v === "screen-only" || v === "print-only";
}

/** The node types that may carry `printVisibility`: the blocks an author
 *  arranges a page with. Structural internals (listItem, table rows and
 *  cells) are excluded — half a table hidden on paper is a broken table, and
 *  the editor offers the control block-by-block to match. The composer's
 *  extension reads this set, so the two cannot disagree. */
export const PRINT_VISIBILITY_BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
  "image",
  "table",
  EVENTS_BLOCK_TYPE,
]);
const ALLOWED_BLOCKS = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  EVENTS_BLOCK_TYPE,
]);

/** A cell's colspan/rowspan: a small positive integer or nothing. Clamped on
 *  write AND re-checked at render (the fontSize precedent) so no stored value
 *  can put anything but a digit or two into the emitted attribute. */
function clampSpan(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), 20);
}

/** A cell's column width as a PERCENTAGE of its table, or nothing. Percentages
 *  and never pixels, by design: a percentage authored on a wide screen means
 *  the same thing in the 600px email, on the archive page and on paper, which
 *  is exactly what a stored pixel width (TipTap's `colwidth`) does not. One
 *  decimal place is plenty; out of range is dropped, leaving the column
 *  flexible, like every other attribute this file refuses. Checked on write
 *  AND re-checked at render, the clampSpan precedent. */
function cellWidthPct(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const pct = Math.round(raw * 10) / 10;
  return pct >= 1 && pct <= 100 ? pct : null;
}

/** An image's float, or nothing (the full-width block every image has always
 *  been). Two values and no free text, the fontSize precedent: the value lands
 *  in an attribute and a style, so nothing an editor didn't write may pass.
 *  Checked on write AND re-checked at render. */
function imageFloat(raw: unknown): "left" | "right" | null {
  return raw === "left" || raw === "right" ? raw : null;
}

/** A floated image's share of the measure. Roughly half, so the wrapped text
 *  keeps a readable column beside it; the email restates it as a pixel width
 *  attribute (48% of the 600px measure) because Outlook's Word engine ignores
 *  max-width and would otherwise let a full-resolution photo swallow the line. */
const IMAGE_FLOAT_MAX = "48%";
const IMAGE_FLOAT_EMAIL_PX = 288;

/** An image's caption — the line under the picture that says who is in it.
 *  Plain text, never markup: it is escaped like any other text at render, so
 *  unlike float and the font sizes it needs no enumeration — but it is still
 *  trimmed on write AND re-derived at render, the same both-ends habit. */
function imageCaption(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const caption = raw.trim();
  return caption ? caption : null;
}

function sanitizeMarks(raw: unknown): NewsletterNode["marks"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<NewsletterNode["marks"]> = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type = (m as { type?: unknown }).type;
    if (typeof type !== "string" || !ALLOWED_MARKS.has(type)) continue;
    if (type === "link") {
      const href = safeLinkHref((m as { attrs?: { href?: unknown } }).attrs?.href);
      // A link mark with an unusable href becomes plain text rather than a
      // dead or dangerous anchor.
      if (!href) continue;
      out.push({ type, attrs: { href } });
      continue;
    }
    if (type === "fontSize") {
      // An unknown size is dropped, leaving the text at the normal size.
      const size = (m as { attrs?: { size?: unknown } }).attrs?.size;
      if (!isNewsletterFontSize(size)) continue;
      out.push({ type, attrs: { size } });
      continue;
    }
    out.push({ type });
  }
  return out.length > 0 ? out : undefined;
}

function clampLookahead(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : Number.NaN;
  if (!Number.isFinite(n)) return 14;
  return Math.min(Math.max(n, 1), 365);
}

function sanitizeNode(raw: unknown, path: string): NewsletterNode | NewsletterNode[] | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const type = node.type;
  if (typeof type !== "string") return null;

  if (type === "text") {
    const text = typeof node.text === "string" ? node.text : "";
    if (!text) return null;
    const marks = sanitizeMarks(node.marks);
    return marks ? { type: "text", text, marks } : { type: "text", text };
  }

  const children = Array.isArray(node.content)
    ? node.content.flatMap((child, i) => {
        const s = sanitizeNode(child, `${path}.${i}`);
        return s == null ? [] : Array.isArray(s) ? s : [s];
      })
    : [];

  // An unrecognized node keeps its text — the same strip-tag-keep-content
  // philosophy as text.ts's htmlToText — rather than silently eating content.
  if (!ALLOWED_BLOCKS.has(type)) return children.length > 0 ? children : null;

  const out = sanitizeBlock(type, node, children, path);
  // Carried across every eligible block in ONE place rather than per case, so
  // a block type added to the switch can't forget it. An invalid value — or
  // one on a type the set excludes — is dropped, leaving the block everywhere.
  // TOP-LEVEL blocks only (path "0.N": doc is "0" and each segment is one
  // level down): the renderers honour the mark only where renderNode sees the
  // whole block — a paragraph nested in a list item or table cell renders
  // through unwrap shortcuts and the text renderer's inline(), so a kept mark
  // there would show a badge in the editor while the content mailed and
  // printed anyway. The editor's command already refuses nested targets; this
  // is the same rule applied to a hand-crafted or pasted document.
  if (out && !Array.isArray(out) && PRINT_VISIBILITY_BLOCKS.has(type) && /^\d+\.\d+$/.test(path)) {
    const pv = (node.attrs as Record<string, unknown> | undefined)?.printVisibility;
    if (isNewsletterPrintVisibility(pv)) out.attrs = { ...out.attrs, printVisibility: pv };
  }
  return out;
}

function sanitizeBlock(
  type: string,
  node: Record<string, unknown>,
  children: NewsletterNode[],
  path: string,
): NewsletterNode | NewsletterNode[] | null {
  switch (type) {
    case "heading": {
      const raw = (node.attrs as { level?: unknown } | undefined)?.level;
      const lvl = typeof raw === "number" ? raw : 2;
      const level = (HEADING_LEVELS as readonly number[]).includes(lvl) ? lvl : 3;
      return { type, attrs: { level }, content: children };
    }
    case "image": {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const src = safeImageSrc(attrs.src);
      if (!src) return null;
      const alt = typeof attrs.alt === "string" ? attrs.alt : "";
      const float = imageFloat(attrs.float);
      const caption = imageCaption(attrs.caption);
      return {
        type,
        attrs: { src, alt, ...(float ? { float } : {}), ...(caption ? { caption } : {}) },
      };
    }
    case EVENTS_BLOCK_TYPE: {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const heading = typeof attrs.heading === "string" && attrs.heading.trim()
        ? attrs.heading.trim()
        : null;
      return {
        type,
        attrs: {
          // Positional fallback: stable for a given document shape, so a block
          // whose id went missing still keys consistently into the snapshot.
          blockId:
            typeof attrs.blockId === "string" && attrs.blockId ? attrs.blockId : `block${path}`,
          calendarIds: Array.isArray(attrs.calendarIds)
            ? attrs.calendarIds.filter((v): v is string => typeof v === "string")
            : [],
          lookaheadDays: clampLookahead(attrs.lookaheadDays),
          heading,
        },
      };
    }
    // Table structure is enforced here, not trusted from the editor: a table
    // holds only rows, a row only cells. A hand-crafted PATCH that nests
    // anything else is flattened to its text (the strip-tag-keep-content rule
    // above), so the renderer below can walk the shape without re-deriving it —
    // though it still re-checks, being the allowlist of record (invariant 9).
    case "table": {
      const rows = children.filter((c) => c.type === "tableRow");
      if (rows.length > 0) return { type, content: rows };
      return children.length > 0 ? children : null;
    }
    case "tableRow": {
      const cells = children.filter((c) => c.type === "tableHeader" || c.type === "tableCell");
      if (cells.length > 0) return { type, content: cells };
      return children.length > 0 ? children : null;
    }
    case "tableHeader":
    case "tableCell": {
      // The spans and a PERCENTAGE column width survive. TipTap's `colwidth`
      // (pixel resizing) is still deliberately dropped: a fixed pixel width
      // authored on a wide screen is exactly what breaks a 600px email. The
      // composer's drag-resize therefore converts its pixels to `widthPct` at
      // the save boundary (apps/newsletter tableWidths.ts) and percentages are
      // the only width this document format carries.
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const widthPct = cellWidthPct(attrs.widthPct);
      return {
        type,
        attrs: {
          colspan: clampSpan(attrs.colspan),
          rowspan: clampSpan(attrs.rowspan),
          ...(widthPct != null ? { widthPct } : {}),
        },
        content: children,
      };
    }
    case "horizontalRule":
    case "hardBreak":
      return { type };
    default:
      return { type, content: children };
  }
}

/** Apply the render allowlist at write time. Returns null when the input isn't
 *  a document at all; an empty document is valid and renders as nothing. */
export function sanitizeNewsletterDoc(raw: unknown): NewsletterNode | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as { type?: unknown }).type !== "doc") return null;
  const doc = sanitizeNode(raw, "0");
  if (!doc || Array.isArray(doc) || doc.type !== "doc") return null;
  return doc;
}

// ── Footer HTML ─────────────────────────────────────────────────────────────
//
// The newsletter footer is the one place an admin writes HTML by hand (a PTO
// board list, a sponsor logo row, a couple of styled links). Everything else in
// an issue is TipTap JSON, so this needs its own sanitizer — and it has to be a
// real one, because the footer is echoed onto the PUBLIC archive pages, where a
// surviving `<script>` would be stored XSS on the newsletter origin.
//
// Design, mirroring the document sanitizer above:
//   • Allowlisted tags only. An unknown-but-harmless tag (<section>, <font>) is
//     dropped while its CONTENTS are kept — strip-tag-keep-content, same as
//     sanitizeNode. An unknown-and-dangerous one (<script>, <iframe>, …) is
//     dropped WITH its contents, since its text is code, not prose.
//   • Allowlisted attributes only, re-emitted from parsed values rather than
//     copied through, so nothing rides along inside a mangled quote.
//   • Tags are balanced on the way out. An admin's unclosed <div> must not be
//     able to swallow the rest of the archive page.

/** Tags that carry no content and are emitted self-closed. */
const FOOTER_VOID_TAGS = new Set(["br", "hr", "img"]);

/** Tags dropped along with everything inside them: their content is script,
 *  style or markup we can't vouch for, so keeping the text would be wrong. */
const FOOTER_OPAQUE_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "noscript", "template", "svg", "math", "head", "title", "textarea", "form",
  "input", "button", "select", "option", "link", "meta", "base",
]);

/** Attributes allowed on every allowed tag. */
const FOOTER_GLOBAL_ATTRS = new Set(["style", "title", "dir", "lang"]);

/** Allowed tags → the attributes each may carry beyond the global set. Email
 *  clients still lay out with presentational table attributes, so those stay. */
const FOOTER_TAGS: Record<string, string[]> = {
  p: ["align"],
  div: ["align"],
  span: [],
  a: ["href"],
  strong: [], b: [], em: [], i: [], u: [], s: [], small: [], sub: [], sup: [],
  br: [], hr: [],
  h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ["start"], li: [],
  blockquote: [],
  img: ["src", "alt", "width", "height", "align"],
  table: ["width", "align", "border", "cellpadding", "cellspacing", "bgcolor"],
  thead: [], tbody: [], tfoot: [],
  tr: ["align", "valign", "bgcolor"],
  td: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
  th: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
};

/** Longest footer we'll store. Well past any real footer; a bound on what one
 *  setting can inject into every email and every archive page. */
export const FOOTER_HTML_MAX = 20_000;

/** Matches one markup construct: a comment, a declaration/PI, or a tag whose
 *  attribute list may itself contain quoted `>` characters. */
const FOOTER_CONSTRUCT =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const FOOTER_ATTR =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** CSS we refuse outright rather than try to rewrite: anything that fetches
 *  (`url()`, `@import` — a tracker or an exfil channel on a public page),
 *  anything historically executable (`expression()`, `behavior:`), and any
 *  attempt to escape the attribute. */
const UNSAFE_CSS = /(^|[^a-z-])(url\s*\(|expression\s*\(|@import|behaviou?r\s*:|javascript\s*:|-moz-binding)/i;

function safeStyle(raw: string): string | null {
  const css = raw.trim();
  if (!css || css.length > 500) return null;
  if (UNSAFE_CSS.test(css)) return null;
  // Real CSS in a footer needs none of these, and refusing them outright is a
  // property worth having: whatever ends up inside style="…" is then plain CSS
  // text, with no entity or quote left that could be re-parsed as markup.
  if (/["&<>\\]/.test(css)) return null;
  return css;
}

/** Presentational attributes are numbers, percentages or keywords — never
 *  arbitrary strings. Anything else is dropped rather than escaped through. */
function safePresentational(name: string, value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 40) return null;
  if (name === "bgcolor") return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(v) ? v : null;
  if (name === "align" || name === "valign" || name === "dir" || name === "lang") {
    return /^[a-zA-Z-]+$/.test(v) ? v : null;
  }
  return /^\d+%?$/.test(v) ? v : null;
}

function footerAttrs(tag: string, rawAttrs: string): string {
  const allowed = FOOTER_TAGS[tag];
  if (!allowed) return "";
  const out: string[] = [];
  const seen = new Set<string>();
  FOOTER_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FOOTER_ATTR.exec(rawAttrs)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || seen.has(name)) continue;
    if (!FOOTER_GLOBAL_ATTRS.has(name) && !allowed.includes(name)) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    seen.add(name);

    if (name === "href") {
      const href = safeLinkHref(value);
      if (href) out.push(`href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`);
      continue;
    }
    if (name === "src") {
      const src = safeImageSrc(value);
      if (src) out.push(`src="${escapeHtml(src)}"`);
      continue;
    }
    if (name === "style") {
      const css = safeStyle(value);
      if (css) out.push(`style="${escapeHtml(css)}"`);
      continue;
    }
    if (name === "title" || name === "alt") {
      out.push(`${name}="${escapeHtml(value)}"`);
      continue;
    }
    const safe = safePresentational(name, value);
    if (safe) out.push(`${name}="${escapeHtml(safe)}"`);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

/** Text between tags. Entities are left alone (this is authored HTML, so
 *  `&amp;` means what it says), but a bare `<` that didn't parse as a tag is
 *  escaped so it can't become one downstream. */
function footerText(raw: string): string {
  return raw.replace(/</g, "&lt;");
}

/** Sanitize a hand-written footer to the allowlist above. Applied at write
 *  time, so what's stored is already safe to interpolate into the email and the
 *  public archive pages. Returns "" for anything that isn't usable HTML. */
export function sanitizeFooterHtml(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const input = raw.trim().slice(0, FOOTER_HTML_MAX);
  if (!input) return "";

  const out: string[] = [];
  const open: string[] = [];
  /** Non-empty while inside an opaque element; everything is discarded until
   *  its matching close tag. Nesting is counted so `<script><script>` can't end
   *  the skip early. */
  let opaque = "";
  let opaqueDepth = 0;
  let cursor = 0;

  FOOTER_CONSTRUCT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FOOTER_CONSTRUCT.exec(input)) !== null) {
    if (!opaque) out.push(footerText(input.slice(cursor, m.index)));
    cursor = m.index + m[0].length;

    const closing = m[1] === "/";
    const tag = m[2]?.toLowerCase();
    // A comment or declaration: no tag captured, nothing to emit.
    if (!tag) continue;

    if (opaque) {
      if (tag !== opaque) continue;
      if (closing) {
        opaqueDepth--;
        if (opaqueDepth === 0) opaque = "";
      } else if (!FOOTER_VOID_TAGS.has(tag)) {
        opaqueDepth++;
      }
      continue;
    }

    if (FOOTER_OPAQUE_TAGS.has(tag)) {
      // A stray closing tag has nothing to skip to; just drop it.
      if (!closing) {
        opaque = tag;
        opaqueDepth = 1;
      }
      continue;
    }

    // Unknown but harmless: drop the tag, keep what's inside it.
    if (!(tag in FOOTER_TAGS)) continue;

    if (FOOTER_VOID_TAGS.has(tag)) {
      if (!closing) out.push(`<${tag}${footerAttrs(tag, m[3] ?? "")} />`);
      continue;
    }

    if (closing) {
      const at = open.lastIndexOf(tag);
      // Unbalanced close: ignore it rather than closing something it didn't open.
      if (at < 0) continue;
      // Close everything the admin left open inside it, innermost first.
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
      open.length = at;
      continue;
    }

    out.push(`<${tag}${footerAttrs(tag, m[3] ?? "")}>`);
    open.push(tag);
  }

  if (!opaque) out.push(footerText(input.slice(cursor)));
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);

  return out.join("").trim();
}

/** The footer as HTML: the admin's markup, already sanitized on write. Kept as
 *  a helper rather than inlined so the email and the archive pages can't drift
 *  apart about what a footer is. */
export function footerHtmlOf(branding: NewsletterBrandingDTO): string {
  return branding.footerHtml;
}

/** The footer as plain text, for the email's text part. The footer is authored
 *  once, as HTML, so the text part is that markup flattened — there is no
 *  separate plain-text wording to prefer. */
export function footerTextOf(branding: NewsletterBrandingDTO): string {
  return htmlToText(branding.footerHtml);
}

/** Every events block in the document, in order. Used to know what to resolve
 *  live while drafting and what to freeze at send time. */
export function collectEventsBlocks(doc: NewsletterNode): NewsletterEventsBlockAttrs[] {
  const out: NewsletterEventsBlockAttrs[] = [];
  const walk = (n: NewsletterNode) => {
    if (n.type === EVENTS_BLOCK_TYPE) out.push(eventsAttrs(n));
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

function eventsAttrs(n: NewsletterNode): NewsletterEventsBlockAttrs {
  const a = (n.attrs ?? {}) as Record<string, unknown>;
  return {
    blockId: typeof a.blockId === "string" ? a.blockId : "",
    calendarIds: Array.isArray(a.calendarIds)
      ? a.calendarIds.filter((v): v is string => typeof v === "string")
      : [],
    lookaheadDays: clampLookahead(a.lookaheadDays),
    rangeStart: isoDateOrNull(a.rangeStart),
    rangeEnd: isoDateOrNull(a.rangeEnd),
    excluded: Array.isArray(a.excluded)
      ? a.excluded.filter((v): v is string => typeof v === "string")
      : [],
    heading: typeof a.heading === "string" && a.heading ? a.heading : null,
  };
}

/** A calendar date, or null for anything that isn't one. Shape-checked rather
 *  than trusted: these attrs come out of a stored document. */
function isoDateOrNull(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// ── Event formatting ────────────────────────────────────────────────────────

/** Day label for an event. All-day values are calendar dates stored at midnight
 *  UTC and must be read in UTC; timed values are instants read in `timeZone`. */
export function formatEventDay(
  e: CalendarEventDTO,
  locale: string,
  timeZone: string,
): string {
  return new Date(e.start).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: e.allDay ? "UTC" : timeZone,
  });
}

/** Time label, or null for all-day events (which have no meaningful time). */
export function formatEventTime(
  e: CalendarEventDTO,
  locale: string,
  timeZone: string,
): string | null {
  if (e.allDay) return null;
  return formatClock(e.start, locale, timeZone);
}

// ── HTML rendering ──────────────────────────────────────────────────────────

interface Ctx {
  mode: "email" | "web";
  accent: string;
  timeZone: string;
  locale: string;
  resolve: EventsResolver;
  /** Public calendar site, or "" to omit the "See all" link. */
  calendarUrl: string;
  /** Hrefs already given a print-only QR code in this render, each mapped to
   *  the number printed beside the code and as a superscript after its link,
   *  or null when no codes are drawn at all. Web mode only: an email client
   *  neither honours `@media print` reliably nor renders inline SVG (Gmail
   *  strips it), so the email stays exactly as it was. One code per
   *  DESTINATION, because a link whose text is partly bold arrives as several
   *  text nodes with one href. Numbers run through the whole issue, so a link
   *  repeated further down carries the number of the code already printed. */
  linkQrs: Map<string, number> | null;
  /** Codes drawn while rendering the current block (paragraph, heading, list
   *  item), handed back to that block to place in its own right-hand column.
   *  Null outside such a block, where a link gets no code. */
  qrSink: string[] | null;
}

/** Emit either an inline `style` attribute (email) or a class (web), so one set
 *  of node handlers serves both targets. */
function attr(ctx: Ctx, cls: string, style: string): string {
  return ctx.mode === "email" ? ` style="${style}"` : ` class="${cls}"`;
}

/** Escaped inline text; in web mode its emojis are additionally wrapped so the
 *  print stylesheet can hide them (see hideEmojiOnPaper). For element CONTENT
 *  only — an attribute value (alt, title) must stay escapeHtml alone, since a
 *  span inside a quote is broken markup, and attributes don't print anyway. */
function inlineText(ctx: Ctx, s: string): string {
  const esc = escapeHtml(s);
  return ctx.mode === "web" ? hideEmojiOnPaper(esc) : esc;
}

function renderText(node: NewsletterNode, ctx: Ctx): string {
  let html = inlineText(ctx, node.text ?? "");
  // Marks wrap outward-in; link is applied last so it ends up outermost.
  for (const m of node.marks ?? []) {
    switch (m.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      case "fontSize": {
        // Re-checked rather than trusted from the sanitizer: the renderer is
        // the allowlist of record (invariant 9), so the value interpolated
        // into a style attribute is always one this file defined.
        const size = m.attrs?.size;
        if (!isNewsletterFontSize(size)) break;
        html = `<span${attr(ctx, `nl-fs-${size}`, `font-size:${NEWSLETTER_FONT_SIZES[size]}em`)}>${html}</span>`;
        break;
      }
      default:
        break;
    }
  }
  const link = (node.marks ?? []).find((m) => m.type === "link");
  if (link) {
    const href = safeLinkHref(link.attrs?.href);
    if (href) {
      linkQr(href, ctx);
      html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
  }
  return html;
}

/** Draws the print-only code for a link in the body into the current block's
 *  sink; the block places it (see `qrBlock`). Only links an author put in the
 *  body get one: the events block's generated links go through their own
 *  templates, and an issue with eight events would otherwise grow a column of
 *  codes nobody asked for. */
function linkQr(href: string, ctx: Ctx): void {
  if (!ctx.linkQrs || !ctx.qrSink || ctx.linkQrs.has(href)) return;
  const code = linkQrCode(href);
  if (!code) return;
  const n = ctx.linkQrs.size + 1;
  ctx.linkQrs.set(href, n);
  // `--qz` is the quiet zone's share of the code's height, which the
  // stylesheet turns into the drop that puts the number's top level with the
  // top of the black modules rather than the white border around them.
  const qz = code.quiet.toFixed(4);
  ctx.qrSink.push(`<span class="nl-qr-item" style="--qz:${qz}"><span class="nl-qr-num">${n}</span>${code.svg}</span>`);
}

/** The safe href of a text node's link mark, or null. */
function linkHrefOf(node: NewsletterNode | undefined): string | null {
  if (node?.type !== "text") return null;
  const link = (node.marks ?? []).find((m) => m.type === "link");
  return link ? safeLinkHref(link.attrs?.href) : null;
}

/** The print-only superscript after a link, pairing it with its numbered code
 *  in the block's column. Placed once after the whole link, not after each of
 *  the text nodes a partly-bold link is split into. */
function linkQrRef(href: string | null, ctx: Ctx): string {
  const n = href && ctx.linkQrs?.get(href);
  return n ? `<sup class="nl-qr-ref">${n}</sup>` : "";
}

/** Renders one block's inline content and collects the codes its links drew.
 *
 *  The codes go in a column at the start of the block, which the print
 *  stylesheet floats out into a RAIL: a strip of right-hand margin the whole
 *  body reserves on paper once any block carries a code (`nl-body-rail`, set
 *  by `renderNewsletterIssuePageHtml`). The float sits entirely inside that
 *  margin, so it never narrows a line of text or stretches a block, and every
 *  block keeps the same width and spacing whether or not it holds a link. A
 *  column taller than its block simply runs on beside the next one, and the
 *  next column clears it rather than overlapping. That can leave a code lower
 *  than its link, at worst on the following sheet, which the numbers on code
 *  and link (`linkQrRef`) are there to absorb. */
function qrBlock(ctx: Ctx, render: () => string): { inner: string; col: string } {
  if (!ctx.linkQrs) return { inner: render(), col: "" };
  const outer = ctx.qrSink;
  const sink: string[] = [];
  ctx.qrSink = sink;
  const inner = render();
  ctx.qrSink = outer;
  if (sink.length === 0) return { inner, col: "" };
  return { inner, col: `<span class="nl-qr-col" aria-hidden="true">${sink.join("")}</span>` };
}

/** Reverses escapeHtml on an attribute value. Only for values THIS package
 *  escaped (a sanitized footer's href): escapeHtml writes exactly these five
 *  entities, so undoing them — `&amp;` last, so a double-escaped entity comes
 *  back as the entity, not its character — recovers the stored string. */
function unescapeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The admin's footer with a printed code for each of its links, like the
 *  body's (`qrBlock`). The footer itself no longer PRINTS (`.nl-foot` is
 *  hidden in NEWSLETTER_PRINT_RULES), so these codes are dormant on paper;
 *  the markup is kept so the screen page is unchanged and one CSS line
 *  brings the footer, codes and all, back to print. The
 *  footer is stored HTML rather than TipTap (sanitizeFooterHtml's one seam), so
 *  its links are found by scanning the anchors — safe on sanitizer output,
 *  whose attribute values cannot hold a raw angle bracket — and each href is
 *  re-checked with `safeLinkHref` rather than trusted from storage, the
 *  renderer being the allowlist of record (invariant 9). `ctx` is the one the
 *  BODY rendered with: numbers continue from the body's, and a footer link
 *  repeating a body link reuses its number instead of drawing a second code.
 *  Unlike a body block's column, the returned codes render as one CENTERED
 *  HORIZONTAL ROW beneath the footer's text (`nl-qr-foot`, placed by the
 *  caller after `inner`) — the footer ends the page, so there is no prose
 *  beside it for a rail to keep clear of. A footer without links draws
 *  nothing. Email mode has no `linkQrs` and passes through untouched. */
function footerQrs(html: string, ctx: Ctx): { inner: string; col: string } {
  if (!ctx.linkQrs || !html.includes("<a")) return { inner: html, col: "" };
  const outer = ctx.qrSink;
  const sink: string[] = [];
  ctx.qrSink = sink;
  // Anchors are paired with a stack rather than a lazy open-to-close match, so
  // a (degenerate but storable) nested anchor still puts each ref after its
  // own close tag. An anchor whose unsafe href the sanitizer dropped carries
  // none, and gets no code and no ref.
  const open: (string | null)[] = [];
  const inner = html.replace(/<a\b[^<>]*>|<\/a>/g, (tag) => {
    if (tag[1] !== "/") {
      const m = /\bhref="([^"]*)"/.exec(tag);
      const href = m ? safeLinkHref(unescapeAttr(m[1] ?? "")) : null;
      if (href) linkQr(href, ctx);
      open.push(href);
      return tag;
    }
    return tag + linkQrRef(open.pop() ?? null, ctx);
  });
  ctx.qrSink = outer;
  if (sink.length === 0) return { inner, col: "" };
  return { inner, col: `<span class="nl-qr-foot" aria-hidden="true">${sink.join("")}</span>` };
}

function renderChildren(nodes: NewsletterNode[] | undefined, ctx: Ctx): string {
  const list = nodes ?? [];
  return list
    .map((n, i) => {
      const html = renderNode(n, ctx);
      const href = linkHrefOf(n);
      // Rendered first so the code (and its number) exists before the ref.
      if (!href || linkHrefOf(list[i + 1]) === href) return html;
      return html + linkQrRef(href, ctx);
    })
    .join("");
}

function renderEventsBlock(node: NewsletterNode, ctx: Ctx): string {
  const attrs = eventsAttrs(node);
  // The resolver hands back the whole queried window; the author's removals are
  // applied here so the email, the archive page and both previews drop the same
  // events.
  const events = visibleEvents(attrs, ctx.resolve(attrs));
  const parts: string[] = [];

  if (attrs.heading) {
    parts.push(
      `<h2${attr(ctx, "nl-events-heading", `margin:28px 0 10px;font-size:19px;line-height:1.3;font-weight:700;color:${INK};font-family:${FONT}`)}>${inlineText(ctx, attrs.heading)}</h2>`,
    );
  }

  if (events.length === 0) {
    parts.push(
      `<p${attr(ctx, "nl-events-empty", `margin:0 0 18px;font-size:15px;color:${MUTED};font-family:${FONT}`)}>No upcoming events.</p>`,
    );
    // Still worth offering: a block that came up empty is exactly when a reader
    // wants somewhere else to look.
    parts.push(seeAllLink(ctx));
    return parts.join("");
  }

  // A table, not a flex/grid list: Outlook's rendering engine is Word's, and a
  // table is the only layout primitive it handles predictably.
  const rows = events
    .map((e) => {
      const day = formatEventDay(e, ctx.locale, ctx.timeZone);
      const time = formatEventTime(e, ctx.locale, ctx.timeZone);
      const when = [day, time].filter(Boolean).join(" · ");
      const meta = [when, e.location].filter(Boolean).join(" — ");
      const bar = e.source.color || ctx.accent;
      // Linked when a calendar site is configured, plain otherwise — the same
      // rule "See all events" follows, so a deployment with no calendar host
      // renders exactly as it did before rather than emitting a dead link.
      // Accent-coloured rather than ink, matching that link, because an inbox
      // gives a reader no hover to discover clickability with.
      const href = eventHref(ctx, e);
      const title = inlineText(ctx, e.title);
      const titleHtml = href
        ? `<a href="${escapeHtml(href)}"${attr(ctx, "nl-event-title-link", `color:${ctx.accent};text-decoration:none`)}>${title}</a>`
        : title;
      return `<tr><td${attr(ctx, "nl-event", `padding:10px 0 10px 12px;border-left:3px solid ${escapeHtml(bar)};border-bottom:1px solid ${RULE}`)}>
<div${attr(ctx, "nl-event-title", `font-size:15px;font-weight:600;color:${INK};font-family:${FONT};line-height:1.4`)}>${titleHtml}</div>
<div${attr(ctx, "nl-event-meta", `font-size:13px;color:${MUTED};font-family:${FONT};margin-top:2px`)}>${inlineText(ctx, meta)}</div>${volunteerLine(ctx, e)}
</td></tr>`;
    })
    .join("");

  parts.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${attr(ctx, "nl-events", "width:100%;border-collapse:collapse;margin:0 0 20px")}>${rows}</table>`,
  );
  parts.push(seeAllLink(ctx));
  return parts.join("");
}

/** Absolute URL of ONE event's page on the calendar site, or null when no
 *  calendar URL is configured (or it isn't a safe absolute one).
 *
 *  The path is a content identity — day plus title slug — not an id; see
 *  packages/shared/src/eventPath.ts for why an event has no durable public
 *  handle to link to. Two consequences are worth knowing here:
 *
 *   - The day is minted in the ISSUE'S zone, not a reader's, because there is no
 *     reader when an email is composed. `findEventByPath` searches a day either
 *     side, so a recipient in another zone still lands on the right event.
 *   - A link OUTLIVES what it points at. `calendar_event` keeps roughly two days
 *     of past events, so an archived issue's event links stop resolving shortly
 *     after the event happens, and the page answers with its "event not found"
 *     card and a way back to the calendar. That is the cost of an addressable
 *     event at all, and it degrades to what an unlinked title already offered.
 *
 *  Safe on the public archive page as well as in the email: an event page is
 *  ungated, like the agenda it was reached from.
 */
function eventHref(ctx: Ctx, e: EventPathInput): string | null {
  const base = safeLinkHref(ctx.calendarUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${eventPath(e, ctx.timeZone)}`;
}

/** The public page of ONE occurrence's volunteer sheet, or null when no calendar
 *  URL is configured.
 *
 *  `/v/:slug` rather than the event's own `/e/:date/:slug`, even though the sheet
 *  is RENDERED on the event page and that is where this link lands. The slug is
 *  the only DURABLE handle a sheet has (invariant 13); the event path is a
 *  content identity that a retitle invalidates (invariant 8, eventPath.ts). A
 *  newsletter is mailed once and archived forever, so the link that outlives a
 *  retitle is the right one to put in it — and `/v/:slug` resolving to the event
 *  page is exactly the forward that makes it safe to prefer.
 *
 *  Public on both surfaces this renders for: the sheet's anonymous route
 *  publishes counts and never names, which is the whole reason a sheet has a
 *  slug of its own. */
function volunteerHref(ctx: Ctx, slug: string): string | null {
  const base = safeLinkHref(ctx.calendarUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/v/${encodeURIComponent(slug)}`;
}

/** "Volunteers needed", under an event that has a published sheet — otherwise
 *  the empty string, so a row without one renders exactly as it did before.
 *
 *  The signal is `volunteerSlug`, i.e. "this occurrence has a PUBLISHED sheet",
 *  which is the same thing the calendar's agenda flags and the same words it
 *  uses. It is deliberately not "has unfilled spots": that count is not in the
 *  DTO, and it could not be trusted here even if it were — an events block is
 *  frozen at send (invariant 10), so a live count would be a promise the email
 *  starts breaking the moment somebody signs up.
 *
 *  Unlinked when no calendar URL is configured, like the title and "See all
 *  events" — a deployment without a calendar host still says where help is
 *  wanted, it just can't say where to go. */
function volunteerLine(ctx: Ctx, e: CalendarEventDTO): string {
  if (!e.volunteerSlug) return "";
  const style = `font-size:13px;font-weight:700;color:${VOLUNTEER};font-family:${FONT};margin-top:3px`;
  const href = volunteerHref(ctx, e.volunteerSlug);
  // Colour stated on the anchor too: an inbox restyles a bare <a> blue, and this
  // one is a flag before it is a link.
  const inner = href
    ? `<a href="${escapeHtml(href)}"${attr(ctx, "nl-event-volunteer-link", `color:${VOLUNTEER};text-decoration:none`)}>Volunteers needed →</a>`
    : "Volunteers needed";
  return `\n<div${attr(ctx, "nl-event-volunteer", style)}>${inner}</div>`;
}

/** "See all" out to the public calendar site. Omitted entirely when no calendar
 *  URL was supplied, so a deployment that hasn't set one renders as before
 *  rather than emitting a dead link.
 *
 *  Safe on the public archive page as well as in the email: the calendar's home
 *  screen is deliberately ungated (it reads /calendar-public/*), so this points
 *  a reader at something they can actually open without signing in. */
function seeAllLink(ctx: Ctx): string {
  const href = safeLinkHref(ctx.calendarUrl);
  if (!href) return "";
  // Negative top margin tucks it under whatever it follows — the table and the
  // empty-state paragraph both carry their own bottom margin, and this reads as
  // part of the block rather than a new paragraph after it.
  return `<p${attr(ctx, "nl-events-more", `margin:-12px 0 20px;font-size:13.5px;font-family:${FONT}`)}><a href="${escapeHtml(href)}"${attr(ctx, "nl-events-more-link", `color:${ctx.accent};text-decoration:none;font-weight:600`)}>See all events →</a></p>`;
}

/** The visibility a stored block carries, re-checked against the fixed list
 *  and the eligible types rather than trusted from the sanitizer — the
 *  renderer is the allowlist of record (invariant 9). */
function printVisibilityOf(node: NewsletterNode): NewsletterPrintVisibility | null {
  if (!PRINT_VISIBILITY_BLOCKS.has(node.type)) return null;
  const v = (node.attrs as Record<string, unknown> | undefined)?.printVisibility;
  return isNewsletterPrintVisibility(v) ? v : null;
}

function renderNode(node: NewsletterNode, ctx: Ctx): string {
  const pv = printVisibilityOf(node);
  if (!pv) return renderVisibleNode(node, ctx);
  // The email is a screen, so a screen-only block mails as it always did; a
  // print-only block never reaches an inbox at all — an email client honours
  // no @media print, so there is no way to mail one "hidden".
  if (ctx.mode === "email") {
    return pv === "print-only" ? "" : renderVisibleNode(node, ctx);
  }
  // A screen-only block never prints, so its links draw no margin QR codes
  // (renderTable's reasoning): a code minted here would claim a number that
  // nothing on paper shows, and a later repeat of the link would superscript
  // a reference to it.
  const inner: Ctx = pv === "screen-only" ? { ...ctx, linkQrs: null, qrSink: null } : ctx;
  const html = renderVisibleNode(node, inner);
  if (!html) return "";
  return `<div class="${pv === "print-only" ? "nl-print-only" : "nl-screen-only"}">${html}</div>`;
}

function renderVisibleNode(node: NewsletterNode, ctx: Ctx): string {
  switch (node.type) {
    case "doc":
      return renderChildren(node.content, ctx);
    case "text":
      return renderText(node, ctx);
    case "paragraph": {
      const { inner, col } = qrBlock(ctx, () => renderChildren(node.content, ctx));
      // An empty paragraph is deliberate vertical space in the editor; keep it.
      if (!inner) return `<p${attr(ctx, "nl-p", "margin:0 0 16px;height:8px")}></p>`;
      return `<p${attr(ctx, "nl-p", `margin:0 0 16px;font-size:14px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${col}${inner}</p>`;
    }
    case "heading": {
      const level = (node.attrs as { level?: number } | undefined)?.level ?? 2;
      const size = level === 1 ? 26 : level === 2 ? 21 : 17;
      const top = level === 1 ? 0 : 28;
      const { inner, col } = qrBlock(ctx, () => renderChildren(node.content, ctx));
      return `<h${level}${attr(ctx, `nl-h${level}`, `margin:${top}px 0 12px;font-size:${size}px;line-height:1.3;font-weight:700;color:${INK};font-family:${FONT}`)}>${col}${inner}</h${level}>`;
    }
    case "bulletList":
      return `<ul${attr(ctx, "nl-ul", `margin:0 0 16px;padding-left:22px;font-size:14px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${renderChildren(node.content, ctx)}</ul>`;
    case "orderedList":
      return `<ol${attr(ctx, "nl-ol", `margin:0 0 16px;padding-left:22px;font-size:14px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${renderChildren(node.content, ctx)}</ol>`;
    case "listItem": {
      // TipTap wraps each item's text in a paragraph; unwrap the single-child
      // case so list items don't inherit the paragraph's bottom margin.
      // A multi-block item leaves its codes to its own paragraphs.
      const kids = node.content ?? [];
      if (kids.length === 1 && kids[0]?.type === "paragraph") {
        const { inner, col } = qrBlock(ctx, () => renderChildren(kids[0]!.content, ctx));
        return `<li${attr(ctx, "nl-li", "margin:0 0 6px")}>${col}${inner}</li>`;
      }
      return `<li${attr(ctx, "nl-li", "margin:0 0 6px")}>${renderChildren(kids, ctx)}</li>`;
    }
    case "blockquote":
      return `<blockquote${attr(ctx, "nl-quote", `margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${ctx.accent};color:${MUTED};font-style:italic`)}>${renderChildren(node.content, ctx)}</blockquote>`;
    case "horizontalRule":
      return `<hr${attr(ctx, "nl-hr", `border:0;border-top:1px solid ${RULE};margin:26px 0`)} />`;
    case "hardBreak":
      return "<br />";
    case "image": {
      const a = (node.attrs ?? {}) as {
        src?: string;
        alt?: string;
        float?: unknown;
        caption?: unknown;
      };
      const src = safeImageSrc(a.src);
      if (!src) return "";
      const float = imageFloat(a.float);
      const caption = imageCaption(a.caption);
      if (!float) {
        if (!caption) {
          return `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.alt ?? "")}"${attr(ctx, "nl-img", "display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 18px")} />`;
        }
        // A captioned image hands its bottom margin to the caption line, so the
        // pair reads as one block and the next paragraph keeps its distance.
        return (
          `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.alt ?? "")}"${attr(ctx, "nl-img nl-img-captioned", "display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 6px")} />` +
          `<p${attr(ctx, "nl-img-caption", `margin:0 0 18px;font-size:12px;line-height:1.4;color:${MUTED};font-family:${FONT}`)}>${inlineText(ctx, caption)}</p>`
        );
      }
      // A floated image needs BOTH forms, because the two email worlds split:
      // Outlook's Word engine floats on the align attribute (and hspace/vspace
      // for the gap) while ignoring float, max-width and margins; everything
      // with CSS floats on the style, whose margins override the presentational
      // hints. Pixel width attribute for Word again (it ignores max-width, and
      // a full-resolution photo would otherwise take the whole measure); the
      // style's percentage cap wins wherever CSS runs, so a narrow phone still
      // gets a wrapped column. The web page's classes carry the same geometry
      // in NEWSLETTER_WEB_CSS, print included.
      const margin = float === "left" ? "4px 18px 10px 0" : "4px 0 10px 18px";
      if (!caption) {
        const style = `float:${float};width:${IMAGE_FLOAT_EMAIL_PX}px;max-width:${IMAGE_FLOAT_MAX};height:auto;border-radius:8px;margin:${margin}`;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.alt ?? "")}" align="${float}" hspace="12" vspace="4" width="${IMAGE_FLOAT_EMAIL_PX}"${attr(ctx, `nl-img nl-img-${float}`, style)} />`;
      }
      // A floated caption can't be a sibling paragraph — nothing would keep it
      // under its picture — so the pair rides a one-cell layout table, the one
      // float wrapper every mail engine has: Outlook's Word engine floats the
      // table on its align attribute (with a snug wrap — it ignores the margin,
      // a known and accepted cost of captioning a float there), everything with
      // CSS floats on the style, same geometry as the bare floated image.
      const tableStyle = `float:${float};width:${IMAGE_FLOAT_EMAIL_PX}px;max-width:${IMAGE_FLOAT_MAX};border-collapse:collapse;margin:${margin}`;
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${float}" width="${IMAGE_FLOAT_EMAIL_PX}"${attr(ctx, `nl-fig nl-fig-${float}`, tableStyle)}><tr><td${attr(ctx, "nl-fig-td", "padding:0")}>` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.alt ?? "")}" width="${IMAGE_FLOAT_EMAIL_PX}"${attr(ctx, "nl-fig-img", "display:block;width:100%;height:auto;border-radius:8px")} />` +
        `<p${attr(ctx, "nl-img-caption", `margin:4px 0 0;font-size:12px;line-height:1.35;color:${MUTED};font-family:${FONT}`)}>${inlineText(ctx, caption)}</p>` +
        `</td></tr></table>`
      );
    }
    case "table":
      return renderTable(node, ctx);
    case EVENTS_BLOCK_TYPE:
      return renderEventsBlock(node, ctx);
    default:
      // Unreachable for sanitized input; render children rather than vanish.
      // Among what lands here: a tableRow or tableCell that somehow isn't
      // inside a table — author rows and cells are emitted only by renderTable
      // (the captioned-float wrapper above builds its own one-cell table whole),
      // so out of place they render as their text, never as stray table markup.
      return renderChildren(node.content, ctx);
  }
}

/** An author's table. The whole structure — rows and cells included — is
 *  emitted here and nowhere else, re-checked rather than trusted from the
 *  sanitizer, so no document shape can produce a <td> outside a <table>.
 *
 *  Borderless by design — structure reads from the header row's background and
 *  the cell padding; border="0" on the element keeps Outlook from drawing its
 *  own default grid. Email constraints shape the rest: every text style
 *  restated on the cell (styles don't inherit into table cells in Word's
 *  engine), width:100% so the table takes the 600px measure rather than its
 *  content's whims. NOT role="presentation" — unlike the events block's layout
 *  table, this one is a real data table an author made, and a screen reader
 *  should navigate it as one. */
function renderTable(node: NewsletterNode, ctx: Ctx): string {
  // Print-only link QR codes are suspended inside a table: the codes place
  // themselves by floating into a reserved right-hand margin rail (qrBlock),
  // and a float with a page-margin-sized negative margin inside a table cell
  // lands in the middle of the neighbouring column. Links in cells stay
  // ordinary links, like the events block's generated ones.
  const inner: Ctx = { ...ctx, linkQrs: null, qrSink: null };
  const rowNodes = (node.content ?? []).filter((r) => r.type === "tableRow");
  const rows = rowNodes.map((r) => renderTableRow(r, inner)).join("");
  if (!rows) return "";
  // Percentage column widths only bind reliably under fixed layout (auto
  // layout treats them as hints and lets content win), so a table with any
  // authored width gets table-layout:fixed — inline for email, a class for the
  // web page, whose @media print block inherits it, so paper agrees too. A
  // widthless table keeps auto layout: fixed would force equal columns where
  // the author asked for nothing.
  const sized = rowNodes.some((r) =>
    (r.content ?? []).some(
      (c) =>
        (c.type === "tableHeader" || c.type === "tableCell") &&
        cellWidthPct((c.attrs as Record<string, unknown> | undefined)?.widthPct) != null,
    ),
  );
  const cls = sized ? "nl-table nl-table-fixed" : "nl-table";
  const layout = sized ? "table-layout:fixed;" : "";
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%"${attr(ctx, cls, `width:100%;${layout}border-collapse:collapse;margin:0 0 16px`)}>${rows}</table>`;
}

function renderTableRow(row: NewsletterNode, ctx: Ctx): string {
  const cells = (row.content ?? [])
    .filter((c) => c.type === "tableHeader" || c.type === "tableCell")
    .map((c) => renderTableCell(c, ctx))
    .join("");
  return `<tr>${cells}</tr>`;
}

function renderTableCell(cell: NewsletterNode, ctx: Ctx): string {
  const header = cell.type === "tableHeader";
  const tag = header ? "th" : "td";
  const a = (cell.attrs ?? {}) as Record<string, unknown>;
  const colspan = clampSpan(a.colspan);
  const rowspan = clampSpan(a.rowspan);
  const spans = `${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}`;
  // An authored column width rides as the HTML width ATTRIBUTE in both modes —
  // it's what Outlook's Word engine lays out with, and in the browser it maps
  // to the width property, so the classed web/print output needs no inline
  // style. Email restates it in the style too, like every other cell style.
  const widthPct = cellWidthPct(a.widthPct);
  const width = widthPct != null ? ` width="${widthPct}%"` : "";
  const base = `padding:8px 10px;font-size:15px;line-height:1.5;color:${INK};font-family:${FONT};text-align:left;vertical-align:top`;
  const style =
    (header ? `${base};font-weight:700;background:${BACKDROP}` : base) +
    (widthPct != null ? `;width:${widthPct}%` : "");
  const styled = attr(ctx, header ? "nl-th" : "nl-td", style);
  // The single-paragraph cell is unwrapped, like a list item's, so the common
  // cell doesn't inherit the paragraph's bottom margin or its 16px body size.
  const kids = cell.content ?? [];
  const inner =
    kids.length === 1 && kids[0]?.type === "paragraph"
      ? renderChildren(kids[0].content, ctx)
      : renderChildren(kids, ctx);
  return `<${tag}${spans}${width}${styled}>${inner}</${tag}>`;
}

/** One render's context from the public options. Shared by the body entry
 *  point below and by `renderNewsletterIssuePageHtml`, which keeps the SAME
 *  context across the body and the footer so their printed link codes share
 *  one numbering (see `footerQrs`). */
function renderCtx(resolveEvents: EventsResolver, opts: NewsletterRenderOptions): Ctx {
  return {
    mode: opts.mode,
    accent: opts.accentColor || DEFAULT_ACCENT,
    timeZone: opts.timeZone || DEFAULT_TIME_ZONE,
    locale: opts.locale || DEFAULT_LOCALE,
    resolve: resolveEvents,
    calendarUrl: opts.calendarUrl ?? "",
    linkQrs: opts.mode === "web" ? new Map() : null,
    qrSink: null,
  };
}

/** The issue body only — no masthead, no footer. Callers wrap it. */
export function renderNewsletterBodyHtml(
  doc: NewsletterNode,
  resolveEvents: EventsResolver,
  opts: NewsletterRenderOptions,
): string {
  return renderNode(doc, renderCtx(resolveEvents, opts));
}

// ── Plain text ──────────────────────────────────────────────────────────────

/** Plain-text alternative for the email's `text` part. Also the basis for
 *  archive excerpts and OG descriptions. */
export function renderNewsletterText(
  doc: NewsletterNode,
  resolveEvents: EventsResolver,
  opts: Pick<NewsletterRenderOptions, "timeZone" | "locale" | "calendarUrl"> = {},
): string {
  const timeZone = opts.timeZone || DEFAULT_TIME_ZONE;
  const locale = opts.locale || DEFAULT_LOCALE;
  const calendarUrl = safeLinkHref(opts.calendarUrl);
  const out: string[] = [];

  const inline = (n: NewsletterNode): string => {
    if (n.type === "text") {
      const link = (n.marks ?? []).find((m) => m.type === "link");
      const href = link ? safeLinkHref(link.attrs?.href) : null;
      // Plain text can't hyperlink, so a link's destination is spelled out.
      return href ? `${n.text ?? ""} (${href})` : n.text ?? "";
    }
    if (n.type === "hardBreak") return "\n";
    return (n.content ?? []).map(inline).join("");
  };

  const block = (n: NewsletterNode, depth: number) => {
    // The text part is the email's twin, and excerpts describe the page a
    // reader will open: neither is paper, so a print-only block is left out,
    // exactly as the email HTML leaves it out. Screen-only blocks stay.
    if (printVisibilityOf(n) === "print-only") return;
    switch (n.type) {
      case "doc":
        for (const c of n.content ?? []) block(c, depth);
        break;
      case "paragraph":
      case "blockquote":
        out.push(inline(n));
        break;
      case "heading":
        out.push(inline(n).toUpperCase());
        break;
      case "bulletList":
      case "orderedList":
        (n.content ?? []).forEach((li, i) => {
          const marker = n.type === "orderedList" ? `${i + 1}.` : "•";
          out.push(`${marker} ${inline(li).trim()}`);
        });
        break;
      case "horizontalRule":
        out.push("—".repeat(24));
        break;
      case "table": {
        // One line per row, cells separated by a pipe — the plainest shape a
        // table survives in a text part. The entry is pushed whole so the rows
        // stay one block apart from the surrounding paragraphs.
        const lines = (n.content ?? [])
          .filter((r) => r.type === "tableRow")
          .map((r) =>
            (r.content ?? [])
              .filter((c) => c.type === "tableHeader" || c.type === "tableCell")
              .map((c) => (c.content ?? []).map(inline).join(" ").trim())
              .join(" | "),
          )
          .filter(Boolean);
        if (lines.length > 0) out.push(lines.join("\n"));
        break;
      }
      case "image": {
        // The picture itself can't survive into plain text, but its caption is
        // prose — often the names of who is in the photo — and is kept.
        const caption = imageCaption(n.attrs?.caption);
        if (caption) out.push(caption);
        break;
      }
      case EVENTS_BLOCK_TYPE: {
        const attrs = eventsAttrs(n);
        if (attrs.heading) out.push(attrs.heading.toUpperCase());
        const events = visibleEvents(attrs, resolveEvents(attrs));
        if (events.length === 0) {
          out.push("No upcoming events.");
          // Plain text can't hyperlink, so the destination is spelled out — the
          // same convention link marks use above.
          if (calendarUrl) out.push(`See all events: ${calendarUrl}`);
          break;
        }
        for (const e of events) {
          const when = [formatEventDay(e, locale, timeZone), formatEventTime(e, locale, timeZone)]
            .filter(Boolean)
            .join(" · ");
          const line = `• ${e.title} — ${[when, e.location].filter(Boolean).join(" — ")}`;
          // Plain text can't hyperlink, so the event page's URL is spelled out
          // under its title — the same convention link marks and "See all" use.
          // On its own line rather than in parentheses: these are long, and a
          // reader scanning dates shouldn't have to read past one to reach the
          // next event.
          const href = calendarUrl
            ? `${calendarUrl.replace(/\/+$/, "")}${eventPath(e, timeZone)}`
            : null;
          // Same flag the HTML draws, and part of the SAME entry as the event:
          // `out` is joined with blank lines and each entry is trimmed, so a
          // push of its own would float the flag off as a paragraph belonging to
          // nothing. The URL is the sheet's own, for the reason volunteerHref
          // gives.
          const sheet =
            e.volunteerSlug && calendarUrl
              ? `${calendarUrl.replace(/\/+$/, "")}/v/${encodeURIComponent(e.volunteerSlug)}`
              : null;
          const flag = e.volunteerSlug
            ? `\n  Volunteers needed${sheet ? `: ${sheet}` : ""}`
            : "";
          out.push(`${line}${href ? `\n  ${href}` : ""}${flag}`);
        }
        if (calendarUrl) out.push(`See all events: ${calendarUrl}`);
        break;
      }
      default:
        for (const c of n.content ?? []) block(c, depth);
    }
  };

  block(doc, 0);
  return out
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Drop events blocks from a copy of the document. An excerpt is meant to be the
 *  issue's own words; rendering a block here would either inline a list of events
 *  or — worse — emit its heading followed by "No upcoming events", which reads as
 *  though the issue said that. */
function withoutEventsBlocks(node: NewsletterNode): NewsletterNode {
  if (!node.content) return node;
  return {
    ...node,
    content: node.content
      .filter((c) => c.type !== EVENTS_BLOCK_TYPE)
      .map(withoutEventsBlocks),
  };
}

/** Short summary for archive cards and og:description. */
export function newsletterExcerpt(doc: NewsletterNode, max = 180): string {
  const text = renderNewsletterText(withoutEventsBlocks(doc), NO_EVENTS)
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ── Whole-document wrappers ─────────────────────────────────────────────────

export interface NewsletterWrapperInput {
  branding: NewsletterBrandingDTO;
  title: string;
  subtitle: string | null;
  doc: NewsletterNode;
  resolveEvents: EventsResolver;
  timeZone?: string;
  locale?: string;
}

export interface NewsletterEmailInput extends NewsletterWrapperInput {
  /** Per-recipient one-click unsubscribe target. */
  unsubscribeUrl: string;
  unsubscribeWording: string;
  mailingAddress: string;
  /** Public archive URL for the "view in browser" link. */
  webUrl: string;
}

/** The language bar: the issue's own languages, each in its own name.
 *
 *  Both surfaces render it from `newsletterLanguageLinks`, which is also what
 *  decides whether there is a bar at all — see newsletterTranslate.ts for why
 *  the email and the page carry two different link forms, and why neither may
 *  appear on a token-reached page.
 *
 *  Emits no English (or any other) copy: the links are the language names, which
 *  is the one label every reader of this row can read. */
function languageBarHtml(issueUrl: string, accent: string): string {
  const links = newsletterLanguageLinks(issueUrl, "param");
  if (links.length === 0) return "";
  const items = links.map((l) => languageItemHtml(l, accent)).join(" · ");
  return `<div style="text-align:center;margin-top:6px;font-size:12px;font-family:${FONT};color:${MUTED}">${items}</div>`;
}

function languageItemHtml(l: NewsletterLanguageLink, accent: string): string {
  const label = escapeHtml(l.label);
  return l.isSource
    ? `<span lang="${l.locale}" style="color:${MUTED}">${label}</span>`
    : `<a lang="${l.locale}" hreflang="${l.locale}" href="${escapeHtml(l.href)}" style="color:${accent};text-decoration:none">${label}</a>`;
}

function masthead(branding: NewsletterBrandingDTO, accent: string): string {
  if (branding.logoUrl) {
    return `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" style="display:block;max-width:220px;height:auto;margin:0 auto 6px" />`;
  }
  return `<div style="font-size:18px;font-weight:700;color:${accent};font-family:${FONT};text-align:center;letter-spacing:.02em">${escapeHtml(branding.newsletterTitle)}</div>`;
}

/** The complete HTML email. Everything is inlined and table-wrapped: email
 *  clients strip <style> blocks and Outlook lays out with Word's engine. */
export function renderNewsletterEmailHtml(input: NewsletterEmailInput): string {
  const accent = input.branding.accentColor || DEFAULT_ACCENT;
  const body = renderNewsletterBodyHtml(input.doc, input.resolveEvents, {
    mode: "email",
    accentColor: accent,
    timeZone: input.timeZone,
    locale: input.locale,
    // Carried on branding rather than as its own email input: the archive page
    // renders from the same DTO, so both surfaces link to the same place.
    calendarUrl: input.branding.calendarUrl,
  });
  const subtitle = input.subtitle
    ? `<div style="font-size:15px;color:${MUTED};font-family:${FONT};margin-top:4px">${escapeHtml(input.subtitle)}</div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${BACKDROP};-webkit-text-size-adjust:100%">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BACKDROP};padding:24px 12px">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:${PAPER};border-radius:12px;overflow:hidden">
<tr><td style="padding:22px 28px 0">
${masthead(input.branding, accent)}
<div style="text-align:center;margin-top:14px"><a href="${escapeHtml(input.webUrl)}" style="font-size:12px;color:${MUTED};font-family:${FONT}">View this in your browser</a></div>
${languageBarHtml(input.webUrl, accent)}
<div style="height:1px;background:${RULE};margin:16px 0 22px"></div>
<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${INK};font-family:${FONT}">${escapeHtml(input.title)}</h1>
${subtitle}
<div style="height:20px"></div>
</td></tr>
<tr><td style="padding:0 28px 8px">
${body}
</td></tr>
<tr><td style="padding:8px 28px 26px;border-top:1px solid ${RULE}">
<div style="margin:16px 0 8px;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${footerHtmlOf(input.branding)}</div>
<p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${escapeHtml(input.mailingAddress)}</p>
<p style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${escapeHtml(input.unsubscribeWording)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${accent}">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** The same bar for the text part: one "Name: url" line per language.
 *
 *  A sentence introducing them would have to be written in some one language,
 *  which is the thing this feature exists to stop assuming — so there isn't one.
 *  Empty string when there are no links, which `.filter()` at the call site
 *  drops along with the other absent blocks. */
function languageBarText(issueUrl: string): string {
  return newsletterLanguageLinks(issueUrl, "param")
    .filter((l) => !l.isSource)
    .map((l) => `${l.label}: ${l.href}`)
    .join("\n");
}

export function renderNewsletterEmailText(input: NewsletterEmailInput): string {
  const body = renderNewsletterText(input.doc, input.resolveEvents, {
    timeZone: input.timeZone,
    locale: input.locale,
    calendarUrl: input.branding.calendarUrl,
  });
  return [
    input.title,
    input.subtitle ?? "",
    "",
    body,
    "",
    "—".repeat(24),
    `View in your browser: ${input.webUrl}`,
    languageBarText(input.webUrl),
    footerTextOf(input.branding),
    input.mailingAddress,
    `${input.unsubscribeWording} ${input.unsubscribeUrl}`,
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}

// ── The issue page ──────────────────────────────────────────────────────────

/** Date on an issue page, e.g. "August 15, 2026".
 *
 *  Fixed to English and UTC, matching what the archive already did inline. That
 *  is a deliberate difference from `formatEventDay`/`formatEventTime`, which ARE
 *  locale- and zone-parameterized: those name an instant a reader is expected to
 *  show up at, so getting the zone wrong moves an event a day. This names when
 *  an issue was sent or last touched — page furniture on surfaces that have no
 *  locale of their own (see functions/_lib/page.ts). It lives here so the
 *  archive, the review page and the admin's print view don't keep three copies. */
export function formatIssueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface NewsletterIssuePageInput extends NewsletterWrapperInput {
  /** Already formatted by the caller — usually `formatIssueDate(sentAt)` —
   *  or "" to omit the line. Unpublished issues pass "": the page used to say
   *  "Last edited …" there, which read as bookkeeping on a page meant to show
   *  the issue as readers will get it (asked off, 2026-11-04). */
  dateLabel: string;
  /** Draws the "not published yet" banner. Drives nothing else: an unpublished
   *  issue and a published one render identically otherwise, which is the
   *  point of showing a reviewer the real thing. */
  isDraft: boolean;
  /** Href for the masthead and the "See all issues" link, or "" to omit both —
   *  an issue reached by a review token has no archive entry to return to, and
   *  linking one would invite a reviewer to go looking for a page that 404s. */
  archiveHref: string;
  /** Href of the print view, or "" to omit the link (the print view itself
   *  passes "", so the printed page never carries a link to itself). */
  printHref: string;
  /** This page's own PUBLIC, absolute url — what the machine-translation links
   *  are built from — or "" to render no language bar.
   *
   *  "" is not a formality: only a sent issue's `/n/:slug` may pass a value.
   *  A translation link hands its url to Google's servers to fetch, so a
   *  review-token url in one would post a live, revocable capability
   *  (invariant 15) to a third party that caches. Every token-reached page and
   *  every print view therefore passes "". See newsletterTranslate.ts. */
  issueUrl: string;
  /** The sent issue's permanent `/n/:slug` url, drawn as a QR code that shows
   *  only on PAPER — so it rides every print view and an ordinary Ctrl+P alike —
   *  or "" for none. Required for `issueUrl`'s reason: every caller states its
   *  answer. Unlike `issueUrl` a token-reached page MAY pass one, because what
   *  goes in is never the page's own url but the sent issue's public one;
   *  `publishedIssueQrSvg` refuses anything that isn't `/n/:slug`. An unsent
   *  issue passes "" — its `/n/` page would 404. (The admin's own print view
   *  is the exception, by choice: see IssuePrint.tsx.) */
  publishedUrl: string;
}

/** The issue page body — masthead, title, date, rendered body, footer.
 *
 *  Extracted from what was inline markup in functions/n/[slug].ts so the public
 *  archive page, the review page, both of their print views and the admin's
 *  own print view render through ONE function instead of drifting into five
 *  near-identical templates. Emits the `.nl-` classes in NEWSLETTER_WEB_CSS
 *  below; the caller supplies the document around it. */
export function renderNewsletterIssuePageHtml(input: NewsletterIssuePageInput): string {
  const { branding } = input;
  // The context is built here rather than through renderNewsletterBodyHtml so
  // the footer below renders against the SAME one: its printed link codes
  // number on from the body's, and a footer link the body already carries
  // reuses that code instead of drawing a second.
  const ctx = renderCtx(input.resolveEvents, {
    mode: "web",
    accentColor: branding.accentColor,
    timeZone: input.timeZone,
    locale: input.locale,
    calendarUrl: branding.calendarUrl,
  });
  const body = renderNode(input.doc, ctx);
  // The footer renders for the SCREEN page only — the whole .nl-foot block
  // (the admin's footer, its link codes, "See all issues", "View as PDF") is
  // hidden on paper by NEWSLETTER_PRINT_RULES. The printed copy ends with the
  // issue's content, and its .nl-qr code leads back to the live page where
  // the footer's links work.
  const footer = footerQrs(footerHtmlOf(branding), ctx);

  const mark = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${hideEmojiOnPaper(escapeHtml(branding.newsletterTitle))}</div>`;
  const masthead = input.archiveHref
    ? `<a href="${escapeHtml(input.archiveHref)}" style="text-decoration:none">${mark}</a>`
    : mark;

  // Said plainly, and above the content rather than below it: a reviewer who
  // was sent a link has no other way to tell a draft from the real thing, and
  // finding out after reading is finding out too late.
  const banner = input.isDraft
    ? `<div class="nl-draft-banner">Draft — not published yet. This is a private preview link.</div>`
    : "";

  const foot = [
    // The footer's codes go in one centered row BENEATH its text (nl-qr-foot),
    // not in the body's right-margin rail — nothing sits beside the footer for
    // a rail to protect, and a row reads as the issue's standing links.
    `${footer.inner}${footer.col}`,
    input.archiveHref
      ? `<p style="margin:8px 0 0"><a href="${escapeHtml(input.archiveHref)}">See all issues</a></p>`
      : "",
    input.printHref
      ? `<p class="nl-print-link"><a href="${escapeHtml(input.printHref)}">View as PDF</a></p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n          ");

  // On paper only (`.nl-qr` is hidden on screen), floated top-right beside the
  // title: the first thing a reader of a printed copy sees is the way back to
  // the live one, where every link on the page still works.
  const qr = publishedIssueQrSvg(input.publishedUrl);
  // Beneath it, the name of every language the live page can be read in
  // other than English, each in its own language — the page's language bar is
  // one tap from each. `translate="no"` so a printed proxy page leaves them be.
  const qrLanguages = LOCALES.filter((l) => l !== "en")
    .map((l) => `<p lang="${l}">${escapeHtml(localeNames[l].native)}</p>`)
    .join("");
  const qrBlock = qr
    ? `<div class="nl-qr notranslate" translate="no">${qr}${qrLanguages}</div>`
    : "";

  const languages = newsletterLanguageLinks(input.issueUrl, "proxy");
  const langBar =
    languages.length === 0
      ? ""
      : // Every item is an <a>, the source one with no href (so it renders as
        // text here): inside the proxy the script turns it into the way back
        // to the original. `notranslate` keeps Google from "translating" the
        // language names, each of which is already in its own language.
        `<div class="nl-lang notranslate" translate="no">${languages
          .map((l) =>
            l.isSource
              ? `<a lang="${l.locale}" hreflang="${l.locale}" data-tr="${PROXY_LANG[l.locale]}" aria-current="true">${escapeHtml(l.label)}</a>`
              : `<a lang="${l.locale}" hreflang="${l.locale}" data-tr="${PROXY_LANG[l.locale]}" rel="nofollow noopener" href="${escapeHtml(
                  l.href,
                )}">${escapeHtml(l.label)}</a>`,
          )
          .join(" · ")}</div>
      <script>(function(){${PROXY_LANGUAGE_SWITCH_JS}})()</script>`;

  return `    <div class="nl-wrap">
      ${banner}
      <div class="nl-masthead">${masthead}</div>
      ${langBar}
      <article class="nl-card">
        ${qrBlock}
        <h1 class="nl-title">${hideEmojiOnPaper(escapeHtml(input.title))}</h1>
        ${input.subtitle ? `<p class="nl-subtitle">${hideEmojiOnPaper(escapeHtml(input.subtitle))}</p>` : ""}
        ${input.dateLabel ? `<p class="nl-date">${escapeHtml(input.dateLabel)}</p>` : ""}
        <div class="nl-body${body.includes('class="nl-qr-col"') ? " nl-body-rail" : ""}">
${body}
        </div>
        <div class="nl-foot">
          ${foot}
        </div>
      </article>
    </div>`;
}

/** The paper geometry the print stylesheet pins, in inches. The `@page` rule in
 *  NEWSLETTER_PRINT_RULES is built from this object, so the composer's page
 *  estimate and the printed page cannot disagree about the denominator —
 *  before the rule existed, every browser printed with its own default margins
 *  and "how many pages is this?" had no one answer to estimate. `size:letter`
 *  rather than A4 for the same reason every clock here is 12-hour: this is an
 *  American elementary school. CSS resolves 1in to 96px regardless of the
 *  actual screen, which is what lets a browser measure in these units. */
export const NEWSLETTER_PRINT_PAGE = {
  widthIn: 8.5,
  heightIn: 11,
  marginIn: 0.5,
  /** widthIn − 2·marginIn — the measure prose is laid out against. */
  contentWidthIn: 7.5,
  /** heightIn − 2·marginIn — what one page holds. */
  contentHeightIn: 10,
} as const;

/** The print rules, UNWRAPPED. NEWSLETTER_WEB_CSS interpolates them inside
 *  `@media print{…}`; the composer's page estimator appends them to the same
 *  stylesheet unwrapped — after it, so they win by order, exactly as printing
 *  makes them win — inside a hidden iframe sized to the page's content width.
 *  Keep every rule here safe under both wrappings: these selectors are applied
 *  on screen every time the composer measures a draft. */
export const NEWSLETTER_PRINT_RULES = `
  /* Pins the paper and the margins (NEWSLETTER_PRINT_PAGE above). */
  @page{size:${NEWSLETTER_PRINT_PAGE.widthIn}in ${NEWSLETTER_PRINT_PAGE.heightIn}in;margin:${NEWSLETTER_PRINT_PAGE.marginIn}in}
  /* Restates the light values rather than assuming them. This block used to
     inherit a light body for free; with a dark mode above it, printing from a
     dark-themed browser would otherwise put near-white text on white paper —
     and printing IS the PDF export (invariant 16), so it cannot be left to
     whichever theme the reader happens to be in. */
  body{background:#fff;color:${INK}}
  .nl-subscribe-cta span,.nl-site-foot,.nl-site-foot a,.nl-lang,.nl-lang a:not([href]){color:${MUTED}}
  .nl-site-foot,.nl-subscribe-cta,.nl-print-link,.nl-events-more,.nl-lang,.nl-archive-feed{display:none}
  .nl-wrap{max-width:none;padding:0}
  .nl-card{box-shadow:none;border-radius:0;padding:0}
  /* The masthead's newsletter NAME (the Settings title) stays off paper: the
     issue's own title already leads the printed page, and the name above it
     is site chrome, not content. A configured LOGO still prints — it is the
     organization's mark, not a second line of text. Hidden title, not hidden
     masthead, so the logo keeps its block; the padding goes with the text so
     a logo-less masthead leaves no blank band. */
  .nl-masthead-title{display:none}
  .nl-masthead{padding:0}
  .nl-masthead img{margin:0 auto 14px}
  /* Links keep their href meaning on screen but read as noise in ink. */
  a{color:inherit;text-decoration:none}
  /* Except an author's own link in the body: underlined on paper, so the
     reader can see WHICH words the numbered code in the rail resolves.
     Classless is the selector because it is the same line linkQr draws:
     author links render bare (renderText), while every generated link in the
     body carries a class (.nl-event-title-link, .nl-event-volunteer-link,
     .nl-events-more-link) and stays plain ink. */
  .nl-body a:not([class]){text-decoration:underline}
  /* Emojis don't survive black-and-white printing — they come out as grey
     smudges or empty boxes — so paper goes without them. The renderer wraps
     each one (hideEmojiOnPaper); on screen the span is inert. */
  .nl-emoji{display:none}
  /* Author-chosen per-block visibility (renderNode). display:contents, not
     block: the wrapper contributes no box, so the fragmentation rules above
     (break-after on headings, break-inside on rows and images) keep binding
     between the real elements — a block wrapper would orphan a print-only
     heading at a page's foot. Because these rules are part of
     NEWSLETTER_PRINT_RULES, the composer's page estimate excludes screen-only
     blocks and counts print-only ones without knowing the feature exists. */
  .nl-screen-only{display:none}
  .nl-print-only{display:contents}
  .nl-title{font-size:26px}
  .nl-p,.nl-ul,.nl-ol{font-size:10.5pt;line-height:1.55}
  /* Don't strand a heading or an event row at the foot of a page. */
  .nl-h1,.nl-h2,.nl-h3,.nl-events-heading{break-after:avoid;page-break-after:avoid}
  .nl-event,.nl-li,.nl-img,.nl-quote,.nl-fig,.nl-table tr{break-inside:avoid;page-break-inside:avoid}
  /* A caption must not strand on the next page without its picture. */
  .nl-img-captioned{break-after:avoid;page-break-after:avoid}
  /* Nothing on paper is clickable, so an accent-coloured title is just noise. */
  .nl-event-title-link{color:${INK}}
  /* The whole footer stays off paper — the admin's footer HTML, its link
     codes and the page's navigation alike. The printed copy ends with the
     issue's content; the .nl-qr code beside the title already leads back to
     the live page, where the footer's links work. The .nl-qr-foot rules
     below are kept against the day the footer returns to print. */
  .nl-foot{display:none}
  /* Floated so the title, subtitle and date wrap beside it rather than
     starting below a square of white space. */
  .nl-qr{display:block;float:right;width:.75in;margin:0 0 10px 18px;text-align:center}
  .nl-qr svg{display:block;width:.75in;height:.75in;margin:0 auto}
  .nl-qr p{margin:2px 0 0;font-size:8.5pt;line-height:1.35;color:${INK}}
  /* One small code per link in the body, in a rail down the right margin (see
     qrBlock). The body reserves the rail once, so every block has the same
     measure; each block's codes float into it with a negative margin as wide
     as the rail, which keeps them out of the text entirely, and clear the
     previous block's codes rather than overlap them. The FOOTER's codes
     (footerQrs) do not use the rail: they sit in one centered row beneath the
     footer's text (.nl-qr-foot) — the footer ends the page, so there is no
     prose beside it for a rail to keep clear of. */
  .nl-body-rail{padding-right:1.2in}
  .nl-body-rail::after{content:"";display:block;clear:both}
  .nl-qr-col{display:flex;flex-direction:column;gap:.1in;float:right;clear:right;width:.95in;margin:2px -1.2in .1in 0;break-inside:avoid;page-break-inside:avoid}
  .nl-qr-item{display:flex;align-items:flex-start;justify-content:flex-end;gap:.05in}
  .nl-qr-num{font-size:9pt;font-weight:700;line-height:1;margin-top:calc(.75in * var(--qz, 0) - .125em);color:${INK}}
  .nl-qr-col svg{display:block;width:.75in;height:.75in;flex:none}
  .nl-qr-foot{display:flex;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:.2in;margin-top:.15in;break-inside:avoid;page-break-inside:avoid}
  .nl-qr-foot svg{display:block;width:.75in;height:.75in;flex:none}
  /* The number after a link that matches the one beside its code. */
  .nl-qr-ref{display:inline;font-size:.7em;font-weight:700;line-height:0;margin-left:1px;vertical-align:super;color:${INK}}
`.trimEnd();

/** Stylesheet for the public archive pages. Lives here so the web target's look
 *  is defined next to the email's inline styles and the two stay in step. */
export const NEWSLETTER_WEB_CSS = `
*{box-sizing:border-box}
body{margin:0;background:${BACKDROP};color:${INK};font-family:${FONT};-webkit-font-smoothing:antialiased}
a{color:var(--nl-accent,${DEFAULT_ACCENT})}
.nl-wrap{max-width:680px;margin:0 auto;padding:24px 16px 56px}
.nl-card{background:${PAPER};color:${INK};border-radius:14px;padding:28px 28px 32px;box-shadow:0 1px 3px rgba(16,24,40,.06)}
.nl-masthead{text-align:center;padding:8px 0 20px}
.nl-masthead img{max-width:220px;height:auto;display:inline-block}
.nl-masthead-title{font-size:18px;font-weight:700;color:var(--nl-accent,${DEFAULT_ACCENT});letter-spacing:.02em}
.nl-title{margin:0;font-size:30px;line-height:1.2;font-weight:700}
.nl-subtitle{margin:6px 0 0;font-size:16px;color:${MUTED}}
.nl-date{margin:10px 0 0;font-size:13px;color:${MUTED}}
.nl-body{margin-top:26px}
.nl-p{margin:0 0 16px;font-size:15px;line-height:1.7}
.nl-h1{margin:0 0 12px;font-size:26px;line-height:1.3;font-weight:700}
.nl-h2{margin:28px 0 12px;font-size:21px;line-height:1.3;font-weight:700}
.nl-h3{margin:28px 0 12px;font-size:17px;line-height:1.3;font-weight:700}
.nl-ul,.nl-ol{margin:0 0 16px;padding-left:22px;font-size:15px;line-height:1.7}
.nl-li{margin:0 0 6px}
.nl-fs-small{font-size:${NEWSLETTER_FONT_SIZES.small}em}
.nl-fs-large{font-size:${NEWSLETTER_FONT_SIZES.large}em}
.nl-quote{margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT});color:${MUTED};font-style:italic}
.nl-hr{border:0;border-top:1px solid ${RULE};margin:26px 0}
.nl-img{display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 18px}
/* Floated images: text wraps beside them, on screen and on paper alike. The
   geometry matches the email's inline form (renderNode's image case). */
.nl-img-left{float:left;max-width:48%;margin:4px 18px 10px 0}
.nl-img-right{float:right;max-width:48%;margin:4px 0 10px 18px}
/* A captioned image hands its bottom margin to the caption line, so the pair
   reads as one block (renderNode's image case). */
.nl-img-captioned{margin:0 0 6px}
/* Small and tight on purpose: a caption is a label, not a paragraph, and on
   a FLOATED figure every extra line of caption extends the float, keeping the
   body text narrowed beside it that much longer. */
.nl-img-caption{margin:0 0 18px;font-size:12px;line-height:1.4;color:${MUTED}}
/* A captioned FLOATED image rides a one-cell layout table (the email's float
   wrapper); the wrapper carries the bare floated image's geometry. */
.nl-fig{border-collapse:collapse}
.nl-fig-left{float:left;width:288px;max-width:48%;margin:4px 18px 10px 0}
.nl-fig-right{float:right;width:288px;max-width:48%;margin:4px 0 10px 18px}
.nl-fig-td{padding:0}
.nl-fig-img{display:block;width:100%;height:auto;border-radius:8px}
.nl-fig .nl-img-caption{margin:4px 0 0;font-size:12px;line-height:1.35}
/* Per-block visibility wrappers (renderNode). display:contents so the wrapper
   contributes no box on screen either — a marked image floats and a marked
   heading spaces exactly as an unmarked one. A print-only block exists for
   paper: on screen the none below wins, and NEWSLETTER_PRINT_RULES flips the
   pair for ink. */
.nl-screen-only,.nl-print-only{display:contents}
.nl-print-only{display:none}
.nl-table{width:100%;border-collapse:collapse;margin:0 0 16px}
/* Authored column widths (the cells' width="NN%" attributes) only bind under
   fixed layout; the class applies on screen and in print alike. */
.nl-table-fixed{table-layout:fixed}
.nl-th,.nl-td{padding:8px 10px;font-size:15px;line-height:1.5;text-align:left;vertical-align:top}
.nl-th{font-weight:700;background:${BACKDROP}}
/* A multi-paragraph cell keeps the cell's measure, not the body's. */
.nl-th .nl-p,.nl-td .nl-p{font-size:inherit;margin:0 0 8px}
.nl-th .nl-p:last-child,.nl-td .nl-p:last-child{margin-bottom:0}
.nl-events{width:100%;border-collapse:collapse;margin:0 0 20px}
.nl-events-heading{margin:28px 0 10px;font-size:19px;line-height:1.3;font-weight:700}
.nl-events-empty{margin:0 0 18px;font-size:15px;color:${MUTED}}
.nl-events-more{margin:-12px 0 20px;font-size:13.5px}
.nl-events-more-link{color:var(--nl-accent,${DEFAULT_ACCENT});text-decoration:none;font-weight:600}
.nl-events-more-link:hover{text-decoration:underline}
.nl-event{padding:10px 0 10px 12px;border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT});border-bottom:1px solid ${RULE}}
.nl-event-title{font-size:15px;font-weight:600;line-height:1.4}
.nl-event-title-link{color:var(--nl-accent,${DEFAULT_ACCENT});text-decoration:none}
.nl-event-title-link:hover{text-decoration:underline}
.nl-event-meta{font-size:13px;color:${MUTED};margin-top:2px}
.nl-event-volunteer{font-size:13px;font-weight:700;color:${VOLUNTEER};margin-top:3px}
.nl-event-volunteer-link{color:${VOLUNTEER};text-decoration:none}
.nl-event-volunteer-link:hover{text-decoration:underline}
.nl-qr{display:none}
.nl-qr-col{display:none}
.nl-qr-foot{display:none}
.nl-qr-ref{display:none}
/* clear: a floated image as the issue's last block must not spill under the
   footer rule. The email needs no twin — its body sits in its own table cell,
   which contains floats on its own. */
.nl-foot{clear:both;margin-top:22px;padding-top:18px;border-top:1px solid ${RULE};font-size:13px;line-height:1.6;color:${MUTED}}
.nl-archive-item{display:block;background:${PAPER};border-radius:12px;padding:18px 20px;margin-bottom:12px;text-decoration:none;color:${INK};box-shadow:0 1px 3px rgba(16,24,40,.06)}
.nl-archive-item h2{margin:0;font-size:19px;line-height:1.3}
.nl-archive-item p{margin:6px 0 0;font-size:14.5px;line-height:1.55;color:${MUTED}}
.nl-archive-date{display:block;font-size:12.5px;color:${MUTED};margin-bottom:4px}
.nl-empty{background:${PAPER};border-radius:12px;padding:40px 20px;text-align:center;color:${MUTED}}
.nl-site-foot{max-width:680px;margin:0 auto;padding:0 16px 40px;text-align:center;font-size:13px;color:${MUTED}}
.nl-subscribe-cta{display:block;background:${PAPER};border-radius:12px;padding:16px 20px;margin-bottom:18px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(16,24,40,.06);border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT})}
.nl-subscribe-cta strong{color:var(--nl-accent,${DEFAULT_ACCENT})}
.nl-subscribe-cta span{display:block;margin-top:3px;font-size:14px;color:${MUTED}}
.nl-archive-feed{margin:-8px 0 18px 2px;font-size:13px;color:${MUTED}}
.nl-form{margin:22px 0 0}
.nl-label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
.nl-input{width:100%;font:inherit;font-size:16px;padding:11px 13px;border:1px solid ${RULE};border-radius:9px;background:${PAPER};color:${INK}}
.nl-input:focus{outline:2px solid var(--nl-accent,${DEFAULT_ACCENT});outline-offset:1px;border-color:transparent}
.nl-btn{display:inline-block;margin-top:14px;font:inherit;font-size:16px;font-weight:600;padding:11px 20px;border:0;border-radius:9px;background:var(--nl-accent,${DEFAULT_ACCENT});color:#fff;cursor:pointer;text-decoration:none}
.nl-btn:hover{filter:brightness(.93)}
.nl-hint{margin:12px 0 0;font-size:13.5px;line-height:1.6;color:${MUTED}}
.nl-error{margin:0 0 14px;padding:11px 14px;border-radius:9px;background:#fdecec;color:#8a1c1c;font-size:14.5px}
/* Off-screen rather than display:none — a bot reading the DOM sees a normal
   field, while a screen reader is told to skip it. */
.nl-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
@media (max-width:520px){.nl-card{padding:22px 18px 26px}.nl-title{font-size:25px}}
.nl-print-link{margin:8px 0 0}
.nl-lang{text-align:center;margin:-10px 0 16px;font-size:13px;color:${MUTED}}
.nl-lang a{text-decoration:none}
.nl-lang a[href]:hover{text-decoration:underline}
.nl-lang a:not([href]){color:${MUTED}}
.nl-draft-banner{
  margin:0 0 16px;padding:10px 14px;border-radius:9px;
  background:#fff4d6;border-left:3px solid ${DEFAULT_ORANGE};
  font-size:13.5px;line-height:1.5;color:#6b4d05;
}

/* Dark mode, and how far it deliberately goes: the BACKDROP and this page's
   own chrome follow the system theme, while the issue CARD stays a light
   document in both. An issue is one artifact rendered by one renderer
   (invariant 9) into an email and into this page, the email is white wherever
   it is read, and this page is the archived copy OF that email — inverting the
   card would stop the archive matching what was mailed (invariant 10). There
   is also one colour here we cannot re-map safely: the accent is set by an
   admin per instance, so it is handed to us rather than chosen, and it could
   be a deep navy that vanishes on a dark card. Keeping the card light keeps
   that accent on the surface it was picked against. Most mail readers draw the
   same line for the same reason.
   The corollary: every surface that stays paper-white must pin its OWN ink rather
   than inherit it, because the body's colour below turns near-white and an
   inherited one lands light-on-light — which is how the whole issue body once
   read in dark mode. */
@media (prefers-color-scheme:dark){
  body{background:#0f151b;color:#e8eef4}
  /* Only background and text: the CTA's left border is the instance's accent,
     which is the one colour on this page we were handed rather than chose. */
  .nl-subscribe-cta{background:#19222c;color:#e8eef4}
  .nl-subscribe-cta span,.nl-site-foot,.nl-site-foot a,.nl-lang,.nl-lang a:not([href]),.nl-archive-feed{color:#8494a1}
  .nl-card{box-shadow:0 1px 3px rgba(0,0,0,.5)}
}

/* Printing IS the PDF export — there is no PDF renderer in this project, and a
   second one would be a second place for a newsletter's look to drift from the
   email (invariant 9). So the print stylesheet is part of the one stylesheet,
   which also means an ordinary Ctrl+P on any issue page comes out clean; the
   dedicated /print routes add only the auto-firing dialog.

   Everything hidden here is navigation or an affordance that means nothing on
   paper. The draft banner deliberately SURVIVES: a printed draft handed round a
   meeting table is exactly where "this went out already" is easiest to assume
   and most expensive to get wrong.

   The rules themselves live in NEWSLETTER_PRINT_RULES below this constant and
   are interpolated here, because the composer applies the SAME rules on screen
   in a hidden iframe to estimate how many pages an issue would print as — a
   Worker has no layout engine, so the browser that is already rendering the
   draft is the only honest place to ask. One block, two wrappings, and the
   measured layout cannot drift from the printed one. */
@media print{
${NEWSLETTER_PRINT_RULES}
}
`.trim();

// Newsletter domain logic. The route layer stays thin and delegates here, the
// same split managedCalendar.ts uses — and for the same reason: the interesting
// parts (audience arithmetic, slug derivation, settings coercion) are pure and
// worth unit-testing, which a Hono handler is not.
//
// Rendering is NOT here. It lives in @sd/shared's newsletterRender.ts so the
// composer's preview and the public archive page run exactly the same code the
// email did.

import type {
  CalendarEventDTO,
  NewsletterAccessDTO,
  NewsletterBrandingDTO,
  NewsletterIssuePageDTO,
  NewsletterIssueStatus,
  NewsletterNode,
  NewsletterSettingsDTO,
  NotifyMode,
  PublicCalendarEventDTO,
} from "@sd/shared";
import {
  blockWindow,
  collectEventsBlocks,
  resolveTimeZone,
  escapeHtml,
  newsletterExcerpt,
  NOTIFY_MODES,
  renderNewsletterEmailHtml,
  renderNewsletterEmailText,
  sanitizeFooterHtml,
} from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import { publicEventOf, queryUpcomingEvents } from "./calendar.js";
import { getSetting, normalizeEmail, setSetting } from "./db.js";
import { ulid } from "./ids.js";
import { rosterAccess, rosterAdmits } from "./rosterGate.js";
import { nowIso } from "./time.js";
import { displayName, personListableSql } from "./privacy.js";
import type { SendArgs } from "./email.js";

const SETTINGS_KEY = "newsletter_settings";

// ── Who may author ──────────────────────────────────────────────────────────

/** The `setting` key naming the group whose roster may author the newsletter.
 *
 *  Its own key rather than a field on the `newsletter_settings` blob, for two
 *  reasons. The gate runs on every authoring request and should not parse a
 *  JSON blob to answer; and the blob is what `PUT /newsletter/settings` writes
 *  wholesale from a form that editors can READ, so a group id living in it
 *  would ride along on every save of the footer. `pto_board_group_id` is the
 *  precedent (invariant 28). */
export const NEWSLETTER_EDITOR_GROUP_SETTING = "newsletter_editor_group_id";

/** May this caller author the newsletter, and which group decides? The roster
 *  gate the PTO boards use, keyed on the editors setting — see lib/rosterGate.ts
 *  for the rule and the `self_asserted` clause it defends. */
export function newsletterAccess(env: Env, auth: AuthContext): Promise<NewsletterAccessDTO> {
  return rosterAccess(env, NEWSLETTER_EDITOR_GROUP_SETTING, auth);
}

/** The same gate as a boolean, with no read for a system admin. */
export function newsletterAdmits(env: Env, auth: AuthContext): Promise<boolean> {
  return rosterAdmits(env, NEWSLETTER_EDITOR_GROUP_SETTING, auth);
}

/** "Edited … by Dana R." on the issue list: each account named by the Person it
 *  controls, the oldest control first — the same answer the PTO boards give
 *  for a comment's author, since an account has no name of its own.
 *
 *  A GUARDED read of `person`: it composes `personListableSql` for the viewer,
 *  so an editor whose Person is unlisted (invariant 21) comes back unnamed
 *  rather than being named on a screen the gate would hide them from, and it
 *  spends none of test/personListable.test.ts's exemption budget. The surname
 *  follows the person's own display rule, in full for whoever controls them.
 *  An account with no Person, or one withheld, is simply absent from the map,
 *  and the caller says nothing rather than inventing a label.
 *
 *  One statement for the whole list, not one per row. */
export async function editorNames(
  env: Env,
  viewer: AuthContext,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (!ids.length) return out;

  const listable = personListableSql(viewer.userId, viewer.isSystemAdmin, "p", viewer.isApproved);
  const rows = await env.DB.prepare(
    `SELECT c.user_id, p.first_name, p.last_name, p.last_name_visibility,
            (p.id IN (SELECT person_id FROM control WHERE user_id = ?)) AS mine
       FROM control c
       JOIN person p ON p.id = c.person_id
      WHERE c.user_id IN (${ids.map(() => "?").join(",")}) AND ${listable.sql}
      ORDER BY c.since ASC`,
  )
    .bind(viewer.userId, ...ids, ...listable.binds)
    .all<{
      user_id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial";
      mine: number;
    }>();

  for (const r of rows.results) {
    if (out.has(r.user_id)) continue; // oldest control wins
    out.set(r.user_id, displayName(r.first_name, r.last_name, r.last_name_visibility, r.mine === 1));
  }
  return out;
}

/** Cap on events materialized into one block. A newsletter that lists 200
 *  events isn't a newsletter; this also bounds the frozen snapshot's size. */
const MAX_EVENTS_PER_BLOCK = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Cap on how many invalid tokens we echo back — enough for an admin to spot the
 *  typo, not so many that a garbage paste bloats the response. */
const MAX_INVALID_REPORTED = 50;

/** Parse a pasted or uploaded list of addresses into unique, normalized emails.
 *
 *  Deliberately forgiving about shape: it splits on newlines, commas, semicolons
 *  and whitespace, so a one-per-line list, a comma-separated line and a CSV all
 *  work. Only tokens containing "@" are judged — a name column ("Jane Doe,
 *  jane@x.com") contributes name tokens that are simply ignored rather than
 *  reported as errors. A token IS reported as invalid when it looks like an
 *  address (has "@") but fails validation, so a real typo surfaces.
 *
 *  Pure and unit-tested; the route layer handles the DB writes. */
export function parseSubscriberList(input: string): {
  valid: string[];
  invalid: string[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const invalidSeen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const rawToken of input.split(/[\s,;]+/)) {
    // Strip a mailto: prefix and any wrapping quotes / angle brackets, e.g.
    // `"Jane" <jane@x.com>` -> `jane@x.com`.
    const token = rawToken
      .trim()
      .replace(/^mailto:/i, "")
      .replace(/^[<"']+/, "")
      .replace(/[>"']+$/, "");
    if (!token.includes("@")) continue; // not an address candidate (e.g. a name)

    const email = normalizeEmail(token);
    if (!isEmail(email)) {
      if (!invalidSeen.has(email) && invalid.length < MAX_INVALID_REPORTED) {
        invalidSeen.add(email);
        invalid.push(token);
      }
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid, duplicates };
}

/** Upsert a batch of already-validated, normalized addresses, categorizing each
 *  against its prior state so the admin gets an honest "added / resubscribed /
 *  already subscribed" breakdown. Idempotent: re-importing the same list is a
 *  no-op that reports everyone as already active. */
export async function importSubscribers(
  env: Env,
  emails: string[],
): Promise<{ added: number; resubscribed: number; alreadyActive: number }> {
  // Categorize first: read the current state of every candidate. `true` = row
  // exists and is active, `false` = row exists but unsubscribed, absent = new.
  const state = new Map<string, boolean>();
  const QUERY_CHUNK = 100; // stay well under SQLite's bound-parameter ceiling
  for (let i = 0; i < emails.length; i += QUERY_CHUNK) {
    const chunk = emails.slice(i, i + QUERY_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT email, unsubscribed_at FROM newsletter_subscriber WHERE email IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ email: string; unsubscribed_at: string | null }>();
    for (const r of rows.results) state.set(r.email, r.unsubscribed_at === null);
  }

  let added = 0;
  let resubscribed = 0;
  let alreadyActive = 0;
  for (const email of emails) {
    if (!state.has(email)) added++;
    else if (state.get(email) === false) resubscribed++;
    else alreadyActive++;
  }

  // Upsert everyone with the same statement the single-add route uses. Already
  // active rows just re-set unsubscribed_at to NULL (a no-op), which keeps this
  // one code path rather than branching writes on the categorization above.
  const now = nowIso();
  const stmts = emails.map((email) =>
    env.DB.prepare(
      `INSERT INTO newsletter_subscriber (id, email, created_at, unsubscribed_at)
       VALUES (?,?,?,NULL)
       ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
    ).bind(ulid(), email, now),
  );
  const INSERT_CHUNK = 50;
  for (let i = 0; i < stmts.length; i += INSERT_CHUNK) {
    await env.DB.batch(stmts.slice(i, i + INSERT_CHUNK));
  }

  return { added, resubscribed, alreadyActive };
}

/** Append -2, -3, … until the slug is free. Two issues drafted the same day
 *  with the same title is ordinary, not an error worth rejecting. */
export async function uniqueSlug(env: Env, base: string, excludeId?: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const row = await env.DB.prepare("SELECT id FROM newsletter_issue WHERE slug = ?")
      .bind(candidate)
      .first<{ id: string }>();
    if (!row || row.id === excludeId) return candidate;
  }
  // 99 collisions on one base means something pathological; fall back to a
  // value that cannot collide rather than looping forever.
  return `${base}-${Date.now()}`;
}

// ── Settings ────────────────────────────────────────────────────────────────

// SCHOOL_NAME already carries the org's full name ("Eisenhower PTO"), so these
// templates append only the service word — never " School", which would read as
// "Eisenhower PTO School Newsletter".
export function defaultNewsletterSettings(env: Env): NewsletterSettingsDTO {
  const school = env.SCHOOL_NAME;
  return {
    senderName: school,
    // Empty means "use the instance-wide EMAIL_FROM". An admin can override
    // it; an address off the onboarded sending domain keeps its display name
    // and survives as Reply-To (lib/email.ts).
    senderEmail: "",
    replyTo: null,
    // The footer is authored as HTML, so even the stock wording is markup. The
    // school name is escaped because it comes from config, not from the
    // sanitizer — everything stored later goes through sanitizeFooterHtml.
    footerHtml: `<p>You're receiving this because you're part of the ${escapeHtml(school)} community.</p>`,
    mailingAddress: "",
    unsubscribeWording: "Don't want these emails?",
    logoUrl: null,
    accentColor: "#0068A8",
    newsletterTitle: `${school} Newsletter`,
    defaultCalendarIds: [],
    defaultLookaheadDays: 14,
    timeZone: resolveTimeZone(env.SCHOOL_TIMEZONE),
    calendarUrl: env.CALENDAR_URL ?? "",
    // Off until an admin asks for it, like every other notification (NFR-1).
    newSubscriberNotify: "off",
  };
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw.trim() : fallback;
}

/** The footer used to be a pair of fields: plain `footerText` plus an optional
 *  `footerHtml` that overrode it. It is now HTML only, so a settings blob
 *  written before that change still carries the admin's wording in a field
 *  nothing reads. Promote it — escaped, since it was authored as plain text —
 *  rather than silently blanking a live newsletter's footer. Writing settings
 *  once drops the stale key, so this is a read-side migration with no backfill. */
function footerHtmlFrom(r: Record<string, unknown>, fallback: string): string {
  if (typeof r.footerHtml === "string") {
    const html = sanitizeFooterHtml(r.footerHtml);
    if (html) return html;
  }
  const legacy = typeof r.footerText === "string" ? r.footerText.trim() : "";
  if (legacy) return `<p>${escapeHtml(legacy)}</p>`;
  return typeof r.footerHtml === "string" ? "" : fallback;
}

/** Coerce arbitrary input onto the settings shape, field by field, falling back
 *  to `base` for anything missing or the wrong type. Pure, so the coercion
 *  rules are testable without a database. */
export function coerceNewsletterSettings(
  raw: unknown,
  base: NewsletterSettingsDTO,
): NewsletterSettingsDTO {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const senderEmail = str(r.senderEmail, base.senderEmail).toLowerCase();
  const replyTo = typeof r.replyTo === "string" ? r.replyTo.trim().toLowerCase() : base.replyTo;
  const lookahead =
    typeof r.defaultLookaheadDays === "number" && Number.isFinite(r.defaultLookaheadDays)
      ? Math.min(Math.max(Math.round(r.defaultLookaheadDays), 1), 365)
      : base.defaultLookaheadDays;
  return {
    senderName: str(r.senderName, base.senderName),
    // A malformed sender address would bounce every send, so it is dropped back
    // to "use EMAIL_FROM" rather than stored and silently failing later.
    senderEmail: senderEmail === "" || isEmail(senderEmail) ? senderEmail : base.senderEmail,
    replyTo: replyTo && isEmail(replyTo) ? replyTo : null,
    // Sanitized on the way IN, not on the way out: the footer is interpolated
    // into the email and into the public archive pages by several call sites,
    // and only one of them can be the place that makes it safe. An admin who
    // pastes a <script> gets it silently dropped, which the settings screen
    // shows them by previewing what was actually stored.
    footerHtml: footerHtmlFrom(r, base.footerHtml),
    mailingAddress: str(r.mailingAddress, base.mailingAddress),
    unsubscribeWording: str(r.unsubscribeWording, base.unsubscribeWording),
    logoUrl: typeof r.logoUrl === "string" && /^https?:\/\//i.test(r.logoUrl.trim())
      ? r.logoUrl.trim()
      : r.logoUrl === null
        ? null
        : base.logoUrl,
    accentColor: typeof r.accentColor === "string" && HEX_COLOR.test(r.accentColor.trim())
      ? r.accentColor.trim()
      : base.accentColor,
    newsletterTitle: str(r.newsletterTitle, base.newsletterTitle),
    defaultCalendarIds: Array.isArray(r.defaultCalendarIds)
      ? r.defaultCalendarIds.filter((v): v is string => typeof v === "string")
      : base.defaultCalendarIds,
    defaultLookaheadDays: lookahead,
    // Always the deployment's own zone. It rides on this DTO for the composer's
    // benefit, but it is configuration, not a setting — whatever a client sends
    // is discarded.
    timeZone: base.timeZone,
    calendarUrl: base.calendarUrl,
    // An unrecognized mode falls back rather than being stored: this value
    // decides whether mail gets sent, and "whatever the client said" is not a
    // good enough reason to start emailing people.
    newSubscriberNotify: NOTIFY_MODES.includes(r.newSubscriberNotify as NotifyMode)
      ? (r.newSubscriberNotify as NotifyMode)
      : base.newSubscriberNotify,
  };
}

export async function getNewsletterSettings(env: Env): Promise<NewsletterSettingsDTO> {
  const base = defaultNewsletterSettings(env);
  const stored = await getSetting(env, SETTINGS_KEY);
  if (!stored) return base;
  try {
    return coerceNewsletterSettings(JSON.parse(stored), base);
  } catch {
    console.error("[newsletter] stored settings are not valid JSON; using defaults");
    return base;
  }
}

export async function setNewsletterSettings(
  env: Env,
  settings: NewsletterSettingsDTO,
): Promise<void> {
  await setSetting(env, SETTINGS_KEY, JSON.stringify(settings));
}

/** The subset of settings a public page may see — no sender identity. */
export function brandingOf(settings: NewsletterSettingsDTO): NewsletterBrandingDTO {
  return {
    newsletterTitle: settings.newsletterTitle,
    accentColor: settings.accentColor,
    logoUrl: settings.logoUrl,
    footerHtml: settings.footerHtml,
    calendarUrl: settings.calendarUrl,
  };
}

// ── Audience ────────────────────────────────────────────────────────────────

export interface AudienceMember {
  email: string;
  userId: string | null;
  subscriberId: string | null;
}

export interface AudienceUserRow {
  id: string;
  email: string;
  optedOut: boolean;
}

export interface AudienceSubscriberRow {
  id: string;
  email: string;
  unsubscribed: boolean;
}

/** Combine the two recipient sources into one deduped list.
 *
 *  A member's opt-out is authoritative over any standalone subscriber row for
 *  the same address: otherwise unsubscribing from the member preferences screen
 *  would silently fail to stop the mail whenever an admin had also added that
 *  address to the subscriber list, which is exactly the kind of "I unsubscribed
 *  and it kept coming" bug that gets a sender blocklisted. */
export function mergeAudience(
  users: AudienceUserRow[],
  subscribers: AudienceSubscriberRow[],
): AudienceMember[] {
  const byEmail = new Map<string, AudienceMember>();
  const blocked = new Set<string>();

  for (const u of users) {
    const email = normalizeEmail(u.email);
    if (!email) continue;
    if (u.optedOut) {
      blocked.add(email);
      byEmail.delete(email);
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, { email, userId: u.id, subscriberId: null });
  }

  for (const s of subscribers) {
    const email = normalizeEmail(s.email);
    if (!email || s.unsubscribed || blocked.has(email)) continue;
    const existing = byEmail.get(email);
    if (existing) {
      // Same person reachable two ways — one email, but remember both handles
      // so an unsubscribe can clear whichever one is doing the sending.
      existing.subscriberId = s.id;
      continue;
    }
    byEmail.set(email, { email, userId: null, subscriberId: s.id });
  }

  return [...byEmail.values()];
}

/** Everyone who should receive the next issue. */
export async function resolveAudience(env: Env): Promise<AudienceMember[]> {
  const [users, subs] = await Promise.all([
    env.DB.prepare(
      "SELECT id, email, newsletter_opt_out_at FROM user WHERE disabled_at IS NULL",
    ).all<{ id: string; email: string; newsletter_opt_out_at: string | null }>(),
    env.DB.prepare(
      "SELECT id, email, unsubscribed_at FROM newsletter_subscriber",
    ).all<{ id: string; email: string; unsubscribed_at: string | null }>(),
  ]);

  return mergeAudience(
    users.results.map((u) => ({ id: u.id, email: u.email, optedOut: u.newsletter_opt_out_at !== null })),
    subs.results.map((s) => ({ id: s.id, email: s.email, unsubscribed: s.unsubscribed_at !== null })),
  );
}

// ── Events blocks ───────────────────────────────────────────────────────────

/** Resolve every events block in a document to its event list.
 *
 *  Called twice with the same code path: by the composer's preview endpoint
 *  (live, so a draft edited over several days stays accurate) and once more at
 *  send time, when the result is frozen into the issue so the archive keeps
 *  showing what was actually mailed. */
export async function resolveEventsSnapshot(
  env: Env,
  doc: NewsletterNode,
  fromIso: string,
): Promise<Record<string, CalendarEventDTO[]>> {
  const blocks = collectEventsBlocks(doc);
  const snapshot: Record<string, CalendarEventDTO[]> = {};
  const timeZone = resolveTimeZone(env.SCHOOL_TIMEZONE);

  for (const block of blocks) {
    if (!block.blockId) continue;
    // The same window helper the composer uses, so a fixed range resolves to
    // the same instants here as it did in the preview.
    const { from, to } = blockWindow(block, fromIso, timeZone);
    snapshot[block.blockId] = await queryUpcomingEvents(env, {
      from,
      to,
      calendarIds: block.calendarIds,
      limit: MAX_EVENTS_PER_BLOCK,
    });
  }
  // Deliberately NOT filtered by `block.excluded`: the snapshot records the
  // window that was queried, and the renderer drops the author's removals. That
  // keeps the removal in the document, which is what a sent issue freezes.
  return snapshot;
}

/** Look events up out of a frozen snapshot. Blocks added after the freeze (only
 *  possible via a malformed request, since sent issues are immutable) render
 *  empty rather than throwing. */
export function snapshotResolver(snapshot: Record<string, CalendarEventDTO[]>) {
  return (attrs: { blockId: string }) => snapshot[attrs.blockId] ?? [];
}

// ── Email composition ───────────────────────────────────────────────────────

export interface IssueEmailInput {
  env: Env;
  settings: NewsletterSettingsDTO;
  issue: {
    slug: string;
    title: string;
    subtitle: string | null;
    subject: string;
    content: NewsletterNode;
  };
  snapshot: Record<string, CalendarEventDTO[]>;
  /** Per-recipient token; the test-send path passes null and links to the
   *  preferences screen instead, so a test can't unsubscribe anyone. */
  unsubscribeToken: string | null;
  /** Prefixes the subject so a test never looks like the real thing in an inbox. */
  isTest?: boolean;
}

export function issueWebUrl(env: Env, slug: string): string {
  return `${env.NEWSLETTER_URL}/n/${slug}`;
}

export function confirmSubscriptionUrl(env: Env, token: string): string {
  return `${env.NEWSLETTER_URL}/subscribe/confirm/${token}`;
}

/** Where a minted review token is read. Alongside its siblings above so every
 *  outbound link into the newsletter site is built in one place. */
export function previewUrl(env: Env, token: string): string {
  return `${env.NEWSLETTER_URL}/preview/${token}`;
}

// ── The issue page seam ─────────────────────────────────────────────────────

/** The columns an issue page needs, whichever route found the row — a sent
 *  issue by slug, or any issue by its review token. Deliberately a narrow
 *  SELECT rather than `SELECT *`: the row that reaches `issuePageOf` shouldn't
 *  be carrying `preview_token_hash` in the first place. */
export interface IssuePageRow {
  slug: string;
  title: string;
  subtitle: string | null;
  status: NewsletterIssueStatus;
  sent_at: string | null;
  published_at: string | null;
  updated_at: string;
  content_json: string;
  events_snapshot_json: string | null;
}

function parseIssueDoc(json: string): NewsletterNode {
  try {
    return JSON.parse(json) as NewsletterNode;
  } catch {
    return { type: "doc", content: [] };
  }
}

/** Narrow a snapshot for a reader.
 *
 *  Moved here from routes/newsletterPublic.ts, where it was a private helper,
 *  so `issuePageOf` is its only caller and a second route can't build an issue
 *  response by hand and forget it. The stored JSON is left exactly as written at
 *  send time — freezing is what keeps the archive matching the email (invariant
 *  10) — so narrowing happens on the way OUT, the same way the public agenda
 *  narrows. */
export function publicEventsSnapshot(
  raw: Record<string, CalendarEventDTO[]>,
): Record<string, PublicCalendarEventDTO[]> {
  const out: Record<string, PublicCalendarEventDTO[]> = {};
  for (const [blockId, events] of Object.entries(raw)) {
    if (!Array.isArray(events)) continue;
    out[blockId] = events.map(publicEventOf);
  }
  return out;
}

/** Parse a stored snapshot blob, tolerating anything that isn't one. */
function parseSnapshot(json: string | null): Record<string, CalendarEventDTO[]> {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, CalendarEventDTO[]>;
}

/** THE reader-facing projection for issue pages — the companion to
 *  `publicEventOf` and `publicSheetOf`, and built the same way.
 *
 *  Every field is written out by hand. Do not rewrite this as a spread of a
 *  wider row or DTO: a column added to `newsletter_issue` must not be able to
 *  reach a reader until somebody edits this function on purpose. That is not a
 *  hypothetical here — this very change added `preview_token_hash` to that
 *  table, and a spread would have published it.
 *
 *  Both callers are unauthenticated: `/newsletter-public/issues/:slug` (gated in
 *  SQL to sent issues) and `/newsletter-public/preview/:token` (gated by holding
 *  the token). Neither gate is this function's business — it is handed a row
 *  some gate already approved, and its only job is deciding what leaves.
 *
 *  Events resolve live when there is no freeze yet, which is the draft case and
 *  also the brief `sending` window before the snapshot lands. Either way the
 *  result goes out through `publicEventsSnapshot`. */
export async function issuePageOf(
  env: Env,
  row: IssuePageRow,
  branding: NewsletterBrandingDTO,
): Promise<NewsletterIssuePageDTO> {
  const content = parseIssueDoc(row.content_json);
  const resolved = row.events_snapshot_json
    ? parseSnapshot(row.events_snapshot_json)
    : await resolveEventsSnapshot(env, content, nowIso());

  return {
    // Null rather than the stored slug for an unpublished issue: that slug names
    // a page which does not exist and 404s, and handing it to a reviewer
    // invites them to share the wrong URL.
    slug: row.published_at !== null ? row.slug : null,
    title: row.title,
    subtitle: row.subtitle,
    status: row.status,
    sentAt: row.sent_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    excerpt: newsletterExcerpt(content),
    content,
    eventsSnapshot: publicEventsSnapshot(resolved),
    branding,
  };
}

/** The double opt-in email: the only thing standing between "a stranger typed
 *  your address into a public form" and "you are on a mailing list".
 *
 *  Sent under the newsletter's own sender identity rather than the instance
 *  EMAIL_FROM that lib/email.ts's transactional builders use. It is newsletter
 *  mail — the recipient is being asked to recognise the sender and decide, so
 *  the From line has to be the name they'll see on every issue afterwards, not
 *  "Directory".
 *
 *  Deliberately makes no claim about whether the address is already subscribed.
 *  The route answers identically in every case (no enumeration), and the copy
 *  has to hold for a first-time signup and a duplicate alike. */
export function subscribeConfirmEmailArgs(
  env: Env,
  settings: NewsletterSettingsDTO,
  link: string,
): SendArgs {
  const title = settings.newsletterTitle;
  const accent = settings.accentColor || "#0068A8";
  return {
    to: "",
    subject: `Confirm your subscription to the ${title}`,
    text: `Someone asked to subscribe this address to the ${title}.

Confirm your subscription:
${link}

If that wasn't you, ignore this email — nothing happens until the link above is used, and we won't email you again.`,
    html: `<p>Someone asked to subscribe this address to the <strong>${escapeHtml(title)}</strong>.</p>
<p><a href="${escapeHtml(link)}" style="color:${escapeHtml(accent)}">Confirm your subscription</a></p>
<p style="color:#56636f;font-size:13px">If that wasn't you, ignore this email — nothing happens until the link above is used, and we won't email you again.</p>`,
    from: settings.senderEmail ? `${settings.senderName} <${settings.senderEmail}>` : undefined,
    replyTo: settings.replyTo ?? undefined,
  };
}

export function unsubscribeUrl(env: Env, token: string | null): string {
  return token
    ? `${env.NEWSLETTER_URL}/unsubscribe/${token}`
    : `${env.NEWSLETTER_URL}/preferences`;
}

/** Build the message for one recipient. `to` is left empty for the caller to
 *  fill, matching every other builder in lib/email.ts. */
export function issueEmailArgs(input: IssueEmailInput): SendArgs {
  const { env, settings, issue, snapshot } = input;
  const wrapper = {
    branding: brandingOf(settings),
    title: issue.title,
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: snapshotResolver(snapshot),
    timeZone: resolveTimeZone(env.SCHOOL_TIMEZONE),
    unsubscribeUrl: unsubscribeUrl(env, input.unsubscribeToken),
    unsubscribeWording: settings.unsubscribeWording,
    mailingAddress: settings.mailingAddress,
    webUrl: issueWebUrl(env, issue.slug),
  };
  return {
    to: "",
    subject: input.isTest ? `[TEST] ${issue.subject}` : issue.subject,
    html: renderNewsletterEmailHtml(wrapper),
    text: renderNewsletterEmailText(wrapper),
    from: settings.senderEmail
      ? `${settings.senderName} <${settings.senderEmail}>`
      : undefined,
    replyTo: settings.replyTo ?? undefined,
  };
}

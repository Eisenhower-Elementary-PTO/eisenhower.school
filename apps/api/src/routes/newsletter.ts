// Newsletter authoring. Mounted at /newsletter.
//
// Two gates, and which one a route opens with is the whole access story here:
//
//   requireEditor — session + a seat on the editors group (`newsletterAccess`,
//                   lib/newsletter.ts; invariant 31). Everything about ISSUES:
//                   listing, drafting, previewing, review links, test sends,
//                   sending, retrying, and the image upload the editor makes.
//                   Plus a READ of the settings blob, which the composer needs
//                   to render a preview and which holds nothing an issue's
//                   own email doesn't already print.
//   isSystemAdmin — the inline two lines every other admin route uses.
//                   Writing the settings, the subscriber list (email addresses
//                   the editors have no need to see), and naming the editors
//                   group itself.
//
// Both are inline rather than middleware, matching routes/admin.ts and
// routes/managedCalendar.ts.
//
// The one rule that shapes this file: an issue is mutable only while it is a
// draft. Once a send begins, its content and its frozen events snapshot are
// what went out to real inboxes and what the permanent public archive shows, so
// writes are refused with a 409 rather than quietly rewriting history.
//
// Whether its web page is up is a SEPARATE question (`published_at`, migration
// 0031): a draft can be published and keep being edited, and any issue can be
// unpublished. Two edits follow from a page being up — its slug is locked,
// since changing it would break every link already shared, and it can't be
// deleted until it comes down.

import { Hono } from "hono";
import type {
  NewsletterAssistResultDTO,
  NewsletterIssueDTO,
  NewsletterIssueInput,
  NewsletterIssueSummaryDTO,
  NewsletterNode,
  NewsletterSubscriberDTO,
  NewsletterSubscriberImportResultDTO,
  NewsletterTestSendBody,
} from "@sd/shared";
import { issueSlug, sanitizeNewsletterDoc, slugifyTitle } from "@sd/shared";
import type { Context } from "hono";
import type { AuthContext, HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { ulid } from "../lib/ids.js";
import { MINUTES, nowIso } from "../lib/time.js";
import { normalizeEmail, setSetting } from "../lib/db.js";
import { genericGroups, groupExists } from "../lib/rosterGate.js";
import { sendEmailResult } from "../lib/email.js";
import { startSubscriberDigestWindow } from "../lib/notify.js";
import {
  NEWSLETTER_EDITOR_GROUP_SETTING,
  coerceNewsletterSettings,
  editorNames,
  getNewsletterSettings,
  importSubscribers,
  isEmail,
  issueEmailArgs,
  newsletterAccess,
  newsletterAdmits,
  parseSubscriberList,
  previewUrl,
  resolveAudience,
  resolveEventsSnapshot,
  setNewsletterSettings,
  uniqueSlug,
} from "../lib/newsletter.js";
import {
  MAX_DOC_CHARS,
  assistSuccinct,
  assistSuggestions,
  claimAssistBudget,
  clampReduce,
  collectTextSlots,
  slotsTextLength,
} from "../lib/newsletterAssist.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import {
  recipientCounts,
  retryFailed,
  runFanOut,
  ROUTE_SEND_BUDGET,
  startSend,
  type IssueRow,
} from "../lib/newsletterSend.js";

export const newsletter = new Hono<HonoEnv>();

/** Session + editor standing, or null for a 403. Null rather than a throw so
 *  each handler keeps the file's two-line inline shape and its own `c.req.param`
 *  typing; the PTO router wraps handlers instead, and pays for it with `param()`. */
async function requireEditor(c: Context<HonoEnv>): Promise<AuthContext | null> {
  const auth = requireAuth(c);
  return (await newsletterAdmits(c.env, auth)) ? auth : null;
}

/** Uploaded images have to be fetchable by an email client, so this is capped
 *  higher than a profile photo but still bounded. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Test sends are for proofreading, not for distribution. */
const MAX_TEST_RECIPIENTS = 10;

/** Upper bound on a single import. A list this large is almost certainly a
 *  mistake (or belongs in the member CSV pipeline); it also bounds the work one
 *  request does. */
const MAX_IMPORT_SUBSCRIBERS = 5000;

/** Who last edited each row, named for this viewer — see `editorNames`. */
async function editorLabels(
  env: HonoEnv["Bindings"],
  viewer: AuthContext,
  rows: IssueRow[],
): Promise<EditorLabels> {
  return { names: await editorNames(env, viewer, rows.map((r) => r.edited_by)), you: viewer.realUserId };
}

interface EditorLabels {
  names: Map<string, string>;
  you: string;
}

function summaryOf(row: IssueRow, editors: EditorLabels): NewsletterIssueSummaryDTO {
  const editorName = row.edited_by ? editors.names.get(row.edited_by) : undefined;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    status: row.status as NewsletterIssueSummaryDTO["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    publishedAt: row.published_at,
    editedAt: row.edited_at ?? row.updated_at,
    editedBy:
      row.edited_by && editorName !== undefined
        ? { displayName: editorName, isYou: row.edited_by === editors.you }
        : null,
    recipientTotal: row.recipient_total,
  };
}

function parseContent(json: string): NewsletterNode {
  try {
    return JSON.parse(json) as NewsletterNode;
  } catch {
    return { type: "doc", content: [] };
  }
}

async function detailOf(
  env: HonoEnv["Bindings"],
  viewer: AuthContext,
  row: IssueRow,
): Promise<NewsletterIssueDTO> {
  return {
    ...summaryOf(row, await editorLabels(env, viewer, [row])),
    subject: row.subject,
    content: parseContent(row.content_json),
    eventsSnapshot: row.events_snapshot_json
      ? (JSON.parse(row.events_snapshot_json) as NewsletterIssueDTO["eventsSnapshot"])
      : null,
    // Counting is only meaningful once recipients exist; skip the query for drafts.
    recipientCounts: row.status === "draft" ? null : await recipientCounts(env, row.id),
    // Only whether a link is live — the token itself was hashed on the way in
    // and is unrecoverable by design (migration 0015).
    previewLink: {
      active: row.preview_token_hash !== null,
      createdAt: row.preview_token_created_at,
    },
  };
}

/**
 * How long one uninterrupted sitting at the editor is taken to last.
 *
 * Sized from this instance's own log rather than guessed. Grouped by minute,
 * the 108 `newsletter.issue.updated` rows are seven bursts: within a burst the
 * gaps are seconds to a few minutes, and between bursts they are hours. Thirty
 * minutes sits in that gap with room on both sides, and collapses those 108
 * rows to about seven. Widen it and a genuine second visit is swallowed;
 * narrow it and a pause to re-read a paragraph mints a new row.
 */
const EDIT_SESSION_MS = 30 * MINUTES;

/**
 * Claim the audit row for this editing session, or find it already claimed.
 *
 * The problem: the editor autosaves 1.2 seconds after the author stops typing
 * (AUTOSAVE_MS in apps/newsletter's IssueEditor), and pushing an audit draft
 * per PATCH made `newsletter.issue.updated` the largest action in the log — a
 * transcript of a debounce timer, drowning the rows a reader actually came for.
 *
 * The answer is NOT to delete rows. `audit_log` is append-only and hash-chained
 * (invariant 5); lib/sweep.ts says why it may never be swept, and a gap in
 * `seq` is exactly what verifyAuditChain reports as tampering. Nothing about
 * the chain changes here. What changes is what counts as an event worth
 * recording: the SITTING, not the keystroke burst inside it. The first save of
 * a sitting writes the row; the rest are the same event continuing.
 *
 * Nothing is lost that this system doesn't already hold. The row was pushed
 * with no `detail` — 108 of them said only "an admin edited this draft", which
 * is what one still says — and where the sitting ENDED is
 * `newsletter_issue.updated_at`, which every save bumps and the DTO already
 * carries.
 *
 * The claim is a guarded UPDATE and `meta.changes` is the answer, the same
 * idiom as the volunteer overfill guard and the last-admin guard: D1 has no
 * transaction around a read-then-write, and two saves really can be in flight
 * together. Whoever moves the column owns the row; everyone else stays quiet.
 * It is batched with the content UPDATE, so a request that fires every 1.2
 * seconds pays no extra round trip.
 *
 * Deliberately keyed on the issue and not on the actor. Two admins editing one
 * draft in the same half hour are one editing session on one document, and the
 * `updated` row was never the thing that told you who — the send is.
 */
function claimEditSession(env: HonoEnv["Bindings"], id: string, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE newsletter_issue
        SET audit_session_at = ?
      WHERE id = ?
        AND (audit_session_at IS NULL OR audit_session_at < ?)`,
  ).bind(now, id, new Date(Date.now() - EDIT_SESSION_MS).toISOString());
}

// ── Access ──────────────────────────────────────────────────────────────────

/** GET /newsletter/access — may this member author the newsletter?
 *
 *  Outside `requireEditor`, and it must stay there: a member who is not an
 *  editor still needs an answer, or the app cannot pick between the issue list
 *  and their preferences screen. Needs a session; says nothing a signed-in
 *  member could not already learn (`GET /groups` serves every group's name —
 *  invariant 21 records that as an accepted cost — and the boolean is about
 *  the caller themselves). */
newsletter.get("/access", async (c) => {
  const auth = requireAuth(c);
  return c.json(await newsletterAccess(c.env, auth));
});

/** GET /newsletter/groups — generic groups, for the editors picker. System
 *  admin: it is the picker for a system-admin setting, and nothing else reads
 *  it. Same helper as `/pto/groups`. */
newsletter.get("/groups", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ groups: await genericGroups(c.env) });
});

/** PUT /newsletter/editors { groupId } — name the group whose roster may author.
 *
 *  System admins only. This is the single lever over who may write to every
 *  subscriber's inbox, so it is audited (`newsletter.editors.configured`, the
 *  shape `pto.group.configured` has). A null groupId clears it and returns the
 *  instance to the bootstrap state where only system admins author — deliberate
 *  rather than refused, since an admin who picked the wrong group needs a way
 *  back. Its own route rather than a field on the settings blob: see
 *  NEWSLETTER_EDITOR_GROUP_SETTING. */
newsletter.put("/editors", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ groupId?: string | null }>().catch(() => null);
  const groupId = body?.groupId ? String(body.groupId) : "";
  if (groupId && !(await groupExists(c.env, groupId))) {
    return c.json({ error: "invalid", message: "No such group." }, 400);
  }

  await setSetting(c.env, NEWSLETTER_EDITOR_GROUP_SETTING, groupId);
  c.var.audit.push({
    action: "newsletter.editors.configured",
    entityKind: "setting",
    entityId: NEWSLETTER_EDITOR_GROUP_SETTING,
    detail: { groupId: groupId || null },
  });
  return c.json(await newsletterAccess(c.env, auth));
});

// ── Issues ──────────────────────────────────────────────────────────────────

/** GET /newsletter/issues — every issue, newest first. */
newsletter.get("/issues", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM newsletter_issue ORDER BY created_at DESC LIMIT 200",
  ).all<IssueRow>();
  const editors = await editorLabels(c.env, auth, rows.results);
  return c.json({ issues: rows.results.map((r) => summaryOf(r, editors)) });
});

/** POST /newsletter/issues — create a draft. */
newsletter.post("/issues", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<NewsletterIssueInput>().catch(() => null);
  const title = body?.title?.trim();
  if (!body || !title) return c.json({ error: "invalid_body" }, 400);

  const content = sanitizeNewsletterDoc(body.content) ?? { type: "doc", content: [] };
  const now = nowIso();
  const requested = body.slug?.trim() ? slugifyTitle(body.slug) : issueSlug(title, now);
  const slug = await uniqueSlug(c.env, requested || issueSlug(title, now));
  const id = ulid();

  await c.env.DB.prepare(
    `INSERT INTO newsletter_issue
       (id, slug, title, subtitle, subject, content_json, status, created_by, created_at,
        updated_at, audit_session_at, edited_at, edited_by)
     VALUES (?,?,?,?,?,?, 'draft', ?,?,?,?,?,?)`,
  )
    .bind(
      id,
      slug,
      title,
      body.subtitle?.trim() || null,
      body.subject?.trim() || title,
      JSON.stringify(content),
      auth.userId,
      now,
      now,
      // Creating a draft opens its first editing session, so the autosaves that
      // follow the author straight into the editor say nothing on top of the
      // `created` row that already reported them arriving.
      now,
      now,
      // The human at the keyboard, as the audit log records it (migration 0032).
      auth.realUserId,
    )
    .run();

  c.var.audit.push({
    action: "newsletter.issue.created",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { title, slug },
  });

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  return c.json({ issue: await detailOf(c.env, auth, row!) }, 201);
});

/** GET /newsletter/issues/:id — one issue, with live delivery counts. */
newsletter.get("/issues/:id", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(c.req.param("id"))
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ issue: await detailOf(c.env, auth, row) });
});

/** PATCH /newsletter/issues/:id — edit a draft. 409 once it has been sent. */
newsletter.patch("/issues/:id", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft") {
    return c.json({ error: "not_draft", message: "A sent issue can't be edited." }, 409);
  }

  const body = await c.req.json<Partial<NewsletterIssueInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const title = body.title !== undefined ? body.title.trim() : row.title;
  if (!title) return c.json({ error: "invalid_body" }, 400);

  // Sanitize at write time with the same allowlist the renderer enforces at read
  // time, so a hand-crafted document that skipped the editor can't be stored.
  const content =
    body.content !== undefined
      ? (sanitizeNewsletterDoc(body.content) ?? { type: "doc", content: [] })
      : parseContent(row.content_json);

  let slug = row.slug;
  if (body.slug !== undefined) {
    const requested = slugifyTitle(body.slug);
    if (requested && requested !== row.slug) {
      // A published page's address is out in the world — on paper as a QR
      // code, in messages, in the archive. The editor locks the field; this is
      // the same rule for a request that didn't come through it.
      if (row.published_at !== null) {
        return c.json(
          { error: "published", message: "Unpublish this issue to change its web address." },
          409,
        );
      }
      slug = await uniqueSlug(c.env, requested, id);
    }
  }

  const now = nowIso();
  const [, claim] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE newsletter_issue
          SET title = ?, subtitle = ?, subject = ?, slug = ?, content_json = ?, updated_at = ?,
              edited_at = ?, edited_by = ?
        WHERE id = ?`,
    ).bind(
      title,
      body.subtitle !== undefined ? (body.subtitle?.trim() || null) : row.subtitle,
      body.subject !== undefined ? (body.subject.trim() || title) : row.subject,
      slug,
      JSON.stringify(content),
      now,
      now,
      auth.realUserId,
      id,
    ),
    claimEditSession(c.env, id, now),
  ]);

  // One row per SITTING, not per autosave. See claimEditSession.
  if (claim?.meta.changes) {
    c.var.audit.push({
      action: "newsletter.issue.updated",
      entityKind: "newsletter_issue",
      entityId: id,
    });
  }

  const updated = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  return c.json({ issue: await detailOf(c.env, auth, updated!) });
});

/** DELETE /newsletter/issues/:id — drafts only. A sent issue stays: its URL is
 *  public, may be linked from elsewhere, and is the record of what was mailed. */
newsletter.delete("/issues/:id", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT status, published_at FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<{ status: string; published_at: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft") {
    return c.json({ error: "not_draft", message: "A sent issue can't be deleted." }, 409);
  }
  if (row.published_at !== null) {
    return c.json(
      { error: "published", message: "Unpublish this issue before deleting it." },
      409,
    );
  }

  // Re-checked inside the DELETE: a publish landing between the read and this
  // write must not have its page vanish under it.
  const gone = await c.env.DB.prepare(
    "DELETE FROM newsletter_issue WHERE id = ? AND status = 'draft' AND published_at IS NULL",
  )
    .bind(id)
    .run();
  if (!gone.meta.changes) {
    return c.json({ error: "conflict", message: "This issue changed — reload and try again." }, 409);
  }
  c.var.audit.push({
    action: "newsletter.issue.deleted",
    entityKind: "newsletter_issue",
    entityId: id,
  });
  return c.json({ ok: true });
});

// ── Review links ────────────────────────────────────────────────────────────

/** POST /newsletter/issues/:id/preview-link — mint the review link, or replace
 *  the one that's live.
 *
 *  Returns the URL ONCE. Only the token's hash is stored (migration 0015), so
 *  this response is the sole copy that will ever exist; the issue DTO afterwards
 *  reports only that a link is active. "One live link per issue" is enforced by
 *  overwriting the same column pair rather than by refusing a second mint —
 *  re-minting is also how an admin who lost the URL gets a working one, and it
 *  invalidates the previous link in the same statement. */
newsletter.post("/issues/:id/preview-link", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const token = randomToken();
  const createdAt = nowIso();
  await c.env.DB.prepare(
    `UPDATE newsletter_issue
        SET preview_token_hash = ?, preview_token_created_at = ?
      WHERE id = ?`,
  )
    .bind(await sha256(token), createdAt, id)
    .run();

  c.var.audit.push({
    action: "newsletter.issue.preview_link_created",
    entityKind: "newsletter_issue",
    entityId: id,
  });

  return c.json({ url: previewUrl(c.env, token), createdAt });
});

/** DELETE /newsletter/issues/:id/preview-link — revoke.
 *
 *  Idempotent: revoking a link that isn't live answers ok rather than 404, so a
 *  double-click can't raise an error about something that already happened. The
 *  404 is reserved for an issue that doesn't exist. Nothing needs cache-busting
 *  — the pages that read this token are served no-store (see functions/_lib/
 *  page.ts's htmlPrivate), so the next request for a revoked URL misses. */
newsletter.delete("/issues/:id/preview-link", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  await c.env.DB.prepare(
    `UPDATE newsletter_issue
        SET preview_token_hash = NULL, preview_token_created_at = NULL
      WHERE id = ?`,
  )
    .bind(id)
    .run();

  c.var.audit.push({
    action: "newsletter.issue.preview_link_revoked",
    entityKind: "newsletter_issue",
    entityId: id,
  });

  return c.json({ ok: true });
});

/** GET /newsletter/issues/:id/preview — events resolved LIVE, for the composer.
 *  A draft edited across several days keeps showing an accurate list; the frozen
 *  copy only comes into being at send. */
newsletter.get("/issues/:id/preview", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(c.req.param("id"))
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  // A sent issue previews from its snapshot — that is what its readers see.
  const snapshot = row.events_snapshot_json
    ? JSON.parse(row.events_snapshot_json)
    : await resolveEventsSnapshot(c.env, parseContent(row.content_json), nowIso());
  return c.json({ eventsSnapshot: snapshot });
});

// ── AI assist ───────────────────────────────────────────────────────────────

/** POST /newsletter/issues/:id/assist { mode } — ask Workers AI to tighten the
 *  draft ("succinct") or to make editorial notes ("suggestions").
 *
 *  Read-only on the issue: the response is a PROPOSAL, and a rewrite becomes
 *  real only when the author accepts it in the composer and the editor saves
 *  through the ordinary PATCH — the one write path, where sanitizing and the
 *  audit sitting already live. That is also why this pushes no audit draft of
 *  its own: the only thing it mutates is the `ai_budget` counter, which is a
 *  rate-limit row and not an event, exactly as `read_budget` is (invariant 32).
 *
 *  Everything here is bounded so the feature stays inside the free Workers AI
 *  allocation: see lib/newsletterAssist.ts, and migration 0036 for the daily
 *  cap. The issue is read from the database, not the request — the composer
 *  flushes its autosave first, like Send does. */
newsletter.post("/issues/:id/assist", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(c.req.param("id"))
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft") {
    return c.json({ error: "not_draft", message: "A sent issue can't be edited." }, 409);
  }

  const body = await c.req.json<{ mode?: string; reduce?: unknown }>().catch(() => null);
  const mode = body?.mode;
  if (mode !== "succinct" && mode !== "suggestions") return c.json({ error: "invalid_body" }, 400);
  // Optional shrink target, percent of the draft's prose — sent by the composer
  // when its print measurement says the issue runs long. Clamped rather than
  // trusted (lib/newsletterAssist.ts says where the bounds come from); a value
  // that isn't a number at all is a malformed request, not a preference.
  let reduce: number | undefined;
  if (body?.reduce !== undefined && body.reduce !== null) {
    if (typeof body.reduce !== "number" || !Number.isFinite(body.reduce)) {
      return c.json({ error: "invalid_body" }, 400);
    }
    reduce = clampReduce(body.reduce);
  }

  // Absent means off, the contract every optional binding here has. After the
  // issue checks, so an instance without the binding still 404s/409s honestly.
  if (!c.env.AI) {
    return c.json(
      { error: "unavailable", message: "The AI assistant isn't set up on this site." },
      503,
    );
  }

  const doc = parseContent(row.content_json);
  const slots = collectTextSlots(doc);
  const textLength = slotsTextLength(slots);
  if (textLength === 0) {
    return c.json(
      { error: "empty", message: "Write something first — there's no text to work with yet." },
      400,
    );
  }
  if (textLength > MAX_DOC_CHARS) {
    // Refused rather than truncated: a rewrite of half a document would
    // silently bless the other half unread.
    return c.json(
      { error: "too_long", message: "This issue is too long for the assistant." },
      400,
    );
  }

  // The admins' standing guidance rides the suggestions prompt (see
  // `suggestionsPrompt` in lib/newsletterAssist.ts). Read before the budget is
  // claimed, so a failed settings read spends nothing from the day.
  const guidance =
    mode === "suggestions" ? (await getNewsletterSettings(c.env)).suggestionsGuidance : undefined;

  // Claimed after validation (a malformed request must not spend the day) and
  // before the model call (a failed call stays spent — it cost neurons, and
  // the cap exists to bound exactly that).
  const now = nowIso();
  if (!(await claimAssistBudget(c.env, now.slice(0, 10)))) {
    const midnight = new Date(`${now.slice(0, 10)}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
    c.header("Retry-After", String(Math.max(1, Math.ceil((midnight - Date.now()) / 1000))));
    return c.json(
      {
        error: "budget",
        message: "The assistant has reached its daily limit. It resets at midnight UTC.",
      },
      429,
    );
  }

  try {
    const result: NewsletterAssistResultDTO =
      mode === "succinct"
        ? { mode, ...(await assistSuccinct(c.env, doc, reduce)), suggestions: [] }
        : { mode, content: null, changes: [], suggestions: await assistSuggestions(c.env, doc, guidance) };
    return c.json({ result });
  } catch (err) {
    // Never the model's output in a log line, matching lostFound's rule.
    console.error(`[newsletter] assist (${mode}) failed: ${err instanceof Error ? err.message : "error"}`);
    return c.json(
      { error: "ai_failed", message: "The assistant couldn't answer. Try again in a minute." },
      502,
    );
  }
});

// ── Sending ─────────────────────────────────────────────────────────────────

/** POST /newsletter/issues/:id/test-send — proofread copy to a few addresses.
 *  Leaves no ledger rows and carries no working unsubscribe link, so a test can
 *  never unsubscribe a real recipient. */
newsletter.post("/issues/:id/test-send", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<NewsletterTestSendBody>().catch(() => null);
  const raw = Array.isArray(body?.to) ? body.to : [];
  const to = [...new Set(raw.map((e) => normalizeEmail(String(e))).filter(isEmail))];
  if (to.length === 0) return c.json({ error: "invalid_body", message: "Add at least one valid address." }, 400);
  if (to.length > MAX_TEST_RECIPIENTS) {
    return c.json(
      { error: "too_many", message: `Test sends are limited to ${MAX_TEST_RECIPIENTS} addresses.` },
      400,
    );
  }

  const settings = await getNewsletterSettings(c.env);
  const content = parseContent(row.content_json);
  const snapshot = row.events_snapshot_json
    ? JSON.parse(row.events_snapshot_json)
    : await resolveEventsSnapshot(c.env, content, nowIso());

  const msg = issueEmailArgs({
    env: c.env,
    settings,
    issue: {
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      subject: row.subject,
      content,
    },
    snapshot,
    unsubscribeToken: null,
    isTest: true,
  });

  let sent = 0;
  for (const address of to) {
    // bulk: a test send must take the same channel the real send will, or the
    // editor proofs a different sender identity than readers get.
    const result = await sendEmailResult(c.env, { ...msg, to: address });
    if (result.ok) sent++;
  }

  c.var.audit.push({
    action: "newsletter.test_sent",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { count: to.length },
  });
  return c.json({ ok: true, sent, attempted: to.length });
});

// ── Publishing ──────────────────────────────────────────────────────────────

/** POST /newsletter/issues/:id/publish — put its `/n/:slug` page up without
 *  mailing anyone. Works on a draft (which stays editable, its page showing
 *  each save) and on a sent issue that was unpublished.
 *
 *  A compare-and-swap on `published_at IS NULL`, so publishing what is already
 *  up writes nothing and pushes no draft: an append-only log is not paddable by
 *  a double click (invariants 27, 28). */
newsletter.post("/issues/:id/publish", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const now = nowIso();
  const res = await c.env.DB.prepare(
    "UPDATE newsletter_issue SET published_at = ?, updated_at = ? WHERE id = ? AND published_at IS NULL",
  )
    .bind(now, now, id)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  if (res.meta.changes) {
    c.var.audit.push({
      action: "newsletter.issue.published",
      entityKind: "newsletter_issue",
      entityId: id,
      detail: { slug: row.slug },
    });
  }
  return c.json({ issue: await detailOf(c.env, auth, row) });
});

/** DELETE /newsletter/issues/:id/publish — take its page down. The archive
 *  drops it and `/n/:slug` 404s (after the edge cache's few minutes).
 *
 *  Allowed for a sent issue too, deliberately: a page that went out with a
 *  mistake on it has to be removable, and the editor says what it costs — the
 *  email's "view in browser" link and any printed QR code stop working.
 *  Refused only mid-send, while mail carrying that link is still going out. */
newsletter.delete("/issues/:id/publish", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    `UPDATE newsletter_issue SET published_at = NULL, updated_at = ?
      WHERE id = ? AND published_at IS NOT NULL AND status != 'sending'`,
  )
    .bind(nowIso(), id)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!res.meta.changes && row.status === "sending") {
    return c.json(
      { error: "sending", message: "Wait for the send to finish before unpublishing." },
      409,
    );
  }

  if (res.meta.changes) {
    c.var.audit.push({
      action: "newsletter.issue.unpublished",
      entityKind: "newsletter_issue",
      entityId: id,
      detail: { slug: row.slug, sent: row.status === "sent" },
    });
  }
  return c.json({ issue: await detailOf(c.env, auth, row) });
});

/** POST /newsletter/issues/:id/send — mail it, publishing its page if it isn't
 *  up already (the email's "view in browser" link is that page). The response returns
 *  as soon as the send is staged; delivery continues in waitUntil and progress
 *  is read back from GET /newsletter/issues/:id. */
newsletter.post("/issues/:id/send", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const outcome = await startSend(c.env, id);
  if (!outcome.ok) {
    if (outcome.reason === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.reason === "no_recipients") {
      return c.json(
        { error: "no_recipients", message: "Nobody is currently subscribed." },
        400,
      );
    }
    return c.json(
      { error: "not_draft", message: "This issue has already been sent." },
      409,
    );
  }

  // The small budget is deliberate: this waitUntil is killed ~30s after the
  // response, and a killed run can turn a delivered-but-unrecorded row into a
  // duplicate when the cron resumes it. The cron drains the rest at full budget.
  c.executionCtx.waitUntil(runFanOut(c.env, id, { budget: ROUTE_SEND_BUDGET }));
  c.var.audit.push({
    action: "newsletter.issue.sent",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { recipientTotal: outcome.recipientTotal },
    // The issue's title and slug are read back from the row by the notifier —
    // unlike a deleted calendar source, a sent issue still exists.
    notify: { recipientTotal: outcome.recipientTotal },
  });
  return c.json({ status: "sending", recipientTotal: outcome.recipientTotal });
});

/** POST /newsletter/issues/:id/retry — re-attempt anything that didn't land. */
newsletter.post("/issues/:id/retry", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const claimed = await retryFailed(c.env, id);
  if (!claimed) {
    // Two ways to land here: nothing is outstanding, or a send is genuinely
    // still running (retryFailed only takes over a 'sending' that has gone
    // stale). The message covers both rather than asserting the wrong one.
    return c.json(
      {
        error: "nothing_to_retry",
        message: "There's nothing to retry — everyone has it, or a send is still running.",
      },
      409,
    );
  }
  c.executionCtx.waitUntil(runFanOut(c.env, id, { budget: ROUTE_SEND_BUDGET }));
  c.var.audit.push({
    action: "newsletter.issue.retried",
    entityKind: "newsletter_issue",
    entityId: id,
  });
  return c.json({ status: "sending" });
});

// ── Settings ────────────────────────────────────────────────────────────────

newsletter.get("/settings", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);
  // `aiAssist` rides the read the composer already makes, so the assist buttons
  // can hide on an instance with no AI binding instead of 503ing when pressed.
  // A route-level fact, not a field on the settings blob: nobody edits it.
  return c.json({ settings: await getNewsletterSettings(c.env), aiAssist: Boolean(c.env.AI) });
});

newsletter.put("/settings", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const current = await getNewsletterSettings(c.env);
  const next = coerceNewsletterSettings(body, current);
  await setNewsletterSettings(c.env, next);

  // Switching INTO digest mode starts the window now, so turning it on doesn't
  // mail an admin every subscriber who joined while it was off. Only on the
  // transition — re-saving the settings screen while already on "daily" must
  // not silently drop the subscribers accumulated since the last digest.
  if (next.newSubscriberNotify === "daily" && current.newSubscriberNotify !== "daily") {
    await startSubscriberDigestWindow(c.env);
  }

  c.var.audit.push({
    action: "newsletter.settings.updated",
    entityKind: "setting",
    entityId: "newsletter_settings",
  });
  if (next.newSubscriberNotify !== current.newSubscriberNotify) {
    // Its own row: "who turned on subscriber emails, and when" is a question
    // that gets asked, and a generic settings-updated entry can't answer it.
    c.var.audit.push({
      action: "notify.toggled",
      entityKind: "setting",
      entityId: "new_subscriber_notify",
      detail: { mode: next.newSubscriberNotify },
    });
  }
  return c.json({ settings: next });
});

// ── Subscribers ─────────────────────────────────────────────────────────────

/** GET /newsletter/subscribers — the standalone list plus the current audience
 *  size, which is what an admin actually wants to know before sending. */
newsletter.get("/subscribers", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const rows = await c.env.DB.prepare(
    "SELECT id, email, created_at, unsubscribed_at FROM newsletter_subscriber ORDER BY email",
  ).all<{ id: string; email: string; created_at: string; unsubscribed_at: string | null }>();

  const subscribers: NewsletterSubscriberDTO[] = rows.results.map((r) => ({
    id: r.id,
    email: r.email,
    subscribed: r.unsubscribed_at === null,
    createdAt: r.created_at,
  }));
  const audience = await resolveAudience(c.env);
  return c.json({ subscribers, audienceTotal: audience.length });
});

newsletter.post("/subscribers", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ email: string }>().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isEmail(email)) return c.json({ error: "invalid_body", message: "Enter a valid email address." }, 400);

  const id = ulid();
  // Re-adding a previously removed address resubscribes it rather than failing.
  await c.env.DB.prepare(
    `INSERT INTO newsletter_subscriber (id, email, created_at, unsubscribed_at)
     VALUES (?,?,?,NULL)
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
  )
    .bind(id, email, nowIso())
    .run();

  c.var.audit.push({
    action: "newsletter.subscriber.added",
    entityKind: "newsletter_subscriber",
    entityId: id,
    detail: { email },
  });

  const row = await c.env.DB.prepare(
    "SELECT id, email, created_at, unsubscribed_at FROM newsletter_subscriber WHERE email = ?",
  )
    .bind(email)
    .first<{ id: string; email: string; created_at: string; unsubscribed_at: string | null }>();
  return c.json(
    {
      subscriber: {
        id: row!.id,
        email: row!.email,
        subscribed: row!.unsubscribed_at === null,
        createdAt: row!.created_at,
      },
    },
    201,
  );
});

/** POST /newsletter/subscribers/import — bulk-add a pasted or uploaded list.
 *
 *  Accepts either raw `text` (a pasted list or the contents of a .csv/.txt file)
 *  or an `emails` array; both are parsed with the same forgiving splitter. New
 *  addresses are added and previously-removed ones resubscribed, exactly like
 *  the single-add route — importing is just that operation done in bulk. */
newsletter.post("/subscribers/import", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ text?: string; emails?: string[] }>().catch(() => null);
  const text =
    typeof body?.text === "string"
      ? body.text
      : Array.isArray(body?.emails)
        ? body.emails.join("\n")
        : "";
  if (!text.trim()) {
    return c.json({ error: "invalid_body", message: "Paste or upload a list of addresses." }, 400);
  }

  const parsed = parseSubscriberList(text);
  if (parsed.valid.length === 0) {
    return c.json(
      {
        error: "no_valid_emails",
        message: "No valid email addresses were found in that list.",
        invalid: parsed.invalid,
      },
      400,
    );
  }
  if (parsed.valid.length > MAX_IMPORT_SUBSCRIBERS) {
    return c.json(
      {
        error: "too_many",
        message: `That list has more than ${MAX_IMPORT_SUBSCRIBERS} addresses. Import it in smaller batches.`,
      },
      400,
    );
  }

  const { added, resubscribed, alreadyActive } = await importSubscribers(c.env, parsed.valid);

  c.var.audit.push({
    action: "newsletter.subscriber.imported",
    entityKind: "newsletter_subscriber",
    entityId: null,
    detail: {
      added,
      resubscribed,
      alreadyActive,
      duplicates: parsed.duplicates,
      invalid: parsed.invalid.length,
      total: parsed.valid.length,
    },
  });

  const result: NewsletterSubscriberImportResultDTO = {
    added,
    resubscribed,
    alreadyActive,
    duplicates: parsed.duplicates,
    invalid: parsed.invalid,
    total: parsed.valid.length,
  };
  return c.json({ result });
});

/** DELETE /newsletter/subscribers/:id — remove a standalone address. Sent-issue
 *  ledger rows reference this row, so it is marked unsubscribed rather than
 *  deleted; the delivery history stays intact. */
newsletter.delete("/subscribers/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "UPDATE newsletter_subscriber SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL",
  )
    .bind(nowIso(), id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);

  c.var.audit.push({
    action: "newsletter.subscriber.removed",
    entityKind: "newsletter_subscriber",
    entityId: id,
  });
  return c.json({ ok: true });
});

// ── Media ───────────────────────────────────────────────────────────────────

/** POST /newsletter/media — upload an image. Body is the raw file.
 *
 *  Objects land in NEWSLETTER_MEDIA, a bucket separate from PHOTOS. Everything
 *  here is served by a public route so it can render in an inbox, and keeping
 *  private member photos in a different bucket means there is no key-prefix
 *  check standing between them and the internet. */
newsletter.post("/media", async (c) => {
  const auth = await requireEditor(c);
  if (!auth) return c.json({ error: "forbidden" }, 403);

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return c.json({ error: "unsupported_type" }, 415);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${ulid()}.${ext}`;
  await c.env.NEWSLETTER_MEDIA.put(key, body, { httpMetadata: { contentType } });

  // Absolute, unlike the relative /photos/:key URL: this one has to resolve from
  // inside an email client that has no notion of the app's origin.
  c.var.audit.push({
    action: "newsletter.media.uploaded",
    entityKind: "newsletter_media",
    entityId: key,
    detail: { contentType, bytes: body.byteLength },
  });

  const origin = new URL(c.req.url).origin;
  return c.json({ url: `${origin}/newsletter-media/${key}` }, 201);
});

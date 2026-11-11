// Lost & found, the signed-in half. Every route needs a session AND the roster
// gate (`lostFoundAccess`, the `rosterAccess` PTO and the newsletter share —
// invariant 31), with four exceptions: `/access` answers any session (a member
// who isn't staff needs an answer, not a spinner); the settings routes are
// system-admin only; and SUBMITTING a found item — `POST /items` plus the
// thumbnail PUT on an item the caller created — is open to ANY session. That
// is safe because a member-submitted item stays HELD until staff publish it,
// whatever the model reads (migration 0037). Everything a member submits lands
// in the staff review queue; nothing they do here puts a photo online.
//
// CROSS-SITE WRITES. `sd_session` is SameSite=Lax, which says nothing between
// sibling subdomains: a form on any *.eisenhower.school page would carry it.
// So every write here must arrive with a Content-Type a plain form can't send
// — `application/json`, or `image/jpeg` for photos — which makes the browser
// preflight it against ALLOWED_ORIGINS first (`requireNonFormWrite` below).
// The actions that need no input still send `{}` for exactly this reason: a
// body-less POST to /publish would otherwise be one hidden form away from
// putting a held photo of a child's name online.
//
// Photos arrive as RAW bodies, the way /newsletter/media takes them, not as
// multipart. The client sends the full photo, then a small thumbnail, and the
// thumbnail is what the model looks at.
//
// AUDIT ORDERING. Drafts are pushed the moment the write commits, before the
// reload that builds the response (invariant 22's rule).

import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthContext, HonoEnv } from "../env.js";
import { getSetting, normalizeEmail, setSetting } from "../lib/db.js";
import { isEmail } from "../lib/newsletter.js";
import { ulid } from "../lib/ids.js";
import {
  LOSTFOUND_CLAIM_NOTIFY_SETTING,
  LOSTFOUND_GROUP_SETTING,
  MAX_PHOTO_BYTES,
  MAX_THUMB_BYTES,
  STAFF_ITEM_SELECT,
  claimOf,
  cleanFields,
  cleanText,
  deleteItem,
  getStaffItem,
  isJpegBytes,
  lostFoundAccess,
  markPending,
  parseClaimNotifyEmails,
  retagStuck,
  saveFields,
  staffItemOf,
  versionedKey,
  syncVector,
  tagItem,
  type LfClaimRow,
  type LfStaffRow,
} from "../lib/lostFound.js";
import { recordReturnOwner, repeatGroups, similarTo, syncFingerprint } from "../lib/lostFoundSimilar.js";
import { genericGroups, groupExists } from "../lib/rosterGate.js";
import { bindingChannelOn, lostFoundReturnEmail, sendEmailResult } from "../lib/email.js";
import { DAYS, nowIso } from "../lib/time.js";
import { LF_CLAIM_NOTIFY_MAX, LF_DONATE_AFTER_DAYS, isLfReturnMethod, lfClaimLocale, lfContactIsEmail } from "@sd/shared";
import type { AuditAction } from "@sd/shared";

const JPEG = "image/jpeg";
/** Most items one `?ids=` read returns. A batch bigger than this simply polls
 *  in slices; D1's 100-parameter ceiling is the hard limit behind it. */
const LF_IDS_MAX = 50;
import { requireAuth } from "../middleware/session.js";

export const lostFound = new Hono<HonoEnv>();

/** Refuse any write whose body type a cross-site form could send. See the header. */
lostFound.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json" && type !== JPEG) return c.json({ error: "unsupported_type" }, 415);
  return next();
});

class LfForbidden extends Error {}

/** Session + the lost & found roster. Every route below but the header's four
 *  exceptions starts here. */
async function requireStaff(c: Context<HonoEnv>): Promise<AuthContext> {
  const auth = requireAuth(c);
  if (!(await lostFoundAccess(c.env, auth)).canUse) throw new LfForbidden();
  return auth;
}

/** Turn the gate's refusal into a 403. "No session" falls through to the
 *  app-level 401, which is answered identically everywhere in this API. */
function guarded(fn: (c: Context<HonoEnv>) => Promise<Response>) {
  return async (c: Context<HonoEnv>): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof LfForbidden) return c.json({ error: "forbidden" }, 403);
      throw err;
    }
  };
}

const param = (c: Context<HonoEnv>, name: string) => c.req.param(name) ?? "";
const originOf = (c: Context<HonoEnv>) => new URL(c.req.url).origin;

/** The current staff view of one item, or a 404. */
async function itemResponse(c: Context<HonoEnv>, id: string): Promise<Response> {
  const row = await getStaffItem(c.env, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(staffItemOf(row, originOf(c)));
}

// ── Access and settings ─────────────────────────────────────────────────────

/** GET /lostfound/access — may this member run the lost & found? Session only. */
lostFound.get(
  "/access",
  guarded(async (c) => c.json(await lostFoundAccess(c.env, requireAuth(c)))),
);

/** GET /lostfound/groups — the groups a system admin may name as staff. */
lostFound.get(
  "/groups",
  guarded(async (c) => {
    if (!requireAuth(c).isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    return c.json({ groups: await genericGroups(c.env) });
  }),
);

/** PUT /lostfound/settings { groupId } — name (or clear) the staff group. */
lostFound.put(
  "/settings",
  guarded(async (c) => {
    const auth = requireAuth(c);
    if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ groupId?: string | null }>().catch(() => null);
    const groupId = body?.groupId ? String(body.groupId) : "";
    if (groupId && !(await groupExists(c.env, groupId))) {
      return c.json({ error: "invalid", message: "No such group." }, 400);
    }
    await setSetting(c.env, LOSTFOUND_GROUP_SETTING, groupId);
    c.var.audit.push({
      action: "lostfound.staff.configured",
      entityKind: "setting",
      entityId: LOSTFOUND_GROUP_SETTING,
      detail: { groupId: groupId || null },
    });
    return c.json(await lostFoundAccess(c.env, auth));
  }),
);

/** GET /lostfound/settings — the rest of the configuration (the staff group
 *  rides /access). System admin only, like the writes it mirrors. */
lostFound.get(
  "/settings",
  guarded(async (c) => {
    if (!requireAuth(c).isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    return c.json({
      claimNotifyEmails: parseClaimNotifyEmails(await getSetting(c.env, LOSTFOUND_CLAIM_NOTIFY_SETTING)),
    });
  }),
);

/** PUT /lostfound/settings/claim-emails { emails } — who is mailed when a
 *  public claim is stored. An invalid address is a 400 naming it, never a
 *  silently dropped entry — an admin who typo'd the office's address must not
 *  believe the office is on the list. An empty list turns the mail off. */
lostFound.put(
  "/settings/claim-emails",
  guarded(async (c) => {
    if (!requireAuth(c).isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ emails?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.emails)) {
      return c.json({ error: "invalid", message: "A list of addresses is required." }, 400);
    }
    const emails: string[] = [];
    for (const raw of body.emails) {
      const email = typeof raw === "string" ? normalizeEmail(raw) : "";
      if (!email) continue; // blank lines in a textarea are not a mistake
      if (!isEmail(email)) {
        return c.json({ error: "invalid", message: `Not an email address: ${email.slice(0, 100)}` }, 400);
      }
      if (!emails.includes(email)) emails.push(email);
    }
    if (emails.length > LF_CLAIM_NOTIFY_MAX) {
      return c.json({ error: "invalid", message: `At most ${LF_CLAIM_NOTIFY_MAX} addresses.` }, 400);
    }
    await setSetting(c.env, LOSTFOUND_CLAIM_NOTIFY_SETTING, JSON.stringify(emails));
    // Count only: the current value is readable from the setting, and an
    // audit row — personal addresses included — is forever (invariant 5).
    c.var.audit.push({
      action: "lostfound.claim_notify.configured",
      entityKind: "setting",
      entityId: LOSTFOUND_CLAIM_NOTIFY_SETTING,
      detail: { count: emails.length },
    });
    return c.json({ claimNotifyEmails: emails });
  }),
);

// ── Photos ──────────────────────────────────────────────────────────────────

/** GET /lostfound/media/:key — any item's photo, held and hidden included, for
 *  staff. `private`: the response depends on who asked. The cookie rides an
 *  ordinary <img src> because every SPA is a same-site subdomain, as /photos
 *  relies on. */
lostFound.get(
  "/media/:key",
  guarded(async (c) => {
    await requireStaff(c);
    const obj = await c.env.LOSTFOUND_MEDIA.get(param(c, "key"));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    return new Response(obj.body, { headers });
  }),
);

// ── Items ───────────────────────────────────────────────────────────────────

/** GET /lostfound/items?status=found|returned  or  ?view=review|attention|hidden
 *  or  ?ids=a,b,c (up to LF_IDS_MAX, any state — the rapid-add screen's one
 *  status check for a whole batch, instead of a poll per photo).
 *  "found" is what the public sees; "review" is what's held back from it. */
lostFound.get(
  "/items",
  guarded(async (c) => {
    await requireStaff(c);
    const status = c.req.query("status");
    const view = c.req.query("view");
    let where = "i.status = 'found' AND i.hidden_at IS NULL AND i.held_at IS NULL";
    if (status === "returned") where = "i.status = 'returned'";
    else if (view === "review") where = "i.status = 'found' AND i.hidden_at IS NULL AND i.held_at IS NOT NULL";
    else if (view === "hidden") where = "i.status = 'found' AND i.hidden_at IS NOT NULL";
    const binds: string[] = [];
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, LF_IDS_MAX);
    if (ids.length) {
      where = `i.id IN (${ids.map(() => "?").join(",")})`;
      binds.push(...ids);
    } else if (view === "attention") {
      // Failed descriptions, and anything unclaimed long enough to donate —
      // in SQL, so the oldest items (the ones due) can't fall off the LIMIT.
      where = "i.status = 'found' AND (i.tag_status = 'failed' OR i.found_at < ?)";
      binds.push(new Date(Date.now() - LF_DONATE_AFTER_DAYS * DAYS).toISOString());
    }
    const { results } = await c.env.DB.prepare(`${STAFF_ITEM_SELECT} WHERE ${where} ORDER BY i.found_at DESC LIMIT 300`)
      .bind(...binds)
      .all<LfStaffRow>();
    return c.json({ items: results.map((row) => staffItemOf(row, originOf(c))) });
  }),
);

/** GET /lostfound/items/:id — one item with every claim on it. */
lostFound.get(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM lf_claim WHERE item_id = ? ORDER BY created_at DESC",
    )
      .bind(row.id)
      .all<LfClaimRow>();
    const thumbKey = row.thumb_key ?? row.photo_key;
    return c.json({
      ...staffItemOf(row, originOf(c)),
      claims: results.map((cl) => claimOf({ ...cl, item_title: row.title, thumb_key: thumbKey }, originOf(c))),
    });
  }),
);

/** GET /lostfound/items/:id/similar — earlier and current items that look like
 *  this one, and who they went home to (migration 0046). Its own route so the
 *  detail read doesn't pay for a scan. Empty until the item has been described.
 *  Staff-only like everything here: results carry a child's name and room. */
lostFound.get(
  "/items/:id/similar",
  guarded(async (c) => {
    await requireStaff(c);
    return c.json({ similar: await similarTo(c.env, param(c, "id"), originOf(c)) });
  }),
);

/** GET /lostfound/repeats — clusters of items that keep turning up. */
lostFound.get(
  "/repeats",
  guarded(async (c) => {
    await requireStaff(c);
    return c.json({ groups: await repeatGroups(c.env, originOf(c)) });
  }),
);

/** The body as JPEG bytes, or an error response. The browser re-encodes every
 *  photo through a canvas before upload, so JPEG is the only type accepted —
 *  `isJpegBytes` (shared with the email intake) checks the magic bytes, not
 *  just the header. */
async function readJpeg(c: Context<HonoEnv>, maxBytes: number): Promise<ArrayBuffer | Response> {
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (type !== JPEG) return c.json({ error: "unsupported_type" }, 415);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > maxBytes) return c.json({ error: "too_large" }, 413);
  if (!isJpegBytes(body)) return c.json({ error: "unsupported_type" }, 415);
  return body;
}

/** POST /lostfound/items?location= — raw JPEG body (the full-size photo). Open
 *  to ANY session, with NO per-member cap (one shipped and cut off a parent
 *  photographing the whole rack): the item starts HELD either way, and only
 *  staff uploads may be auto-released by the model (invariant 33). A non-staff
 *  submission is flagged `member_submitted` and stays held until staff publish
 *  — the review queue is the gate, so nothing a member sends here reaches the
 *  web, however much of it there is. */
lostFound.post(
  "/items",
  guarded(async (c) => {
    const auth = requireAuth(c);
    const isStaff = (await lostFoundAccess(c.env, auth)).canUse;
    const photo = await readJpeg(c, MAX_PHOTO_BYTES);
    if (photo instanceof Response) return photo;

    const id = ulid();
    const photoKey = `${id}.jpg`;
    await c.env.LOSTFOUND_MEDIA.put(photoKey, photo, { httpMetadata: { contentType: JPEG } });
    const now = nowIso();
    const location = cleanText(c.req.query("location"), 120);
    try {
      await c.env.DB.prepare(
        `INSERT INTO lf_item (id, photo_key, location, search_text, held_at, found_at, created_by, member_submitted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        // Held from the first moment: nobody has looked at the photo yet.
        .bind(id, photoKey, location, location.toLowerCase(), now, now, auth.userId, isStaff ? 0 : 1, now)
        .run();
    } catch (err) {
      await c.env.LOSTFOUND_MEDIA.delete(photoKey);
      throw err;
    }
    c.var.audit.push({
      action: "lostfound.item.created",
      entityKind: "lf_item",
      entityId: id,
      ...(isStaff ? {} : { detail: { memberSubmitted: true } }),
    });
    const row = await getStaffItem(c.env, id);
    return c.json(staffItemOf(row!, originOf(c)), 201);
  }),
);

/** PUT /lostfound/items/:id/thumb — raw JPEG thumbnail; starts the description
 *  the first time. Sent again after a rotation, under a fresh key. Open to the
 *  item's own creator as well as staff, but ONLY while the item is still held
 *  and awaiting description — the second half of submitting (POST above), and
 *  nothing more. The window matters: the thumbnail is the image the PUBLIC
 *  grid serves (`publicItemOf`), so once the model has written or staff have
 *  published, letting the creator swap it would put an unreviewed picture
 *  online — exactly what the hold exists to prevent (invariant 33). The
 *  roster is what's trusted with a live item's images, not this route. */
lostFound.put(
  "/items/:id/thumb",
  guarded(async (c) => {
    const auth = requireAuth(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const submitting = row.created_by === auth.userId && row.held_at !== null && row.tag_status === "pending";
    if (!submitting && !(await lostFoundAccess(c.env, auth)).canUse) throw new LfForbidden();
    const thumb = await readJpeg(c, MAX_THUMB_BYTES);
    if (thumb instanceof Response) return thumb;

    const thumbKey = versionedKey(row.id, true);
    await c.env.LOSTFOUND_MEDIA.put(thumbKey, thumb, { httpMetadata: { contentType: JPEG } });
    await c.env.DB.prepare("UPDATE lf_item SET thumb_key = ?, updated_at = ? WHERE id = ?")
      .bind(thumbKey, nowIso(), row.id)
      .run();
    if (row.thumb_key && row.thumb_key !== thumbKey) await c.env.LOSTFOUND_MEDIA.delete(row.thumb_key);
    // Described after responding, so staff can keep photographing. A Worker
    // that dies mid-call leaves the item pending; the daily sweep retries it.
    if (row.tag_status === "pending") c.executionCtx.waitUntil(tagItem(c.env, row.id, thumb));
    return c.json({ ok: true });
  }),
);

/** PUT /lostfound/items/:id/photo — raw JPEG; replaces the full-size photo.
 *  The staff app sends it only to ROTATE a photo (then the thumbnail, via the
 *  route above). It moves no state: the hold stays where it was, because a
 *  staff member who could swap the picture here could equally press Publish —
 *  the roster is what's trusted with the photo, not this route. */
lostFound.put(
  "/items/:id/photo",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const photo = await readJpeg(c, MAX_PHOTO_BYTES);
    if (photo instanceof Response) return photo;

    const photoKey = versionedKey(row.id, false);
    await c.env.LOSTFOUND_MEDIA.put(photoKey, photo, { httpMetadata: { contentType: JPEG } });
    // The suggestion is spent: whichever way staff turned it, they've looked.
    await c.env.DB.prepare("UPDATE lf_item SET photo_key = ?, suggested_rotation = 0, updated_at = ? WHERE id = ?")
      .bind(photoKey, nowIso(), row.id)
      .run();
    await c.env.LOSTFOUND_MEDIA.delete(row.photo_key);
    c.var.audit.push({
      action: "lostfound.item.updated",
      entityKind: "lf_item",
      entityId: row.id,
      detail: { photo: "replaced" },
    });
    return itemResponse(c, row.id);
  }),
);

/** PATCH /lostfound/items/:id — staff's own description, sent whole. Saving
 *  marks the item described, so a model call still in flight is discarded
 *  rather than written over these edits. */
lostFound.patch(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const fields = cleanFields(body);
    if (!fields.title) return c.json({ error: "invalid", message: "A title is required." }, 400);
    if (!(await saveFields(c.env, id, fields, { location: cleanText(body.location, 120) }))) {
      return c.json({ error: "not_found" }, 404);
    }
    // Field names only: the values may include what was written on the item.
    c.var.audit.push({ action: "lostfound.item.updated", entityKind: "lf_item", entityId: id });
    c.executionCtx.waitUntil(Promise.all([syncVector(c.env, id), syncFingerprint(c.env, id)]).then(() => undefined));
    return itemResponse(c, id);
  }),
);

/** The one-way transitions, each guarded in SQL: a repeat changes nothing and
 *  records nothing (an append-only log must not be paddable by a double tap).
 *  `sql` takes ?1 = now and ?2 = the item id. ONE table for the single-item
 *  routes and the bulk route below, so the two can't drift: whatever the bulk
 *  route does to thirty items is exactly what the single route does to one. */
const TRANSITIONS: Record<
  string,
  {
    action: AuditAction;
    sql: string;
    after?: (c: Context<HonoEnv>, id: string) => D1PreparedStatement[];
  }
> = {
  // Staff have looked at the photo and it shows no name (or they retook it).
  publish: {
    action: "lostfound.item.published",
    sql: "UPDATE lf_item SET held_at = NULL, updated_at = ?1 WHERE id = ?2 AND held_at IS NOT NULL",
  },
  hide: {
    action: "lostfound.item.hidden",
    sql: "UPDATE lf_item SET hidden_at = ?1, updated_at = ?1 WHERE id = ?2 AND hidden_at IS NULL",
  },
  unhide: {
    action: "lostfound.item.unhidden",
    sql: "UPDATE lf_item SET hidden_at = NULL, updated_at = ?1 WHERE id = ?2 AND hidden_at IS NOT NULL",
  },
  return: {
    action: "lostfound.item.returned",
    sql: "UPDATE lf_item SET status = 'returned', returned_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'found'",
    // Its open claims are settled by the return — whoever it went home with.
    after: (c, id) => [
      c.env.DB.prepare(
        "UPDATE lf_claim SET resolved_at = ?, resolution = 'returned' WHERE item_id = ? AND resolved_at IS NULL",
      ).bind(nowIso(), id),
    ],
  },
  restore: {
    action: "lostfound.item.restored",
    sql: "UPDATE lf_item SET status = 'found', returned_at = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'returned'",
  },
};

/** POST /lostfound/items/bulk { ids, action } — one transition, or delete,
 *  applied to the items staff selected on the dashboard. Registered BEFORE the
 *  per-item transition routes so "bulk" can never be read as an item id. Each
 *  id rides the SAME guarded SQL as its single-item route, in one atomic
 *  `batch()`, and only the rows that actually changed push audit drafts —
 *  a repeat still records nothing, item by item (`retag` stays single-item:
 *  re-running the model is a judgement about one photo). Delete reuses
 *  `deleteItem` — row, claims, photos, vector — per item. Up to LF_IDS_MAX ids
 *  per call (D1's bind ceiling again); more is a 400, never a silent slice,
 *  so no caller can believe it acted on items it didn't touch. */
lostFound.post(
  "/items/bulk",
  guarded(async (c) => {
    await requireStaff(c);
    const body = await c.req.json<{ ids?: unknown; action?: unknown }>().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";
    const ids = Array.isArray(body?.ids)
      ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
      : [];
    if (!ids.length) return c.json({ error: "invalid", message: "No items given." }, 400);
    if (ids.length > LF_IDS_MAX) {
      return c.json({ error: "too_many", message: `At most ${LF_IDS_MAX} items per call.` }, 400);
    }

    if (action === "delete") {
      const { results } = await c.env.DB.prepare(
        `SELECT id, photo_key, thumb_key FROM lf_item WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(...ids)
        .all<{ id: string; photo_key: string; thumb_key: string | null }>();
      for (const item of results) {
        await deleteItem(c.env, item);
        c.var.audit.push({ action: "lostfound.item.deleted", entityKind: "lf_item", entityId: item.id });
      }
      return c.json({ ok: true, changed: results.length });
    }

    // `Object.hasOwn`, not a bare index: `action` is caller input, and a
    // prototype name ("constructor") must read as unknown, not as a function.
    const t = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action]! : null;
    if (!t) return c.json({ error: "invalid", message: "Unknown action." }, 400);
    const now = nowIso();
    const results = await c.env.DB.batch(ids.map((id) => c.env.DB.prepare(t.sql).bind(now, id)));
    const changed = ids.filter((_, i) => (results[i]?.meta?.changes ?? 0) > 0);
    const after = t.after ? changed.flatMap((id) => t.after!(c, id)) : [];
    if (after.length) await c.env.DB.batch(after);
    for (const id of changed) c.var.audit.push({ action: t.action, entityKind: "lf_item", entityId: id });
    if (changed.length) {
      c.executionCtx.waitUntil(
        Promise.all(changed.flatMap((id) => [syncVector(c.env, id), syncFingerprint(c.env, id)])).then(() => undefined),
      );
    }
    return c.json({ ok: true, changed: changed.length });
  }),
);

for (const [name, t] of Object.entries(TRANSITIONS)) {
  lostFound.post(
    `/items/:id/${name}`,
    guarded(async (c) => {
      await requireStaff(c);
      const id = param(c, "id");
      const res = await c.env.DB.prepare(t.sql).bind(nowIso(), id).run();
      if ((res.meta?.changes ?? 0) > 0) {
        if (t.after) await c.env.DB.batch(t.after(c, id));
        c.var.audit.push({ action: t.action, entityKind: "lf_item", entityId: id });
        c.executionCtx.waitUntil(Promise.all([syncVector(c.env, id), syncFingerprint(c.env, id)]).then(() => undefined));
      }
      return itemResponse(c, id);
    }),
  );
}

/** POST /lostfound/items/:id/retag — ask the model again (replaces the description). */
lostFound.post(
  "/items/:id/retag",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const row = await getStaffItem(c.env, id);
    if (!row) return c.json({ error: "not_found" }, 404);
    await markPending(c.env, id);
    c.var.audit.push({ action: "lostfound.item.retagged", entityKind: "lf_item", entityId: id });
    c.executionCtx.waitUntil(tagItem(c.env, id));
    return itemResponse(c, id);
  }),
);

/** DELETE /lostfound/items/:id — gone for good: row, claims, photos, vector. */
lostFound.delete(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    await deleteItem(c.env, row);
    c.var.audit.push({ action: "lostfound.item.deleted", entityKind: "lf_item", entityId: row.id });
    return c.json({ ok: true });
  }),
);

// ── Claims ──────────────────────────────────────────────────────────────────

/** GET /lostfound/claims — open claims, oldest first (the queue). */
lostFound.get(
  "/claims",
  guarded(async (c) => {
    await requireStaff(c);
    const { results } = await c.env.DB.prepare(
      `SELECT cl.*, i.title AS item_title, COALESCE(i.thumb_key, i.photo_key) AS thumb_key
         FROM lf_claim cl JOIN lf_item i ON i.id = cl.item_id
        WHERE cl.resolved_at IS NULL
        ORDER BY cl.created_at ASC`,
    ).all<LfClaimRow & { item_title: string; thumb_key: string }>();
    return c.json({ claims: results.map((r) => claimOf(r, originOf(c))) });
  }),
);

/** POST /lostfound/claims/:id/return { method, notify? } — the item went home
 *  against THIS claim, and how. Runs the same guarded return transition the
 *  item routes use (resolving every open claim on the item, this one
 *  included), then — when asked, and the contact is email-shaped — mails the
 *  claimant that it's on its way: the words come from `lostFoundReturnMessage`
 *  in @sd/shared, in the language the claim form was filled in, naming the
 *  item and the school and never a child (a mistyped address must not deliver
 *  a child's name to a stranger).
 *
 *  The send is claimed by CAS on `notified_at` (migration 0044;
 *  `reminder_sent_at`'s pattern) so a double-tap mails nobody twice, and a
 *  failed send releases its own claim — matched by value — so staff can retry
 *  or fall back to the manual links. (A double fault — the release itself
 *  failing, or the isolate dying between CAS and send — strands the claim as
 *  notified-but-unmailed; accepted: unlike the reminder cron there is no
 *  retry owner here, and the stake is one missed courtesy email on an item
 *  the family can still see returned.) The audit draft is pushed only for a
 *  send that happened: the action records the NOTIFICATION, and a failed one
 *  leaves no durable write behind (the release undoes the CAS). `detail`
 *  carries the item id and method only — claimant fields never reach a row
 *  that lives forever (migration 0043's rule). Synchronous rather than
 *  `waitUntil`, because the dashboard needs to know whether to offer the
 *  manual fallback — which is also why a mail channel that is off answers
 *  `channel_off` instead of letting `sendEmailResult`'s log-and-report-ok
 *  contract tell a human "emailed them" about a message nobody got.
 *
 *  Refusals: an unknown method (400), a missing claim (404), and a DISMISSED
 *  claim (409) — staff judged that person not the owner, and a stale second
 *  tab must not mail them "good news". Every success carries
 *  `otherOpenClaims`: the return settles the item's other open claims with no
 *  message of their own, and the dashboard tells staff someone else is still
 *  waiting to hear. */
lostFound.post(
  "/claims/:id/return",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const body = await c.req.json<{ method?: unknown; notify?: unknown }>().catch(() => null);
    const method = body?.method;
    if (!isLfReturnMethod(method)) {
      return c.json({ error: "invalid", message: "Unknown return method." }, 400);
    }
    const wantNotify = body?.notify !== false;

    const claim = await c.env.DB.prepare(
      `SELECT cl.*, i.title AS item_title
         FROM lf_claim cl JOIN lf_item i ON i.id = cl.item_id
        WHERE cl.id = ?`,
    )
      .bind(id)
      .first<LfClaimRow & { item_title: string }>();
    if (!claim) return c.json({ error: "not_found" }, 404);
    // A dismissed claim was judged NOT the owner — returning the item against
    // it would mail "good news, it's on its way" to exactly the person staff
    // decided it doesn't belong to (a stale tab, or a double-handled queue).
    // The item itself can still be returned from its own routes.
    if (claim.resolution === "dismissed") {
      return c.json({ error: "dismissed", message: "This claim was dismissed. Return the item from its page instead." }, 409);
    }

    // The return below settles every OTHER open claim on this item as
    // 'returned' too — silently, from those families' point of view. The count
    // rides every response so the dashboard can tell staff someone else is
    // still waiting on a message (their contacts stay readable on the item
    // page). Counted BEFORE the transition, which is what resolves them.
    const others =
      (
        await c.env.DB.prepare("SELECT COUNT(*) AS n FROM lf_claim WHERE item_id = ? AND resolved_at IS NULL AND id <> ?")
          .bind(claim.item_id, id)
          .first<{ n: number }>()
      )?.n ?? 0;

    const t = TRANSITIONS.return!;
    const res = await c.env.DB.prepare(t.sql).bind(nowIso(), claim.item_id).run();
    if ((res.meta?.changes ?? 0) > 0) {
      if (t.after) await c.env.DB.batch(t.after(c, claim.item_id));
      c.var.audit.push({ action: t.action, entityKind: "lf_item", entityId: claim.item_id });
      // Order matters: the fingerprint learns the ending first, THEN who it went
      // home to (the sync's restore branch would clear an owner written earlier).
      c.executionCtx.waitUntil(
        syncVector(c.env, claim.item_id)
          .then(() => syncFingerprint(c.env, claim.item_id))
          .then(() => recordReturnOwner(c.env, claim.item_id, claim)),
      );
    }

    if (!wantNotify) return c.json({ ok: true, notified: false, otherOpenClaims: others });
    if (!lfContactIsEmail(claim.contact)) {
      return c.json({ ok: true, notified: false, reason: "not_email", otherOpenClaims: others });
    }
    // With the mail channel off or half-configured, `sendEmailResult` LOGS the
    // message and reports it accepted — the right contract for magic links,
    // the wrong one here, where a human reads "emailed them" and skips the
    // manual fallback. Answer honestly and leave `notified_at` unset so fixing
    // the channel lets this claim be notified for real.
    if (!bindingChannelOn(c.env)) {
      return c.json({ ok: true, notified: false, reason: "channel_off", otherOpenClaims: others });
    }

    const now = nowIso();
    const claimed = await c.env.DB.prepare(
      "UPDATE lf_claim SET notified_at = ? WHERE id = ? AND notified_at IS NULL",
    )
      .bind(now, id)
      .run();
    if ((claimed.meta?.changes ?? 0) === 0) {
      return c.json({ ok: true, notified: false, reason: "already_notified", otherOpenClaims: others });
    }

    const msg = lostFoundReturnEmail(lfClaimLocale(claim.lang), method, claim.item_title);
    const sent = await sendEmailResult(c.env, { ...msg, to: claim.contact.trim() });
    if (!sent.ok) {
      await c.env.DB.prepare("UPDATE lf_claim SET notified_at = NULL WHERE id = ? AND notified_at = ?")
        .bind(id, now)
        .run();
      return c.json({ ok: true, notified: false, reason: "send_failed", otherOpenClaims: others });
    }
    c.var.audit.push({
      action: "lostfound.claim.return_notified",
      entityKind: "lf_claim",
      entityId: id,
      detail: { itemId: claim.item_id, method },
    });
    return c.json({ ok: true, notified: true, otherOpenClaims: others });
  }),
);

/** POST /lostfound/claims/:id/dismiss — not theirs, or spam. */
lostFound.post(
  "/claims/:id/dismiss",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const res = await c.env.DB.prepare(
      "UPDATE lf_claim SET resolved_at = ?, resolution = 'dismissed' WHERE id = ? AND resolved_at IS NULL",
    )
      .bind(nowIso(), id)
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      c.var.audit.push({ action: "lostfound.claim.dismissed", entityKind: "lf_claim", entityId: id });
    }
    return c.json({ ok: true });
  }),
);

/** POST /lostfound/retag-failed — retry a few failed descriptions now, while
 *  staff wait. Not audited, like the model's own writes. */
lostFound.post(
  "/retag-failed",
  guarded(async (c) => {
    await requireStaff(c);
    return c.json({ retried: await retagStuck(c.env, 5) });
  }),
);

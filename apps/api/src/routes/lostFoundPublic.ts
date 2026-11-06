// Lost & found, the anonymous half: browse, search, one item, and "that's mine".
// No auth by design — like /store-public, anyone with the link may look.
//
// Everything this router returns goes through `publicItemOf`, and everything it
// lists is gated in SQL by `LISTED` (invariant 15's rule): a returned, hidden
// or held item's id reveals nothing here.
//
// The claim POST is the first anonymous write in this project that carries free
// text and contact details. It is bounded the way /newsletter-public/subscribe
// is (invariant 14): a honeypot, a per-contact and an instance-wide daily cap
// counted from the rows themselves, and the SAME answer whatever happened — a
// suppressed claim, a capped one and a stored one are indistinguishable to the
// caller, so neither the caps nor the existence of earlier claims is an oracle.

import { Hono } from "hono";
import type { LfClaimInput } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { ulid } from "../lib/ids.js";
import {
  CLAIMS_PER_CONTACT_PER_DAY,
  CLAIMS_PER_DAY_TOTAL,
  OPEN_CLAIMS_PER_ITEM,
  browse,
  cleanText,
  getItem,
  isListed,
  listedCount,
  normalizeContact,
  notifyLostFoundClaim,
  parseFilters,
  publicItemOf,
  search,
} from "../lib/lostFound.js";
import { DAYS, nowIso } from "../lib/time.js";

export const lostFoundPublic = new Hono<HonoEnv>();

/** GET /lostfound-public/items?q=&category=&color=&page= */
lostFoundPublic.get("/items", async (c) => {
  const query = c.req.query();
  const filters = parseFilters(query);
  const q = cleanText(query.q, 200);
  const page = Math.max(0, Math.min(100, Number(query.page) || 0));
  const origin = new URL(c.req.url).origin;

  // `total` is the WHOLE listing's size, deliberately ignoring the search and
  // filters — it is the "N items are waiting" line up top, steady while
  // someone narrows.
  const [{ items, hasMore }, total] = await Promise.all([
    q ? search(c.env, q, filters) : browse(c.env, filters, page),
    listedCount(c.env),
  ]);
  return c.json({ items: items.map((row) => publicItemOf(row, origin)), hasMore, total });
});

/** GET /lostfound-public/items/:id — 404 for anything not currently listed. */
lostFoundPublic.get("/items/:id", async (c) => {
  const row = await getItem(c.env, c.req.param("id"));
  if (!row || !isListed(row)) return c.json({ error: "not_found" }, 404);
  return c.json(publicItemOf(row, new URL(c.req.url).origin));
});

/** POST /lostfound-public/items/:id/claims { name, contact, message?, website? }
 *
 *  `{ ok: true }` for every outcome but one: a request missing a name or a
 *  contact gets a 400, because that is about what the caller typed and tells
 *  them nothing about anyone else. */
lostFoundPublic.post("/items/:id/claims", async (c) => {
  const body = await c.req.json<LfClaimInput>().catch(() => null);
  const name = cleanText(body?.name, 100);
  const contact = cleanText(body?.contact, 200);
  // Whose child it is and their teacher (migration 0043) — optional: the item
  // may be the claimant's own, or they may not know the room. Staff-only once
  // stored, exactly like `name` and `contact`.
  const childName = cleanText(body?.childName, 100);
  const teacher = cleanText(body?.teacher, 100);
  const message = cleanText(body?.message, 1000);
  if (!name || contact.length < 3) return c.json({ error: "invalid" }, 400);

  // A person never sees the `website` field; anything in it is a script.
  if (cleanText(body?.website, 200)) return c.json({ ok: true });

  try {
    const item = await getItem(c.env, c.req.param("id"));
    if (!item || !isListed(item)) return c.json({ ok: true });

    const since = new Date(Date.now() - DAYS).toISOString();
    const key = normalizeContact(contact);
    const counts = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM lf_claim WHERE created_at > ?) AS total,
         (SELECT COUNT(*) FROM lf_claim WHERE created_at > ? AND contact_key = ?) AS mine,
         (SELECT COUNT(*) FROM lf_claim WHERE item_id = ? AND resolved_at IS NULL) AS open`,
    )
      .bind(since, since, key, item.id)
      .first<{ total: number; mine: number; open: number }>();

    if ((counts?.total ?? 0) >= CLAIMS_PER_DAY_TOTAL) {
      console.error(`[lostfound] DAILY CLAIM CAP REACHED (${CLAIMS_PER_DAY_TOTAL}/day) — claims suppressed`);
      return c.json({ ok: true });
    }
    if ((counts?.mine ?? 0) >= CLAIMS_PER_CONTACT_PER_DAY || (counts?.open ?? 0) >= OPEN_CLAIMS_PER_ITEM) {
      console.warn("[lostfound] claim suppressed; a per-contact or per-item cap was reached");
      return c.json({ ok: true });
    }

    const id = ulid();
    // `contact` as typed — "after 3pm, 612-555-0100 ext 5" is for a person to
    // read — and the normalized key beside it for the cap above.
    await c.env.DB.prepare(
      "INSERT INTO lf_claim (id, item_id, name, contact, contact_key, child_name, teacher, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, item.id, name, contact, key, childName, teacher, message, nowIso())
      .run();

    // Anonymous: the actor column is null, as newsletter.subscribed's is. The
    // claimant's name and contact — and the child's name and teacher — stay
    // out of `detail`: audit rows are never deleted, and this claim's details
    // are (lib/lostFound.ts). Slack gets the bare fact through `notify`, with
    // no item text and no claimant.
    c.var.audit.push({
      action: "lostfound.claim.created",
      entityKind: "lf_claim",
      entityId: id,
      detail: { itemId: item.id },
      notify: {},
    });
    // Mail the configured addresses — only for a STORED claim (suppressed and
    // capped ones return above, so the caps bound the email exactly as they
    // bound the rows). The item's title, never the claimant (lib/email.ts).
    c.executionCtx.waitUntil(notifyLostFoundClaim(c.env, item.title));
  } catch (err) {
    // Same neutral answer on failure — a 500 would say something success doesn't.
    console.error(`[lostfound] claim failed: ${String(err).slice(0, 200)}`);
  }
  return c.json({ ok: true });
});

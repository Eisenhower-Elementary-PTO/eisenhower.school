// Lost & found similarity (invariant 33, migration 0046): "has something like
// this been here before, and who took it home?" and "what keeps getting lost?".
//
// ONE fingerprint per described item, outliving the item. Similarity is
// computed here, in the Worker, over those rows — no second Vectorize index
// (the public one holds listed items only and forgets returns; see the
// migration's header). Everything in this file is STAFF-ONLY: it reads
// `name_text` on purpose (a repeated name on the writing is the strongest
// "same item" signal there is) and its results carry a child's name and room.
// Nothing here may be reached from `lostFoundPublic.ts`.
//
// The score is the embedding of what the item LOOKS like (the same appearance
// text the public vector embeds, no writing) blended with exact signals the
// embedding is bad at: shared colours, the same brand, and the same name on the
// writing. The weights are a first guess, not a calibration — they are exported
// constants with a pure `similarity()` so they can be tuned against real
// returns without touching the plumbing.

import type { LfRepeatGroupDTO, LfSimilarDTO, LfSimilarReason } from "@sd/shared";
import type { Env } from "../env.js";
import { DAYS, nowIso } from "./time.js";
import { LF_EMBEDDING_MODEL, staffMediaUrl, type LfItemRow } from "./lostFound.js";

/** A fingerprint is kept this long after the item was found: a school year with
 *  room to spare, so "this keeps happening" can span a term break. */
export const LF_HISTORY_RETENTION_DAYS = 365;
/** Candidates scanned per query. Newest first; at school scale this is "all". */
export const LF_SIMILAR_SCAN = 1500;
/** Cosine is rescaled from [FLOOR, 1] to [0, 1]: bge-small scores unrelated
 *  descriptions around 0.6–0.7 (lib/lostFound.ts), so a raw cosine of 0.7 is
 *  noise and shouldn't earn half the look weight. */
export const COSINE_FLOOR = 0.65;
export const WEIGHTS = { look: 0.6, color: 0.15, brand: 0.1, writing: 0.15 } as const;
/** Below this a candidate is not shown. */
export const MIN_SIMILARITY = 0.5;
/** Cluster edges for "repeats" are stricter than the per-item suggestion: an
 *  item is worth glancing at at 0.5; calling two items "the same thing, lost
 *  again" wants more. */
export const MIN_REPEAT_SIMILARITY = 0.62;
export const MAX_SIMILAR = 8;
export const MAX_REPEAT_GROUPS = 40;

// ── The vector, as text ─────────────────────────────────────────────────────

export function encodeVector(v: number[]): string {
  const bytes = new Uint8Array(new Float32Array(v).buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeVector(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── The score ───────────────────────────────────────────────────────────────

/** What similarity compares: a fingerprint row, parsed. */
export interface Print {
  vector: Float32Array;
  category: string;
  colors: string[];
  brand: string;
  /** Lowercased words of the name read off the item. */
  writing: string[];
}

/** The words of a name worth matching: letters only, three or more, so the
 *  initial in "MILO R." never matches every other R. */
export function writingWords(nameText: string): string[] {
  return [...new Set(nameText.toLowerCase().match(/\p{L}{3,}/gu) ?? [])];
}

/** How alike two items are, 0..1, and why. Different categories are never
 *  alike (a jacket is not a bottle however the model worded it). */
export function similarity(a: Print, b: Print): { score: number; reasons: LfSimilarReason[] } {
  if (a.category !== b.category) return { score: 0, reasons: [] };
  const look = Math.max(0, Math.min(1, (cosine(a.vector, b.vector) - COSINE_FLOOR) / (1 - COSINE_FLOOR)));
  const union = new Set([...a.colors, ...b.colors]);
  const shared = a.colors.filter((c) => b.colors.includes(c));
  const color = union.size ? shared.length / union.size : 0;
  const brand = a.brand && a.brand.toLowerCase() === b.brand.toLowerCase() ? 1 : 0;
  const writing = a.writing.some((w) => b.writing.includes(w)) ? 1 : 0;
  const score = WEIGHTS.look * look + WEIGHTS.color * color + WEIGHTS.brand * brand + WEIGHTS.writing * writing;
  const reasons: LfSimilarReason[] = [];
  if (look >= 0.5) reasons.push("look");
  if (color >= 0.5) reasons.push("color");
  if (brand) reasons.push("brand");
  if (writing) reasons.push("writing");
  return { score: Math.round(score * 1000) / 1000, reasons };
}

// ── Rows ────────────────────────────────────────────────────────────────────

interface PrintRow {
  item_id: string;
  embedding: string;
  title: string;
  category: string;
  colors: string;
  brand: string;
  writing: string;
  found_at: string;
  returned_at: string | null;
  returned_to: string;
  returned_room: string;
  /** From a LEFT JOIN on lf_item: non-null while the item still exists. */
  live_status: string | null;
  thumb_key: string | null;
}

const PRINT_SELECT = `SELECT f.item_id, f.embedding, f.title, f.category, f.colors, f.brand, f.writing, f.found_at,
       f.returned_at, f.returned_to, f.returned_room,
       i.status AS live_status, COALESCE(i.thumb_key, i.photo_key) AS thumb_key
  FROM lf_fingerprint f LEFT JOIN lf_item i ON i.id = f.item_id`;

function parseColors(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const printOf = (r: PrintRow): Print => ({
  vector: decodeVector(r.embedding),
  category: r.category,
  colors: parseColors(r.colors),
  brand: r.brand,
  writing: r.writing.split(" ").filter(Boolean),
});

function dtoOf(r: PrintRow, origin: string, s: { score: number; reasons: LfSimilarReason[] }): LfSimilarDTO {
  return {
    itemId: r.live_status ? r.item_id : null,
    here: r.live_status === "found",
    title: r.title,
    category: r.category,
    colors: parseColors(r.colors),
    brand: r.brand,
    thumbUrl: r.live_status && r.thumb_key ? staffMediaUrl(origin, r.thumb_key) : null,
    foundAt: r.found_at,
    returnedAt: r.returned_at,
    returnedTo: r.returned_to,
    returnedRoom: r.returned_room,
    score: s.score,
    reasons: s.reasons,
  };
}

// ── Writing the fingerprint ─────────────────────────────────────────────────

/** The appearance text embedded for similarity — the public vector's text,
 *  deliberately WITHOUT writing. Kept in step with `embeddingTextOf`. */
export function appearanceText(row: Pick<LfItemRow, "title" | "category" | "colors" | "brand" | "material" | "description" | "tags">): string {
  return [row.title, row.category, parseColors(row.colors).join(", "), row.brand, row.material, row.description, parseColors(row.tags).join(", ")]
    .filter(Boolean)
    .join(". ");
}

async function embedText(env: Env, text: string): Promise<number[]> {
  if (!env.AI) throw new Error("Workers AI is not bound");
  const out = (await env.AI.run(LF_EMBEDDING_MODEL, { text: [text] })) as { data?: number[][] };
  const vector = out.data?.[0];
  if (!vector) throw new Error("embedding model returned no vector");
  return vector;
}

/** Bring an item's fingerprint in step with the item. Best-effort and never
 *  throws, like `syncVector` — the index is a convenience for staff, and a
 *  failure leaves the previous fingerprint (or none) in place. Only DESCRIBED
 *  items have one (an untagged item has nothing to embed). Embeds only when
 *  the appearance text changed; a return or restore just updates the ending.
 *  Held and hidden items are fingerprinted too: staff review them, and "this
 *  came in last week" is exactly what they want while deciding. */
export async function syncFingerprint(env: Env, id: string): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT * FROM lf_item WHERE id = ?").bind(id).first<LfItemRow>();
    if (!row || row.tag_status !== "tagged" || !row.title) return;
    const text = appearanceText(row);
    const existing = await env.DB.prepare("SELECT embed_text FROM lf_fingerprint WHERE item_id = ?")
      .bind(id)
      .first<{ embed_text: string }>();
    const now = nowIso();
    const writing = writingWords(row.name_text).join(" ");
    // A restore puts the item back in the building: whoever it went home to is
    // no longer its ending.
    const returnedAt = row.status === "returned" ? row.returned_at : null;
    if (existing && existing.embed_text === text) {
      await env.DB.prepare(
        `UPDATE lf_fingerprint SET title = ?, category = ?, colors = ?, brand = ?, writing = ?, returned_at = ?,
                returned_to = CASE WHEN ? IS NULL THEN '' ELSE returned_to END,
                returned_room = CASE WHEN ? IS NULL THEN '' ELSE returned_room END, updated_at = ?
          WHERE item_id = ?`,
      )
        .bind(row.title, row.category, row.colors, row.brand, writing, returnedAt, returnedAt, returnedAt, now, id)
        .run();
      return;
    }
    if (!env.AI) return;
    const embedding = encodeVector(await embedText(env, text));
    await env.DB.prepare(
      `INSERT INTO lf_fingerprint (item_id, embedding, embed_text, title, category, colors, brand, writing, found_at, returned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id) DO UPDATE SET embedding = excluded.embedding, embed_text = excluded.embed_text,
         title = excluded.title, category = excluded.category, colors = excluded.colors, brand = excluded.brand,
         writing = excluded.writing, returned_at = excluded.returned_at, updated_at = excluded.updated_at`,
    )
      .bind(id, embedding, text, row.title, row.category, row.colors, row.brand, writing, row.found_at, returnedAt, now)
      .run();
  } catch (err) {
    console.error(`[lostfound] fingerprint sync for ${id} failed: ${String(err).slice(0, 120)}`);
  }
}

/** Remember who an item went home to, from the claim it was returned against.
 *  Child's name wins over the claimant's own: the item is the child's. Stored
 *  as typed (staff read it as typed); never the contact. Best-effort. */
export async function recordReturnOwner(
  env: Env,
  itemId: string,
  claim: { name: string; child_name: string; teacher: string },
): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE lf_fingerprint SET returned_to = ?, returned_room = ?, updated_at = ? WHERE item_id = ?",
    )
      .bind((claim.child_name || claim.name).trim().slice(0, 120), claim.teacher.trim().slice(0, 120), nowIso(), itemId)
      .run();
  } catch (err) {
    console.error(`[lostfound] recording return owner for ${itemId} failed: ${String(err).slice(0, 120)}`);
  }
}

/** Delete one item's fingerprint — for an item deleted by hand, not one swept
 *  after a return (whose history is the point). */
export async function dropFingerprint(env: Env, itemId: string): Promise<void> {
  try {
    await env.DB.prepare("DELETE FROM lf_fingerprint WHERE item_id = ?").bind(itemId).run();
  } catch (err) {
    console.error(`[lostfound] fingerprint delete for ${itemId} failed: ${String(err).slice(0, 120)}`);
  }
}

/** The retention sweep's half (rides `sweepLostFound`). */
export async function sweepFingerprints(env: Env): Promise<void> {
  const before = new Date(Date.now() - LF_HISTORY_RETENTION_DAYS * DAYS).toISOString();
  const res = await env.DB.prepare("DELETE FROM lf_fingerprint WHERE found_at < ?").bind(before).run();
  if (res.meta?.changes) console.log(`[sweep] removed ${res.meta.changes} lost & found fingerprints`);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Items resembling `itemId`, best first, the item itself excluded. Empty when
 *  the item has no fingerprint yet. */
export async function similarTo(env: Env, itemId: string, origin: string): Promise<LfSimilarDTO[]> {
  const me = await env.DB.prepare(`${PRINT_SELECT} WHERE f.item_id = ?`).bind(itemId).first<PrintRow>();
  if (!me) return [];
  const mine = printOf(me);
  const { results } = await env.DB.prepare(
    `${PRINT_SELECT} WHERE f.category = ? AND f.item_id <> ? ORDER BY f.found_at DESC LIMIT ?`,
  )
    .bind(me.category, itemId, LF_SIMILAR_SCAN)
    .all<PrintRow>();
  return results
    .map((r) => ({ r, s: similarity(mine, printOf(r)) }))
    .filter(({ s }) => s.score >= MIN_SIMILARITY)
    .sort((x, y) => y.s.score - x.s.score)
    .slice(0, MAX_SIMILAR)
    .map(({ r, s }) => dtoOf(r, origin, s));
}

/** Groups of items that keep turning up: connected components over pairs at or
 *  above MIN_REPEAT_SIMILARITY, two members or more, biggest first. Compared
 *  within a category only (the score is 0 across them), so the work is the sum
 *  of squares of the category sizes, not of the whole table. */
export async function repeatGroups(env: Env, origin: string): Promise<LfRepeatGroupDTO[]> {
  const { results } = await env.DB.prepare(`${PRINT_SELECT} ORDER BY f.found_at DESC LIMIT ?`)
    .bind(LF_SIMILAR_SCAN)
    .all<PrintRow>();
  const prints = results.map(printOf);
  const parent = results.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const byCategory = new Map<string, number[]>();
  results.forEach((r, i) => byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), i]));
  for (const idx of byCategory.values()) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        if (similarity(prints[idx[x]!]!, prints[idx[y]!]!).score >= MIN_REPEAT_SIMILARITY) {
          parent[find(idx[x]!)] = find(idx[y]!);
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  results.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()]
    .filter((m) => m.length >= 2)
    .map((members): LfRepeatGroupDTO => {
      const rows = members.map((i) => results[i]!); // newest first (query order)
      const head = prints[members[0]!]!;
      const items = rows.map((r, k) => dtoOf(r, origin, k === 0 ? { score: 1, reasons: [] } : similarity(head, printOf(r))));
      return {
        title: rows[0]!.title,
        category: rows[0]!.category,
        count: rows.length,
        firstFoundAt: rows[rows.length - 1]!.found_at,
        lastFoundAt: rows[0]!.found_at,
        returnedTo: [...new Set(rows.map((r) => r.returned_to).filter(Boolean))],
        items,
      };
    })
    .sort((a, b) => b.count - a.count || (a.lastFoundAt < b.lastFoundAt ? 1 : -1))
    .slice(0, MAX_REPEAT_GROUPS);
}

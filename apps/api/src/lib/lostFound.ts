// Lost & found (invariant 33): staff — and any signed-in member — photograph
// what turns up at school, a vision model describes it, and anyone can browse
// and say "that's mine".
//
// THREE SEAMS, and the file is arranged around them.
//
//  1. `publicItemOf` — the ONLY builder of what an anonymous visitor sees,
//     field by field (invariant 12's rule). `visible_text` (everything the
//     model read off the item) and `name_text` (the person's name in that
//     writing, migration 0038) never pass through it: on a school jacket the
//     writing is usually a child's name, and this project's privacy page
//     promises nothing about a child is public. Non-name writing — a brand, a
//     team — is allowed to surface in the description and tags, because that
//     is how parents search ("Nike hoodie"), and the first design scrubbed it
//     all and made children's clothing unfindable.
//
//  2. `searchTextOf` / `embeddingTextOf` — what the PUBLIC search matches on.
//     Both are built without `visible_text` and `name_text`, because a search
//     may not match on more than it renders (invariant 18), and a public "does
//     any item say Milo?" would confirm a child's presence at the school — the
//     name oracle invariant 24 forbids.
//
//  3. `tagItem` — the model's write. Guarded on `tag_status = 'pending'`, so a
//     staff member who saves their own edits while the model is still thinking
//     wins: the item is no longer pending and the model's answer is dropped
//     rather than written over theirs.
//
// The model is told to keep names out of everything but `visible_text` and
// `name_text`, and `scrubNames` enforces it afterwards (cutting `name_text`'s
// words from the public fields): telling a model is not a guarantee. The
// guarantee behind BOTH is the hold — an item with ANY writing waits for staff
// eyes before publishing, so a name the model misfiled as not-a-name still
// passes a person on its way to the public page.

import { LF_CATEGORIES, LF_CLAIM_NOTIFY_MAX, LF_COLORS, LF_DONATE_AFTER_DAYS, LF_ROTATIONS } from "@sd/shared";
import type { LfClaimDTO, LfPublicItemDTO, LfRotation, LfStaffItemDTO } from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import { getSetting } from "./db.js";
import { lostFoundClaimEmail, sendEmail } from "./email.js";
import { rosterAccess, type RosterAccess } from "./rosterGate.js";
import { DAYS, nowIso } from "./time.js";

// ── Access ──────────────────────────────────────────────────────────────────

/** The `setting` key naming the group whose roster runs the lost & found. */
export const LOSTFOUND_GROUP_SETTING = "lostfound_staff_group_id";

/** May this caller act as lost & found staff? `rosterAccess` with this
 *  feature's setting — the gate PTO and the newsletter already share
 *  (invariant 31). NOT the `staff` capability: anyone can assert that about a
 *  Person they create (invariant 27). */
export function lostFoundAccess(env: Env, auth: AuthContext): Promise<RosterAccess> {
  return rosterAccess(env, LOSTFOUND_GROUP_SETTING, auth);
}

/** The `setting` key holding the addresses mailed when a public claim is
 *  stored — a JSON array, written only by the system-admin settings route. */
export const LOSTFOUND_CLAIM_NOTIFY_SETTING = "lostfound_claim_notify_emails";

/** The stored value back as a list. Forgiving on read — the write side
 *  validates, but a hand-edited or legacy value must come back as "whatever
 *  addresses are recognisable", never as a throw on the claim path. */
export function parseClaimNotifyEmails(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const email = v.trim().toLowerCase();
      if (email && email.includes("@") && !out.includes(email)) out.push(email);
    }
    return out.slice(0, LF_CLAIM_NOTIFY_MAX);
  } catch {
    return [];
  }
}

/** Mail the configured addresses that a claim just arrived. Called from the
 *  public claim route's `waitUntil`, AFTER the claim row committed — only a
 *  STORED claim notifies, so the honeypot and the caps bound this exactly as
 *  they bound the rows (a suppressed claim must not become email instead).
 *  Never throws, and sends nothing when no address is configured. The message
 *  carries the item's title and the queue link, never the claimant
 *  (lostFoundClaimEmail's comment). */
export async function notifyLostFoundClaim(env: Env, itemTitle: string): Promise<void> {
  try {
    const recipients = parseClaimNotifyEmails(await getSetting(env, LOSTFOUND_CLAIM_NOTIFY_SETTING));
    if (recipients.length === 0) return;
    const msg = lostFoundClaimEmail(env, itemTitle);
    for (const to of recipients) {
      try {
        await sendEmail(env, { ...msg, to });
      } catch (err) {
        console.error(`[lostfound] claim notification failed to=${to}: ${String(err)}`);
      }
    }
  } catch (err) {
    console.error(`[lostfound] claim notification failed: ${String(err)}`);
  }
}

// ── Rows and projections ────────────────────────────────────────────────────

export interface LfItemRow {
  id: string;
  status: "found" | "returned";
  hidden_at: string | null;
  held_at: string | null;
  tag_status: "pending" | "tagged" | "failed";
  tag_error: string | null;
  title: string;
  description: string;
  category: string;
  colors: string;
  brand: string;
  material: string;
  visible_text: string;
  /** The person's name within that writing, if any (migration 0038). Staff-only
   *  like `visible_text`; the ONLY source `scrubNames` cuts from public text. */
  name_text: string;
  tags: string;
  location: string;
  search_text: string;
  photo_key: string;
  thumb_key: string | null;
  suggested_rotation: number;
  found_at: string;
  returned_at: string | null;
  created_by: string | null;
  /** 1 when the creator was NOT on the staff roster at creation time. The model
   *  never auto-releases the hold on such an item (migration 0037). */
  member_submitted: number;
  updated_at: string;
}

export interface LfClaimRow {
  id: string;
  item_id: string;
  name: string;
  contact: string;
  /** The child the claimant says the item belongs to ("" when they didn't
   *  say) and that child's teacher or room (migration 0043). Anonymous free
   *  text with the same posture as `name`/`contact`/`message`: staff-only,
   *  never in audit `detail`, Slack or email, swept with the claim. */
  child_name: string;
  teacher: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  resolution: "returned" | "dismissed" | null;
}

/** Absolute, like newsletter media: the SPA lives on another origin. The
 *  public route serves a photo only while its item is listed; staff read every
 *  photo through their own gated route (src/index.ts, routes/lostFound.ts). */
export function mediaUrl(origin: string, key: string): string {
  return `${origin}/lostfound-media/${key}`;
}
export function staffMediaUrl(origin: string, key: string): string {
  return `${origin}/lostfound/media/${key}`;
}

/** The item a photo key belongs to. Keys are `<id>.jpg` and `<id>-thumb.jpg`,
 *  and nothing else is ever written to the bucket. */
export function itemIdOfKey(key: string): string | null {
  const m = /^([0-9A-HJKMNP-TV-Z]{26})(?:-[0-9a-z]{1,12})?(?:-thumb)?\.jpg$/.exec(key);
  return m ? m[1]! : null;
}

/** A fresh key for an item's photo or thumbnail. Replacing an image (staff
 *  rotating it) writes a NEW object rather than overwriting the old one, since
 *  both media routes are cached for an hour and an overwritten key would keep
 *  serving the image sideways. `itemIdOfKey` still maps it to its item. */
export function versionedKey(id: string, thumb: boolean): string {
  return `${id}-${Date.now().toString(36)}${thumb ? "-thumb" : ""}.jpg`;
}

/** Photo caps and the JPEG sniff, shared by the upload route and the email
 *  intake (routes/lostFound.ts, lib/lostFoundEmail.ts) so the two doors in
 *  can't drift apart. The sniff reads the magic bytes, not the declared type:
 *  the public media route must never serve something that merely claimed to
 *  be a JPEG. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MAX_THUMB_BYTES = 1024 * 1024;
// There is deliberately NO per-member item cap. A 25/day one shipped first and
// cut off a parent photographing the whole lost & found rack mid-pile
// (2026-10); the actual safety is the HOLD — a member-submitted item never
// reaches the web until staff Publish — and a runaway account's spend (R2
// objects, model calls) is a pile of held items in front of staff, deletable
// from the review queue in one sitting.

export function isJpegBytes(b: ArrayBuffer): boolean {
  if (b.byteLength < 3) return false;
  const h = new Uint8Array(b, 0, 3);
  return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
}

function jsonList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** What an anonymous visitor sees. Field by field — never a spread — so a
 *  column added to `lf_item` stays private until someone adds it here on
 *  purpose. test/lostFound.test.ts pins the key set. */
export function publicItemOf(row: LfItemRow, origin: string): LfPublicItemDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    colors: jsonList(row.colors),
    brand: row.brand,
    material: row.material,
    tags: jsonList(row.tags),
    location: row.location,
    foundAt: row.found_at,
    pending: row.tag_status === "pending",
    photoUrl: mediaUrl(origin, row.photo_key),
    thumbUrl: mediaUrl(origin, row.thumb_key ?? row.photo_key),
  };
}

export function donateDue(row: Pick<LfItemRow, "status" | "found_at">, now = Date.now()): boolean {
  return row.status === "found" && now - new Date(row.found_at).getTime() > LF_DONATE_AFTER_DAYS * DAYS;
}

export type LfStaffRow = LfItemRow & { open_claims: number; created_by_email: string | null };

/** The staff view: everything, including what the model read off the item.
 *  Photo URLs point at the staff media route, which serves held and hidden
 *  items' photos too. */
export function staffItemOf(row: LfStaffRow, origin: string): LfStaffItemDTO {
  const pub = publicItemOf(row, origin);
  return {
    id: pub.id,
    title: pub.title,
    description: pub.description,
    category: pub.category,
    colors: pub.colors,
    brand: pub.brand,
    material: pub.material,
    tags: pub.tags,
    location: pub.location,
    foundAt: pub.foundAt,
    photoUrl: staffMediaUrl(origin, row.photo_key),
    thumbUrl: staffMediaUrl(origin, row.thumb_key ?? row.photo_key),
    status: row.status,
    tagStatus: row.tag_status,
    tagError: row.tag_error,
    visibleText: row.visible_text,
    nameText: row.name_text,
    hiddenAt: row.hidden_at,
    heldAt: row.held_at,
    returnedAt: row.returned_at,
    suggestedRotation: cleanRotation(row.suggested_rotation),
    donateDue: donateDue(row),
    openClaims: row.open_claims,
    memberSubmitted: row.member_submitted === 1,
    createdByEmail: row.created_by_email,
    updatedAt: row.updated_at,
  };
}

export function claimOf(row: LfClaimRow & { item_title: string; thumb_key: string }, origin: string): LfClaimDTO {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    thumbUrl: staffMediaUrl(origin, row.thumb_key),
    name: row.name,
    contact: row.contact,
    childName: row.child_name,
    teacher: row.teacher,
    message: row.message,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

/** Staff rows carry their open-claim count and uploader's address. */
export const STAFF_ITEM_SELECT = `
  SELECT i.*,
         (SELECT COUNT(*) FROM lf_claim c WHERE c.item_id = i.id AND c.resolved_at IS NULL) AS open_claims,
         u.email AS created_by_email
    FROM lf_item i LEFT JOIN user u ON u.id = i.created_by`;

export function getItem(env: Env, id: string): Promise<LfItemRow | null> {
  return env.DB.prepare("SELECT * FROM lf_item WHERE id = ?").bind(id).first<LfItemRow>();
}

export function getStaffItem(env: Env, id: string): Promise<LfStaffRow | null> {
  return env.DB.prepare(`${STAFF_ITEM_SELECT} WHERE i.id = ?`).bind(id).first<LfStaffRow>();
}

// ── Field validation ────────────────────────────────────────────────────────

/** The descriptive fields, from the model or the staff edit form. */
export interface LfFields {
  title: string;
  description: string;
  category: string;
  colors: string[];
  brand: string;
  material: string;
  visibleText: string;
  nameText: string;
  tags: string[];
}

// Models fill an unknown field with a placeholder more often than with "".
const PLACEHOLDER = /^(none|n\/?a|unknown|not (visible|applicable|readable)|no (brand|text)( visible)?|-)$/i;

export function cleanText(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return PLACEHOLDER.test(s) ? "" : s;
}

function cleanList(v: unknown, keep: (s: string) => boolean = Boolean): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => cleanText(x, 40).toLowerCase()).filter(keep))];
}

const isCategory = (v: unknown): v is string => (LF_CATEGORIES as readonly unknown[]).includes(v);
const isColor = (v: unknown): v is string => (LF_COLORS as readonly unknown[]).includes(v);

/** One set of rules for both writers, so the model and staff can't disagree
 *  about what a valid item is. `title` comes back "" when missing; the caller
 *  decides whether that is an error. */
export function cleanFields(o: Record<string, unknown>): LfFields {
  return {
    title: cleanText(o.title, 120),
    description: cleanText(o.description, 1000),
    category: isCategory(o.category) ? o.category : "Other",
    colors: cleanList(o.colors, isColor).slice(0, 4),
    brand: cleanText(o.brand, 80),
    material: cleanText(o.material, 80),
    visibleText: cleanText(o.visibleText ?? o.visible_text, 300),
    nameText: cleanText(o.nameText ?? o.name_text, 300),
    tags: cleanList(o.tags).slice(0, 20),
  };
}

/** A rotation the model suggested, snapped to the four it may say; anything
 *  else (a string, 45, a missing key) is 0 — "leave it", the safe guess. */
export function cleanRotation(v: unknown): LfRotation {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return (LF_ROTATIONS as readonly unknown[]).includes(n) ? (n as LfRotation) : 0;
}

/**
 * Remove the words the model read off the item from everything public.
 *
 * The prompt already asks for names only in `visible_text` and `name_text`;
 * this is the part that doesn't rely on being obeyed. Any word of three or
 * more letters from `name_text` that isn't part of the brand is cut from the
 * title, description and tags.
 *
 * `name_text`, NOT `visible_text` (migration 0038): the first version cut
 * every word read off the item, and that made brands unsearchable — "NIKE"
 * on a hoodie vanished from its description and tags, and parents searching
 * by brand couldn't find their children's clothing. Non-name writing now
 * stays. What makes the narrower scrub safe is the HOLD, not the model's
 * judgement: an item with ANY writing (`visible_text`), name or not, waits
 * for staff eyes before it is published, so a name the model misfiled is a
 * held photo in front of a person, not a public page.
 */
export function scrubNames(f: LfFields): LfFields {
  const brandWords = new Set(f.brand.toLowerCase().match(/\p{L}+/gu) ?? []);
  const words = [...new Set(f.nameText.toLowerCase().match(/\p{L}{3,}/gu) ?? [])].filter(
    (w) => !brandWords.has(w),
  );
  if (!words.length) return f;
  // Letter lookarounds rather than \b, which only knows ASCII word characters.
  const pattern = new RegExp(`(?<!\\p{L})(${words.join("|")})(?!\\p{L})`, "giu");
  const scrub = (s: string) => s.replace(pattern, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return {
    ...f,
    title: scrub(f.title) || f.category,
    description: scrub(f.description),
    tags: f.tags.map(scrub).filter(Boolean),
  };
}

/** The public keyword haystack. NOT visible_text or name_text — see the header. */
export function searchTextOf(f: Omit<LfFields, "visibleText" | "nameText">, location: string): string {
  return [f.title, f.description, f.category, f.colors.join(" "), f.brand, f.material, f.tags.join(" "), location]
    .join(" ")
    .toLowerCase();
}

function embeddingTextOf(row: LfItemRow): string {
  return [row.title, row.category, jsonList(row.colors).join(", "), row.brand, row.material, row.description, jsonList(row.tags).join(", ")]
    .filter(Boolean)
    .join(". ");
}

/**
 * Write the descriptive fields and mark the item tagged. Shared by the model
 * and the edit form. With `onlyIfPending`, writes only while the item is still
 * waiting for the model — so staff edits made meanwhile win. Returns whether a
 * row changed.
 */
export async function saveFields(
  env: Env,
  id: string,
  raw: LfFields,
  {
    location,
    onlyIfPending = false,
    rotation,
  }: { location?: string; onlyIfPending?: boolean; rotation?: LfRotation } = {},
): Promise<boolean> {
  const f = scrubNames(raw);
  const current = location ?? (await env.DB.prepare("SELECT location FROM lf_item WHERE id = ?").bind(id).first<string>("location")) ?? "";
  const now = nowIso();
  // Only the MODEL's write moves the hold (the AI path is the one passing
  // `onlyIfPending`): writing read off the item holds it, none releases it.
  // A staff save leaves it alone — publishing is its own deliberate act.
  // The model may RELEASE a hold only on an item it has never read writing on:
  // SET expressions see the old row, so `visible_text = ''` below is what was
  // stored before this write. Once something was read, only staff publish —
  // a retag that happens to miss the name must not put the photo online.
  // A member-submitted item is never released by the model at all (migration
  // 0037): no writing proves nothing about a photo a non-staff member chose,
  // so only staff's Publish puts it online.
  const hold = onlyIfPending
    ? `, held_at = ${f.visibleText ? "COALESCE(held_at, ?)" : "CASE WHEN visible_text = '' AND member_submitted = 0 THEN NULL ELSE held_at END"}`
    : "";
  const holdBinds = onlyIfPending && f.visibleText ? [now] : [];
  // Only the model suggests a rotation; a staff save leaves the last one alone.
  const turn = rotation === undefined ? "" : ", suggested_rotation = ?";
  const turnBinds = rotation === undefined ? [] : [rotation];
  const { meta } = await env.DB.prepare(
    `UPDATE lf_item
        SET tag_status = 'tagged', tag_error = NULL, title = ?, description = ?, category = ?, colors = ?,
            brand = ?, material = ?, visible_text = ?, name_text = ?, tags = ?, location = ?, search_text = ?, updated_at = ?${hold}${turn}
      WHERE id = ?${onlyIfPending ? " AND tag_status = 'pending'" : ""}`,
  )
    .bind(
      f.title,
      f.description,
      f.category,
      JSON.stringify(f.colors),
      f.brand,
      f.material,
      f.visibleText,
      f.nameText,
      JSON.stringify(f.tags),
      current,
      searchTextOf(f, current),
      now,
      ...holdBinds,
      ...turnBinds,
      id,
    )
    .run();
  return (meta?.changes ?? 0) > 0;
}

// ── The model ───────────────────────────────────────────────────────────────

/** Gemma 4 on Workers AI: open weights, image input, JSON mode, no per-account
 *  licence step (Llama 3.2 Vision has one, which a fresh deploy would trip). */
export const LF_VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const LF_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

const PROMPT = `You catalog items in a school's lost and found so families can find their belongings.
Describe the single main item in the photo (if several are pictured, the most prominent one).

Reply with only a JSON object with exactly these keys:
- "title": short name, 2-6 words, e.g. "Blue Hydro Flask water bottle"
- "description": one or two sentences a parent would use to recognize it: color, pattern, characters, stickers, wear
- "category": exactly one of: ${LF_CATEGORIES.join("; ")}
- "colors": array of 1-4 main colors, most prominent first, each one of: ${LF_COLORS.join(", ")}
- "brand": brand name if you can read it or clearly recognize the logo, otherwise ""
- "material": main material (e.g. metal, plastic, fleece, cotton, leather), or ""
- "visible_text": any readable writing on the item, exactly as written, otherwise ""
- "name_text": the part of that writing that is a person's name (a child's first or last name, initials, a family name on a label), exactly as written, otherwise "". A brand, team, character, school or slogan is NOT a person's name
- "tags": array of 5-12 lowercase search keywords a parent might type, including synonyms (e.g. "bottle", "flask", "tumbler") and notable features
- "rotation": how many degrees the photo must be turned CLOCKWISE so the item stands the way it is normally used or worn (a bottle cap up, a jacket collar up, text reading left to right): exactly one of 0, 90, 180, 270. Use 0 if it is already upright or if you can't tell

Names of people must appear ONLY in "visible_text" and "name_text" — never in the title, description, or tags.
Never guess a brand or name you can't actually read.`;

/** Ask the model once. Plain JSON mode: strict `json_schema` decoding with
 *  long enums made Gemma loop on whitespace until max_tokens on about half the
 *  photos tried, where JSON mode plus `cleanFields` went 10 for 10. */
async function describeOnce(ai: Ai, model: string, dataUrl: string): Promise<Described> {
  // The model id is configurable, so it can't be checked against the typed catalog.
  const run = ai.run.bind(ai) as (model: string, input: unknown) => Promise<unknown>;
  const result = await run(model, {
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this lost-and-found item." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    // A good answer is ~150-250 tokens; the cap bounds what a derailed one costs.
    max_tokens: 800,
    temperature: 0.2,
    // Thinking is on by default for Gemma 4 and its tokens are billed.
    chat_template_kwargs: { enable_thinking: false },
  });
  const json = extractJson(result);
  const fields = cleanFields(json);
  if (!fields.title) throw new Error("model returned no title");
  return { fields, rotation: cleanRotation(json.rotation) };
}

/** What one look at a photo yields: the description, and which way is up. */
export interface Described {
  fields: LfFields;
  rotation: LfRotation;
}

/** Workers AI answers `{ response }` or OpenAI-style `{ choices }`, as a string
 *  or an object depending on the model. */
export function extractJson(result: unknown): Record<string, unknown> {
  const r = result as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  const raw = r?.response ?? r?.choices?.[0]?.message?.content ?? result;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
  }
  // A fixed message, never the answer itself: it may hold what was read off
  // the item, and this string reaches a log line and `tag_error`.
  throw new Error(`model returned no JSON (${JSON.stringify(result ?? null).length} chars)`);
}

function toDataUrl(jpeg: ArrayBuffer): string {
  const bytes = new Uint8Array(jpeg);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Describe a photo, with one retry: sampling is random, and a derailed answer
 *  almost never derails twice. */
export async function describePhoto(env: Env, jpeg: ArrayBuffer): Promise<Described> {
  if (!env.AI) throw new Error("Workers AI is not bound");
  const model = env.LOSTFOUND_VISION_MODEL || LF_VISION_MODEL;
  const dataUrl = toDataUrl(jpeg);
  try {
    return await describeOnce(env.AI, model, dataUrl);
  } catch (err) {
    // Not the error: a JSON.parse failure quotes the model's text.
    console.warn("[lostfound] describe attempt failed, retrying once");
    return describeOnce(env.AI, model, dataUrl);
  }
}

async function embed(env: Env, text: string): Promise<number[]> {
  if (!env.AI) throw new Error("Workers AI is not bound");
  const out = (await env.AI.run(LF_EMBEDDING_MODEL, { text: [text] })) as { data?: number[][] };
  const vector = out.data?.[0];
  if (!vector) throw new Error("embedding model returned no vector");
  return vector;
}

/** Mark an item for (re)description. Only pending items accept the model's answer. */
export function markPending(env: Env, id: string) {
  return env.DB.prepare("UPDATE lf_item SET tag_status = 'pending', tag_error = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
}

/**
 * Describe a pending item. Never throws — a failure is recorded on the item
 * and the nightly sweep retries it. Writes nothing to the audit log: this is a
 * machine filling in fields, and one row per attempt would pad the log
 * (invariant 5). Staff acts on the item are what get recorded.
 */
export async function tagItem(env: Env, id: string, jpeg?: ArrayBuffer): Promise<void> {
  try {
    if (!jpeg) {
      const row = await getItem(env, id);
      if (!row) return;
      const obj = await env.LOSTFOUND_MEDIA.get(row.thumb_key ?? row.photo_key);
      if (!obj) throw new Error("photo missing from storage");
      jpeg = await obj.arrayBuffer();
    }
    const { fields, rotation } = await describePhoto(env, jpeg);
    if (await saveFields(env, id, fields, { onlyIfPending: true, rotation })) await syncVector(env, id);
  } catch (err) {
    // Never the model's output in a log line: it may hold a child's name.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lostfound] describing ${id} failed`);
    await env.DB.prepare("UPDATE lf_item SET tag_status = 'failed', tag_error = ? WHERE id = ? AND tag_status = 'pending'")
      .bind(message.slice(0, 300), id)
      .run();
  }
}

/** Keep the semantic index in step with the row: only items that are listed —
 *  found, not hidden, not held, described — have a vector. Best-effort; keyword search
 *  works without it. */
export async function syncVector(env: Env, id: string): Promise<void> {
  const index = env.LOSTFOUND_VECTORS;
  if (!index) return;
  try {
    const row = await getItem(env, id);
    if (!row || !isListed(row) || !row.title) {
      await index.deleteByIds([id]);
      return;
    }
    await index.upsert([{ id, values: await embed(env, embeddingTextOf(row)) }]);
  } catch (err) {
    console.error(`[lostfound] vector sync for ${id} failed: ${String(err).slice(0, 120)}`);
  }
}

// ── Browse and search ───────────────────────────────────────────────────────

export interface LfFilters {
  category?: string;
  color?: string;
}

/** Effectively "everything" at a school's scale: the browse page shows ALL
 *  listed items at once (asked for, 2026-10 — a parent scanning for a coat
 *  shouldn't pump a button). The paging machinery underneath stays as the
 *  escape hatch for the day the rack outgrows this, and the LIMIT still
 *  bounds one response's size. */
export const LF_PAGE_SIZE = 500;
/** Cosine floor for semantic matches. bge-small scores even unrelated text
 *  fairly high; raise this if searches return noise. */
const MIN_SEMANTIC_SCORE = 0.7;
const RRF_K = 60;

/** The public listing gate, in SQL (invariant 15's rule): still here, not
 *  hidden by staff, not held for review. */
export const LISTED = "status = 'found' AND hidden_at IS NULL AND held_at IS NULL";
/** `LISTED`, for a row already in hand. Keep the two in step. */
export const isListed = (r: Pick<LfItemRow, "status" | "hidden_at" | "held_at">): boolean =>
  r.status === "found" && !r.hidden_at && !r.held_at;

/** How many items are listed right now — the number the browse page shows up
 *  top. Counts exactly the public gate, nothing narrower or wider: the same
 *  rows browsing already shows, so the number discloses nothing new
 *  (invariant 18's COUNT rule). */
export async function listedCount(env: Env): Promise<number> {
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lf_item WHERE ${LISTED}`).first<number>("n");
  return n ?? 0;
}

export function parseFilters(q: Record<string, string>): LfFilters {
  return {
    category: isCategory(q.category) ? q.category : undefined,
    color: isColor(q.color) ? q.color : undefined,
  };
}

function filterSql(f: LfFilters, binds: unknown[]): string {
  let sql = "";
  if (f.category) {
    sql += " AND category = ?";
    binds.push(f.category);
  }
  if (f.color) {
    sql += " AND EXISTS (SELECT 1 FROM json_each(lf_item.colors) WHERE json_each.value = ?)";
    binds.push(f.color);
  }
  return sql;
}

export async function browse(env: Env, f: LfFilters, page: number) {
  const binds: unknown[] = [];
  const where = filterSql(f, binds);
  const { results } = await env.DB.prepare(
    `SELECT * FROM lf_item WHERE ${LISTED}${where} ORDER BY found_at DESC, id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, LF_PAGE_SIZE + 1, page * LF_PAGE_SIZE)
    .all<LfItemRow>();
  return { items: results.slice(0, LF_PAGE_SIZE), hasMore: results.length > LF_PAGE_SIZE };
}

/** Lowercased words worth matching. D1 caps a LIKE pattern at 50 bytes. */
export function searchWords(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].map((w) => w.slice(0, 40)).slice(0, 8);
}

/** Keyword and semantic results, merged by reciprocal rank fusion. */
export async function search(env: Env, q: string, f: LfFilters) {
  const words = searchWords(q);
  if (!words.length) return { items: [] as LfItemRow[], hasMore: false };

  const [keyword, semantic] = await Promise.all([keywordIds(env, words, f), semanticIds(env, q)]);
  const scores = new Map<string, number>();
  for (const ids of [keyword, semantic]) {
    ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  // D1 allows 100 bound parameters; leave room for the filters.
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 90).map(([id]) => id);
  if (!ranked.length) return { items: [] as LfItemRow[], hasMore: false };

  const binds: unknown[] = [...ranked];
  const where = filterSql(f, binds);
  const { results } = await env.DB.prepare(
    `SELECT * FROM lf_item WHERE ${LISTED} AND id IN (${ranked.map(() => "?").join(",")})${where}`,
  )
    .bind(...binds)
    .all<LfItemRow>();
  results.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  return { items: results, hasMore: false };
}

async function keywordIds(env: Env, words: string[], f: LfFilters): Promise<string[]> {
  const binds: unknown[] = words.map((w) => `%${w}%`);
  const where = filterSql(f, binds);
  const { results } = await env.DB.prepare(
    `SELECT id FROM lf_item WHERE ${LISTED} AND ${words.map(() => "search_text LIKE ?").join(" AND ")}${where}
      ORDER BY found_at DESC LIMIT 50`,
  )
    .bind(...binds)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

async function semanticIds(env: Env, q: string): Promise<string[]> {
  if (!env.LOSTFOUND_VECTORS || !env.AI) return [];
  try {
    const { matches } = await env.LOSTFOUND_VECTORS.query(await embed(env, q), { topK: 40 });
    return matches.filter((m) => m.score >= MIN_SEMANTIC_SCORE).map((m) => m.id);
  } catch (err) {
    // Out of AI allocation, or Vectorize under `wrangler dev`: keywords only.
    console.error(`[lostfound] semantic search unavailable: ${String(err).slice(0, 120)}`);
    return [];
  }
}

// ── Claims ──────────────────────────────────────────────────────────────────

/** Claims one contact may file per day. Enough for "I'm not sure which of
 *  these three is his"; too few to flood the office's queue as somebody else. */
export const CLAIMS_PER_CONTACT_PER_DAY = 3;
/** Claims the whole instance accepts per day. A school sees a handful; hitting
 *  this means a script, and it logs loudly. */
export const CLAIMS_PER_DAY_TOTAL = 50;
/** Open claims one item may carry, so one jacket can't be buried. */
export const OPEN_CLAIMS_PER_ITEM = 10;

/** The per-contact cap's KEY (stored as `lf_claim.contact_key`): trimmed,
 *  lowercased, and for something phone-shaped reduced to its digits, so
 *  "(612) 555-0100" and "612.555.0100" are one person. Never shown — the
 *  office sees `contact` exactly as it was typed. */
export function normalizeContact(contact: string): string {
  const c = contact.trim().toLowerCase();
  const digits = c.replace(/\D/g, "");
  return !c.includes("@") && digits.length >= 7 ? digits : c;
}

// ── Retention (runs with the daily sweeps) ──────────────────────────────────

/** A returned item is kept this long — long enough to undo a mis-tap and to
 *  answer "did someone pick up the blue coat?" — then deleted with its photos,
 *  vector and claims. */
export const RETURNED_RETENTION_DAYS = 30;
/** A settled claim's contact details are kept this long, then the claim goes. */
export const CLAIM_RETENTION_DAYS = 60;

export async function sweepLostFound(env: Env): Promise<void> {
  const now = Date.now();
  try {
    const returnedBefore = new Date(now - RETURNED_RETENTION_DAYS * DAYS).toISOString();
    const { results } = await env.DB.prepare(
      "SELECT id, photo_key, thumb_key FROM lf_item WHERE status = 'returned' AND returned_at < ? LIMIT 200",
    )
      .bind(returnedBefore)
      .all<{ id: string; photo_key: string; thumb_key: string | null }>();
    for (const r of results) await deleteItem(env, r);
    if (results.length) console.log(`[sweep] removed ${results.length} returned lost & found items`);

    const settledBefore = new Date(now - CLAIM_RETENTION_DAYS * DAYS).toISOString();
    const res = await env.DB.prepare("DELETE FROM lf_claim WHERE resolved_at IS NOT NULL AND resolved_at < ?")
      .bind(settledBefore)
      .run();
    if (res.meta?.changes) console.log(`[sweep] removed ${res.meta.changes} settled lost & found claims`);
  } catch (err) {
    console.error(`[sweep] lost & found failed: ${String(err)}`);
  }
}

/** Delete an item for good: row (claims cascade), photos, vector. */
export async function deleteItem(
  env: Env,
  item: { id: string; photo_key: string; thumb_key: string | null },
): Promise<void> {
  await env.DB.prepare("DELETE FROM lf_item WHERE id = ?").bind(item.id).run();
  await env.LOSTFOUND_MEDIA.delete([item.photo_key, ...(item.thumb_key ? [item.thumb_key] : [])]);
  try {
    await env.LOSTFOUND_VECTORS?.deleteByIds([item.id]);
  } catch (err) {
    console.error(`[lostfound] vector delete for ${item.id} failed: ${String(err).slice(0, 120)}`);
  }
}

/** Retry failed descriptions, and pending ones stranded by a Worker that died
 *  mid-call (pending for over ten minutes). Rides the daily cron — there is no
 *  slot for a cron of its own (src/index.ts). No thumbnail is no obstacle:
 *  `tagItem` reads the full photo when there is none (an emailed item may
 *  never get one — lib/lostFoundEmail.ts), and the ten-minute threshold is
 *  what protects an app upload whose thumbnail is still on its way. */
export async function retagStuck(env: Env, limit: number): Promise<number> {
  if (!env.AI) return 0;
  const strandedBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id FROM lf_item
      WHERE tag_status = 'failed' OR (tag_status = 'pending' AND updated_at < ?)
      ORDER BY found_at LIMIT ?`,
  )
    .bind(strandedBefore, limit)
    .all<{ id: string }>();
  for (const { id } of results) {
    await markPending(env, id);
    await tagItem(env, id);
  }
  return results.length;
}

// Contact items — create/update/delete. Controller-gated. Addresses get a
// neighbor-discoverable flag; geocoding is wired in M3 (status starts 'pending').

import { Hono } from "hono";
import type { ContactItemInput, ContactType, Visibility } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { geocodeContact } from "../lib/geocode.js";
import { staticMapUrl } from "../lib/geo.js";

export const contacts = new Hono<HonoEnv>();

const MAP_W = 480;
const MAP_H = 200;
const MAP_ZOOM = 15;

/**
 * GET /contacts/:id/map — server-rendered static map for an address. Returns
 * only an image; the stored coordinates never reach the client. Gated to a
 * controller of the owning Person (i.e. someone allowed to see the exact spot).
 */
contacts.get("/contacts/:id/map", async (c) => {
  const auth = requireAuth(c);
  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id, type, geo_lat, geo_lng FROM contact_item WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ owner_kind: string; owner_id: string; type: string; geo_lat: number | null; geo_lng: number | null }>();
  if (!item || item.type !== "address" || item.geo_lat == null || item.geo_lng == null) {
    return c.json({ error: "no_map" }, 404);
  }
  if (item.owner_kind !== "person" || !(await isController(c.env, auth.userId, item.owner_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const url = staticMapUrl(c.env, item.geo_lat, item.geo_lng, MAP_W, MAP_H, MAP_ZOOM);
  const res = await fetch(url, {
    headers: { "User-Agent": `${c.env.SCHOOL_NAME ?? "School"} School Directory (+https://github.com/Eisenhower-Elementary-PTO/school-directory)` },
  });
  if (!res.ok) return c.json({ error: "map_unavailable" }, 502);
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "private, max-age=86400",
    },
  });
});

const TYPES: ContactType[] = ["address", "phone", "email", "url"];
const VIS: Visibility[] = ["service", "private"];

/** POST /persons/:id/contacts — add a contact item. */
contacts.post("/persons/:id/contacts", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json<ContactItemInput>().catch(() => null);
  if (!body || !TYPES.includes(body.type) || !body.value?.trim()) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const id = ulid();
  const visibility: Visibility = VIS.includes(body.visibility as Visibility)
    ? (body.visibility as Visibility)
    : "private"; // new fields default to private (NFR-1)
  const isAddress = body.type === "address";
  await c.env.DB.prepare(
    `INSERT INTO contact_item
       (id, owner_kind, owner_id, type, label, value, visibility,
        neighbor_discoverable, geocode_status, created_at, updated_at)
     VALUES (?, 'person', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      personId,
      body.type,
      body.label ?? null,
      body.value.trim(),
      visibility,
      isAddress && body.neighborDiscoverable ? 1 : 0,
      isAddress ? "pending" : "none",
      nowIso(),
      nowIso(),
    )
    .run();

  c.var.audit.push({
    action: "contact.created",
    entityKind: "contact_item",
    entityId: id,
    detail: { type: body.type, personId },
  });
  if (isAddress) c.executionCtx.waitUntil(geocodeContact(c.env, id, body.value.trim()));
  return c.json({ id }, 201);
});

/** PATCH /contacts/:id — update value/label/visibility/neighbor flag. */
contacts.patch("/contacts/:id", async (c) => {
  const auth = requireAuth(c);
  const id = c.req.param("id");

  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id, type, value FROM contact_item WHERE id = ?",
  )
    .bind(id)
    .first<{ owner_kind: string; owner_id: string; type: string; value: string }>();
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.owner_kind !== "person" || !(await isController(c.env, auth.userId, item.owner_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<Partial<ContactItemInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  let valueChanged = false;
  if (typeof body.value === "string" && body.value.trim()) {
    sets.push("value = ?");
    binds.push(body.value.trim());
    valueChanged = body.value.trim() !== item.value;
  }
  if (body.label !== undefined) {
    sets.push("label = ?");
    binds.push(body.label ?? null);
  }
  if (body.visibility && VIS.includes(body.visibility)) {
    sets.push("visibility = ?");
    binds.push(body.visibility);
  }
  if (body.neighborDiscoverable !== undefined && item.type === "address") {
    sets.push("neighbor_discoverable = ?");
    binds.push(body.neighborDiscoverable ? 1 : 0);
  }
  // Re-geocode if an address value changed (M3 queue picks up 'pending').
  if (valueChanged && item.type === "address") {
    sets.push("geocode_status = ?", "geo_lat = NULL", "geo_lng = NULL");
    binds.push("pending");
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await c.env.DB.prepare(`UPDATE contact_item SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  c.var.audit.push({ action: "contact.updated", entityKind: "contact_item", entityId: id });
  if (valueChanged && item.type === "address" && typeof body.value === "string") {
    c.executionCtx.waitUntil(geocodeContact(c.env, id, body.value.trim()));
  }
  return c.json({ ok: true });
});

/** DELETE /contacts/:id */
contacts.delete("/contacts/:id", async (c) => {
  const auth = requireAuth(c);
  const id = c.req.param("id");
  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id FROM contact_item WHERE id = ?",
  )
    .bind(id)
    .first<{ owner_kind: string; owner_id: string }>();
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.owner_kind !== "person" || !(await isController(c.env, auth.userId, item.owner_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM contact_item WHERE id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM share WHERE subject_kind = 'contact_item' AND subject_ref = ?").bind(id),
  ]);
  c.var.audit.push({ action: "contact.deleted", entityKind: "contact_item", entityId: id });
  return c.json({ ok: true });
});

// Server-side geocoding via Nominatim (OpenStreetMap). Runs only on address
// mutation; coordinates are stored on the contact_item and NEVER serialized to
// clients (SDD §6).
//
// Nominatim compliance: a descriptive User-Agent (stock library UAs are
// rejected), ≤1 request/second, and OSM attribution wherever a derived area is
// shown. A single school adds addresses one at a time, so interactive writes sit
// far under the limit and geocode in the background (waitUntil). Bulk import
// (M4) will drain a deferred queue at ≤1 rps so it never bursts.

import type { Env } from "../env.js";
import { nowIso } from "./time.js";

const DEFAULT_ENDPOINT = "https://nominatim.openstreetmap.org/search";

function userAgent(env: Env): string {
  // Identifies the app + a contact URL, per Nominatim's usage policy.
  return `${env.SCHOOL_NAME ?? "School"} School Directory (+https://github.com/Eisenhower-Elementary-PTO/school-directory)`;
}

/** Progressively coarser variants of an address: full, then dropping leading
 *  comma segments (street) down to roughly "city, state zip". Lets us fall back
 *  to an approximate location when OSM lacks the exact house. */
function coarseVariants(query: string): string[] {
  const parts = query.split(",").map((s) => s.trim()).filter(Boolean);
  const variants = [query.trim()];
  // Keep at least the last two segments (e.g. "City", "State ZIP").
  for (let i = 1; i <= parts.length - 2; i++) {
    variants.push(parts.slice(i).join(", "));
  }
  return [...new Set(variants)].slice(0, 3);
}

async function queryNominatim(env: Env, q: string): Promise<{ lat: number; lng: number } | null> {
  const base = env.NOMINATIM_URL ?? DEFAULT_ENDPOINT;
  const url = `${base}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=0`;
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent(env), Accept: "application/json", Referer: env.APP_URL ?? "" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = Number.parseFloat(data[0]?.lat ?? "");
  const lng = Number.parseFloat(data[0]?.lon ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/** Resolve a free-text address to coordinates, or null if not found. Falls back
 *  to coarser variants (drops street) so an OSM-unknown house still resolves to
 *  its town/zip — enough for the approximate Neighbors feature. */
export async function geocodeAddress(
  env: Env,
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  for (const v of coarseVariants(query)) {
    const r = await queryNominatim(env, v);
    if (r) return r;
  }
  return null;
}

/**
 * Geocode one address contact item and persist the result. Intended to run in
 * `ctx.waitUntil(...)` after the write responds, so the mutation stays fast.
 * Sets geocode_status to 'done' (with coords) or 'failed'.
 */
export async function geocodeContact(env: Env, contactId: string, query: string): Promise<void> {
  try {
    const r = await geocodeAddress(env, query);
    if (r) {
      await env.DB.prepare(
        "UPDATE contact_item SET geo_lat = ?, geo_lng = ?, geocode_status = 'done', updated_at = ? WHERE id = ?",
      )
        .bind(r.lat, r.lng, nowIso(), contactId)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE contact_item SET geocode_status = 'failed', updated_at = ? WHERE id = ?",
      )
        .bind(nowIso(), contactId)
        .run();
    }
  } catch (err) {
    console.error("[geocode] failed", contactId, err);
    await env.DB.prepare("UPDATE contact_item SET geocode_status = 'failed' WHERE id = ?")
      .bind(contactId)
      .run()
      .catch(() => {});
  }
}

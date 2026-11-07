// Printful API v1 client.
//
// Transport only, in the same spirit as lib/email.ts and lib/slack.ts: this file
// knows how to talk to Printful and nothing about what the store is allowed to
// tell it. Deciding what crosses that boundary is lib/storeOrder.ts's job
// (`printfulOrderPayload`), and the split is deliberate — a transport that was
// never handed a Person cannot leak one.
//
// v1 rather than v2: as of this writing v2 is still open beta with no announced
// v1 sunset, and every endpoint this store needs (sync products, shipping rates,
// order creation) is stable in v1. Revisit when v2 is GA, not before.
//
// Conventions borrowed from lib/geocode.ts and lib/calendar.ts: a plain `fetch`,
// never an SDK; an explicit timeout so a hung vendor can't hold a request open;
// a descriptive User-Agent; and an absent API key means the feature is off and
// the call is logged instead of made, exactly as the unconfigured mail channel
// logs mail. That last one is what makes the whole store runnable in local dev.
//
// Nothing here throws. Every call returns a discriminated result and the caller
// decides what a failure means — which matters because "Printful said no" is a
// recoverable, retryable state for an order that has already been paid for, not
// an exception to unwind.

import type { Env } from "../env.js";

const PRINTFUL_BASE = "https://api.printful.com";
const UA = "EisenhowerSchoolStore/1.0 (+https://store.eisenhower.school)";

/** Printful publishes 120 requests/minute. Nothing here batches hard enough to
 *  approach that, but a hung call must not hold a Worker request open. */
const TIMEOUT_MS = 15_000;

export type PrintfulResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** One buyable variant as Printful describes it, reduced to what we cache.
 *
 *  Two Printful ids, not one, and both are needed: `syncVariantId` identifies
 *  OUR store's variant and is what `POST /orders` takes, while `catalogVariantId`
 *  identifies the blank garment and is what `POST /shipping/rates` takes. Neither
 *  ever reaches a browser — see PublicStoreVariantDTO. */
export interface PrintfulVariant {
  syncVariantId: string;
  catalogVariantId: string;
  /** "Navy / L" — the product name prefix stripped off (see `variantLabel`). */
  label: string;
  imageUrl: string | null;
  inStock: boolean;
  /** Printful's own retail price, used only as the default at import. The
   *  admin's edit is authoritative from then on. */
  suggestedPriceCents: number;
}

export interface PrintfulSyncProduct {
  syncProductId: string;
  name: string;
  thumbnailUrl: string | null;
  variants: PrintfulVariant[];
}

export interface PrintfulSyncProductSummary {
  syncProductId: string;
  name: string;
  thumbnailUrl: string | null;
  variantCount: number;
}

export interface PrintfulRate {
  id: string;
  label: string;
  amountCents: number;
  deliveryEstimate: string | null;
}

/** Exactly what Printful is told in order to print and ship a parcel.
 *
 *  The type is the boundary (invariant 26). There is no field here shaped like
 *  a Person id, a User id, a Stripe id or a free-form `detail` bag, so a future
 *  edit that wanted to "helpfully" attach a buyer's directory profile would have
 *  nowhere to put it — the same defence invariant 22 gets from a Slack
 *  formatter's input type having no `detail` field at all. */
export interface PrintfulOrderRequest {
  /** Our store_order ULID. Printful echoes it back and dedupes retried creates
   *  on it, which is the belt to the claim-lock's braces. */
  externalId: string;
  /** Printful's own shipping rate id, exactly as quoted — never re-derived. */
  shippingRateId: string;
  recipient: {
    name: string;
    address1: string;
    address2: string | null;
    city: string;
    stateCode: string;
    countryCode: string;
    zip: string;
    email: string;
    phone: string | null;
  };
  items: { syncVariantId: string; quantity: number }[];
}

function configured(env: Env): boolean {
  return Boolean(env.PRINTFUL_API_KEY);
}

async function call<T>(
  env: Env,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<PrintfulResult<T>> {
  if (!configured(env)) {
    // Local/dev fallback, mirroring `[email:dev]`. The store is fully clickable
    // without a Printful account; only the calls are stubbed.
    console.log(`[printful:dev] ${init?.method ?? "GET"} ${path} ${init?.body ? JSON.stringify(init.body) : ""}`);
    return { ok: false, error: "printful_not_configured" };
  }
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      "User-Agent": UA,
    };
    if (env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = env.PRINTFUL_STORE_ID;
    if (init?.body) headers["Content-Type"] = "application/json";

    const res = await fetch(`${PRINTFUL_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      // Printful puts a human-readable reason in `result` on errors; it is the
      // most useful thing to show an admin on a stuck order.
      let reason = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
        if (typeof parsed.result === "string") reason = parsed.result;
        else if (parsed.error?.message) reason = parsed.error.message;
      } catch {
        /* keep the raw body */
      }
      console.error(`[printful] ${res.status} ${path}: ${reason}`);
      return { ok: false, error: `${res.status}: ${reason}`.slice(0, 300) };
    }
    const parsed = JSON.parse(text) as { result: T };
    return { ok: true, value: parsed.result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[printful] ${path} failed: ${error}`);
    return { ok: false, error: error.slice(0, 300) };
  }
}

/** "24.00" → 2400. Printful sends money as a decimal string; this is the only
 *  place in the store that parses one, and everything downstream is integer
 *  cents (see migration 0022's header). */
export function priceStringToCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Printful names a sync variant "<product name> - <Colour> / <Size>". The
 *  product name is already on the card, so strip it; if the shape is anything
 *  else, show the whole thing rather than guessing. */
function variantLabel(productName: string, variantName: string): string {
  const prefix = `${productName} - `;
  if (variantName.startsWith(prefix)) return variantName.slice(prefix.length).trim() || variantName;
  return variantName;
}

interface RawSyncVariant {
  id?: number | string;
  name?: string;
  variant_id?: number | string;
  retail_price?: string;
  availability_status?: string;
  files?: { type?: string; preview_url?: string; thumbnail_url?: string }[];
  product?: { image?: string; name?: string };
}

function toVariant(productName: string, raw: RawSyncVariant): PrintfulVariant | null {
  if (raw.id === undefined || raw.variant_id === undefined) return null;
  const preview = raw.files?.find((f) => f.type === "preview");
  return {
    syncVariantId: String(raw.id),
    catalogVariantId: String(raw.variant_id),
    label: variantLabel(productName, raw.name ?? ""),
    imageUrl: preview?.preview_url ?? preview?.thumbnail_url ?? raw.product?.image ?? null,
    // Printful reports "active" | "discontinued" | "out_of_stock". Anything it
    // doesn't call active is treated as unbuyable — the safe direction, since
    // selling a discontinued shirt fails at submission after we took the money.
    inStock: (raw.availability_status ?? "active") === "active",
    suggestedPriceCents: priceStringToCents(raw.retail_price),
  };
}

/** Every design in the connected Printful store, for the admin's import screen. */
export async function listSyncProducts(env: Env): Promise<PrintfulResult<PrintfulSyncProductSummary[]>> {
  const res = await call<{ id: number | string; name?: string; thumbnail_url?: string; variants?: number }[]>(
    env,
    "/store/products",
  );
  if (!res.ok) return res;
  return {
    ok: true,
    value: res.value.map((p) => ({
      syncProductId: String(p.id),
      name: p.name ?? "Untitled",
      thumbnailUrl: p.thumbnail_url ?? null,
      variantCount: typeof p.variants === "number" ? p.variants : 0,
    })),
  };
}

/** One design with its full variant list — what an import and every re-sync read. */
export async function getSyncProduct(
  env: Env,
  syncProductId: string,
): Promise<PrintfulResult<PrintfulSyncProduct>> {
  const res = await call<{
    sync_product?: { id?: number | string; name?: string; thumbnail_url?: string };
    sync_variants?: RawSyncVariant[];
  }>(env, `/store/products/${encodeURIComponent(syncProductId)}`);
  if (!res.ok) return res;

  const product = res.value.sync_product;
  if (!product?.id) return { ok: false, error: "printful returned no sync_product" };
  const name = product.name ?? "Untitled";
  const variants = (res.value.sync_variants ?? [])
    .map((v) => toVariant(name, v))
    .filter((v): v is PrintfulVariant => v !== null);

  return {
    ok: true,
    value: {
      syncProductId: String(product.id),
      name,
      thumbnailUrl: product.thumbnail_url ?? null,
      variants,
    },
  };
}

/** Live shipping options for a cart and a destination.
 *
 *  Items are addressed by CATALOG variant id here, not sync variant id — v1's
 *  rate endpoint prices the blank, not our design. Getting these two the wrong
 *  way round returns an empty rate list rather than an error, which is why both
 *  ids are cached on every variant. */
export async function getShippingRates(
  env: Env,
  input: {
    recipient: { address1: string; city: string; stateCode: string; countryCode: string; zip: string };
    items: { catalogVariantId: string; quantity: number }[];
  },
): Promise<PrintfulResult<PrintfulRate[]>> {
  const res = await call<
    { id?: string; name?: string; rate?: string; minDeliveryDays?: number; maxDeliveryDays?: number }[]
  >(env, "/shipping/rates", {
    method: "POST",
    body: {
      recipient: {
        address1: input.recipient.address1,
        city: input.recipient.city,
        state_code: input.recipient.stateCode,
        country_code: input.recipient.countryCode,
        zip: input.recipient.zip,
      },
      items: input.items.map((i) => ({
        variant_id: Number(i.catalogVariantId),
        quantity: i.quantity,
      })),
      currency: "USD",
    },
  });
  if (!res.ok) return res;

  return {
    ok: true,
    value: res.value
      .filter((r): r is { id: string; name?: string; rate?: string } => typeof r.id === "string")
      .map((r) => {
        const min = (r as { minDeliveryDays?: number }).minDeliveryDays;
        const max = (r as { maxDeliveryDays?: number }).maxDeliveryDays;
        return {
          id: r.id,
          label: r.name ?? r.id,
          amountCents: priceStringToCents(r.rate),
          deliveryEstimate:
            typeof min === "number" && typeof max === "number" ? `${min}–${max} business days` : null,
        };
      }),
  };
}

/** Submit a paid order for fulfilment.
 *
 *  `confirm=1` puts it straight into production: payment is already captured, so
 *  a draft awaiting a human would only delay every order and leave a queue for
 *  someone to forget. The guard against a bad import printing is the admin's own
 *  test order, not a per-order gate. */
export async function createOrder(
  env: Env,
  input: PrintfulOrderRequest,
): Promise<PrintfulResult<{ printfulOrderId: string }>> {
  const res = await call<{ id?: number | string }>(env, "/orders?confirm=1", {
    method: "POST",
    body: {
      external_id: input.externalId,
      shipping: input.shippingRateId,
      recipient: {
        name: input.recipient.name,
        address1: input.recipient.address1,
        ...(input.recipient.address2 ? { address2: input.recipient.address2 } : {}),
        city: input.recipient.city,
        state_code: input.recipient.stateCode,
        country_code: input.recipient.countryCode,
        zip: input.recipient.zip,
        email: input.recipient.email,
        ...(input.recipient.phone ? { phone: input.recipient.phone } : {}),
      },
      items: input.items.map((i) => ({
        sync_variant_id: Number(i.syncVariantId),
        quantity: i.quantity,
      })),
    },
  });
  if (!res.ok) return res;
  if (res.value.id === undefined) return { ok: false, error: "printful returned no order id" };
  return { ok: true, value: { printfulOrderId: String(res.value.id) } };
}

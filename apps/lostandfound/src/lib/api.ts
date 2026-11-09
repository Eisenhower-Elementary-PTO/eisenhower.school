// Thin fetch client, the same shape as every sibling app's. Points at the SAME
// API Worker: the session cookie is host-only to that Worker and every SPA lives
// on an eisenhower.school subdomain, so credentialed requests carry it with no
// cross-domain cookie tricks. The API must list this origin in ALLOWED_ORIGINS.
//
// Two halves, like the store's client and unlike the PTO's. `/lostfound-public/*`
// needs no session at all — browsing and saying "that's mine" are open to anyone
// (invariant 33). `/lostfound/*` needs a session AND, for everything past
// SUBMITTING an item (`uploadPhoto`, plus `uploadThumb` on an item you just
// created and the server still holds), the staff roster gate, server side; a
// 403 there means "signed in, but not allowed that", which is a different
// screen from a 401.
//
// Photo uploads send the raw JPEG as the body rather than multipart, for the
// reason routes/newsletter.ts's media upload does: `image/jpeg` is not a
// CORS-safelisted content type, so the browser preflights it, and a cross-site
// form can't forge one.
import type {
  LfAccessDTO,
  LfClaimDTO,
  LfClaimInput,
  LfItemPatch,
  LfPublicItemDTO,
  LfPublicListDTO,
  LfReturnMethod,
  LfSettingsDTO,
  LfStaffItemDTO,
  LfStaffItemDetailDTO,
  Locale,
  MeDTO,
  PlatformAppKey,
  PlatformOrigins,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** Sibling apps — linked to from nav; not API bases. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";

/** Which of the platform's apps THIS bundle is, and where the others live —
 *  what `PLATFORM_APPS` in @sd/shared needs to render the switcher. This app's
 *  own entry is `""`: the switcher marks it as current rather than linking. */
export const CURRENT_APP: PlatformAppKey | null = "lostandfound";
export const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173",
  calendar: import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174",
  newsletter: import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175",
  lostandfound: "",
  pto: import.meta.env.VITE_PTO_URL ?? "http://localhost:5178",
};

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

/** The server's human-readable reason, when it sent one. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const msg = (err.body as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  if (isMutation && navigator.onLine === false) {
    throw new ApiError(0, { error: "offline" });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }) satisfies RequestInit;
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) }) satisfies RequestInit;
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) }) satisfies RequestInit;
/** A write that carries no input still sends `{}` as JSON: the API refuses
 *  any write a cross-site form could send (routes/lostFound.ts's header). */
const action = (method: "POST" | "DELETE") => ({ method, body: "{}" }) satisfies RequestInit;
const jpeg = (method: string, body: Blob) =>
  ({ method, body, headers: { "Content-Type": "image/jpeg" } }) satisfies RequestInit;

/** An item action that answers with the item as it now stands. `publish`
 *  clears the hold every new item starts under (invariant 33). */
export type LfItemAction = "hide" | "unhide" | "return" | "restore" | "retag" | "publish";

/** What the dashboard may do to a whole selection at once. The transitions
 *  minus `retag` (re-running the model is a judgement about one photo), plus
 *  delete. */
export type LfBulkAction = Exclude<LfItemAction, "retag"> | "delete";
/** Items per bulk call — the server's LF_IDS_MAX. `bulkItems` slices. */
export const LF_BULK_MAX = 50;

export interface LfBrowseQuery {
  q?: string;
  category?: string;
  color?: string;
  page?: number;
}

export const api = {
  // Auth — `returnTo` is this app's origin, so the magic link comes back here
  // rather than to the directory. The session itself is shared either way.
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", post({ email, returnTo: window.location.origin })),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),
  me: () => request<MeDTO>("/me"),
  setLocale: (locale: Locale) => request<{ ok: true }>("/me/locale", put({ locale })),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  // ── Public: no session ──
  browse: (query: LfBrowseQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, String(v));
    const qs = params.toString();
    return request<LfPublicListDTO>(`/lostfound-public/items${qs ? `?${qs}` : ""}`);
  },
  item: (id: string) => request<LfPublicItemDTO>(`/lostfound-public/items/${encodeURIComponent(id)}`),
  claim: (id: string, body: LfClaimInput) =>
    request<{ ok: true }>(`/lostfound-public/items/${encodeURIComponent(id)}/claims`, post(body)),

  // ── The staff gate ──
  access: () => request<LfAccessDTO>("/lostfound/access"),

  // ── Staff: items ──
  staffItems: (filter: { status?: "found" | "returned"; view?: "review" | "attention" | "hidden" }) => {
    const params = new URLSearchParams(filter as Record<string, string>);
    return request<{ items: LfStaffItemDTO[] }>(`/lostfound/items?${params}`);
  },
  /** Several items by id, whatever their state — up to 50 per call. */
  staffItemsByIds: (ids: string[]) =>
    request<{ items: LfStaffItemDTO[] }>(`/lostfound/items?ids=${ids.map(encodeURIComponent).join(",")}`),
  staffItem: (id: string) => request<LfStaffItemDetailDTO>(`/lostfound/items/${encodeURIComponent(id)}`),
  uploadPhoto: (photo: Blob, location: string) =>
    request<LfStaffItemDTO>(`/lostfound/items?location=${encodeURIComponent(location)}`, jpeg("POST", photo)),
  uploadThumb: (id: string, thumb: Blob) =>
    request<{ ok: true }>(`/lostfound/items/${encodeURIComponent(id)}/thumb`, jpeg("PUT", thumb)),
  /** Replace an item's full-size photo — the app sends it only to rotate one,
   *  followed by `uploadThumb` with the matching thumbnail. */
  replacePhoto: (id: string, photo: Blob) =>
    request<LfStaffItemDTO>(`/lostfound/items/${encodeURIComponent(id)}/photo`, jpeg("PUT", photo)),
  saveItem: (id: string, body: LfItemPatch) =>
    request<LfStaffItemDTO>(`/lostfound/items/${encodeURIComponent(id)}`, patch(body)),
  itemAction: (id: string, act: LfItemAction) =>
    request<LfStaffItemDTO>(`/lostfound/items/${encodeURIComponent(id)}/${act}`, action("POST")),
  deleteItem: (id: string) =>
    request<{ ok: true }>(`/lostfound/items/${encodeURIComponent(id)}`, action("DELETE")),
  /** One action across a dashboard selection, sliced to the server's per-call
   *  cap. Sequential on purpose: a failure mid-way stops rather than racing
   *  on, and the caller reloads either way. Answers how many items changed. */
  bulkItems: async (ids: string[], act: LfBulkAction) => {
    let changed = 0;
    for (let i = 0; i < ids.length; i += LF_BULK_MAX) {
      const res = await request<{ ok: true; changed: number }>(
        "/lostfound/items/bulk",
        post({ ids: ids.slice(i, i + LF_BULK_MAX), action: act }),
      );
      changed += res.changed;
    }
    return { changed };
  },
  retagFailed: () => request<{ retried: number }>("/lostfound/retag-failed", action("POST")),

  // ── Staff: claims ──
  claims: () => request<{ claims: LfClaimDTO[] }>("/lostfound/claims"),
  dismissClaim: (id: string) =>
    request<{ ok: true }>(`/lostfound/claims/${encodeURIComponent(id)}/dismiss`, action("POST")),
  /** The item went home against THIS claim. Marks the item returned and, when
   *  `notify` and the contact is an email address, mails the claimant — in the
   *  claim's own language, naming the item and never a child. `notified:
   *  false` with a `reason` means fall back to the manual links. */
  returnClaim: (id: string, method: LfReturnMethod, notify: boolean) =>
    request<{ ok: true; notified: boolean; reason?: "not_email" | "already_notified" | "send_failed" }>(
      `/lostfound/claims/${encodeURIComponent(id)}/return`,
      post({ method, notify }),
    ),

  // ── Settings (system admin) ──
  groups: () => request<{ groups: { id: string; name: string; memberCount: number }[] }>("/lostfound/groups"),
  setGroup: (groupId: string | null) => request<LfAccessDTO>("/lostfound/settings", put({ groupId })),
  settings: () => request<LfSettingsDTO>("/lostfound/settings"),
  setClaimEmails: (emails: string[]) =>
    request<LfSettingsDTO>("/lostfound/settings/claim-emails", put({ emails })),
};

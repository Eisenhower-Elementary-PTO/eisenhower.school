// Thin fetch client, the same shape as the directory and calendar apps'. Points
// at the SAME API Worker: the session cookie is host-only to that Worker and all
// three SPAs live on eisenhower.school subdomains, so credentialed requests carry
// the cookie with no cross-domain cookie tricks. The API must list this origin in
// ALLOWED_ORIGINS.
import type {
  CalendarEventDTO,
  CalendarFeedDTO,
  Locale,
  MeDTO,
  NewsletterAccessDTO,
  NewsletterAssistMode,
  NewsletterAssistResultDTO,
  NewsletterIssueDTO,
  NewsletterIssueInput,
  NewsletterIssueSummaryDTO,
  NewsletterMetricsDTO,
  NewsletterSettingsDTO,
  NewsletterSubscriberDTO,
  NewsletterSubscriberImportResultDTO,
  NewsletterSubscriptionDTO,
  PlatformAppKey,
  PlatformOrigins,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** Sibling apps — linked to from nav; not API bases. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";
export const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174";

/** Which of the platform's apps THIS bundle is, and where the others live —
 *  what `PLATFORM_APPS` in @sd/shared needs to render the switcher. Origins are
 *  build-time config like the API's; the list itself is shared so that every
 *  app shows the same four in the same order. This app's own entry is `""`:
 *  the switcher marks it as current rather than linking to it. */
export const CURRENT_APP: PlatformAppKey | null = "newsletter";
export const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173",
  calendar: import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174",
  newsletter: "",
  lostandfound: import.meta.env.VITE_LOSTFOUND_URL ?? "http://localhost:5179",
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

export const api = {
  // Auth. `returnTo` is this app's origin, so the magic link comes back here
  // rather than to the directory (the API validates it against ALLOWED_ORIGINS).
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", {
      method: "POST",
      body: JSON.stringify({ email, returnTo: window.location.origin }),
    }),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),
  me: () => request<MeDTO>("/me"),
  setLocale: (locale: Locale) =>
    request<{ ok: true }>("/me/locale", { method: "PUT", body: JSON.stringify({ locale }) }),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  // The member's own subscription preference.
  newsletterSubscription: () => request<NewsletterSubscriptionDTO>("/me/newsletter"),
  setNewsletterSubscription: (subscribed: boolean) =>
    request<NewsletterSubscriptionDTO>("/me/newsletter", {
      method: "PUT",
      body: JSON.stringify({ subscribed }),
    }),

  // Calendars available to an events block (shared with the calendar app).
  calendarFeeds: () => request<{ sources: CalendarFeedDTO[] }>("/calendar/sources"),
  /** Live event lookup for an events block being edited. */
  calendarEvents: (opts: { limit?: number; from?: string; to?: string; calendars?: string[] }) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.from) q.set("from", opts.from);
    if (opts.to) q.set("to", opts.to);
    if (opts.calendars?.length) q.set("calendars", opts.calendars.join(","));
    const qs = q.toString();
    return request<{ events: CalendarEventDTO[] }>(`/calendar/events${qs ? `?${qs}` : ""}`);
  },

  // Issues (admin).
  issues: () => request<{ issues: NewsletterIssueSummaryDTO[] }>("/newsletter/issues"),
  issue: (id: string) => request<{ issue: NewsletterIssueDTO }>(`/newsletter/issues/${id}`),
  createIssue: (body: NewsletterIssueInput) =>
    request<{ issue: NewsletterIssueDTO }>("/newsletter/issues", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateIssue: (id: string, body: Partial<NewsletterIssueInput>) =>
    request<{ issue: NewsletterIssueDTO }>(`/newsletter/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteIssue: (id: string) =>
    request<{ ok: true }>(`/newsletter/issues/${id}`, { method: "DELETE" }),
  testSend: (id: string, to: string[]) =>
    request<{ ok: true; sent: number; attempted: number }>(`/newsletter/issues/${id}/test-send`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
  sendIssue: (id: string) =>
    request<{ status: string; recipientTotal: number }>(`/newsletter/issues/${id}/send`, {
      method: "POST",
    }),
  /** Put the issue's public page up, or take it down, without mailing anyone. */
  publishIssue: (id: string) =>
    request<{ issue: NewsletterIssueDTO }>(`/newsletter/issues/${id}/publish`, { method: "POST" }),
  unpublishIssue: (id: string) =>
    request<{ issue: NewsletterIssueDTO }>(`/newsletter/issues/${id}/publish`, { method: "DELETE" }),
  retryIssue: (id: string) =>
    request<{ status: string }>(`/newsletter/issues/${id}/retry`, { method: "POST" }),

  /** Ask Workers AI to tighten the draft or make editorial notes. The server
   *  reads the SAVED issue, so callers flush the autosave first, like Send.
   *  The answer is a proposal — nothing is written until the author accepts
   *  and the ordinary save carries it. `reduce` (percent of the draft's prose
   *  to cut, succinct mode only) turns the tighten pass into a shrink pass —
   *  the composer sends the figure its print measurement asked for
   *  (lib/printEstimate.ts), overshoot included; the server clamps it. */
  assistIssue: (id: string, mode: NewsletterAssistMode, opts?: { reduce?: number }) =>
    request<{ result: NewsletterAssistResultDTO }>(`/newsletter/issues/${id}/assist`, {
      method: "POST",
      body: JSON.stringify(opts?.reduce !== undefined ? { mode, reduce: opts.reduce } : { mode }),
    }),

  /** Events for an issue, resolved server-side — live while it is a draft, from
   *  the freeze once it has been sent. The print view reads this rather than
   *  resolving block by block in the browser: it needs ONE definite "the events
   *  are in" moment before it opens the print dialog, or the dialog can snapshot
   *  a page whose event lists are still empty. */
  issuePreviewEvents: (id: string) =>
    request<{ eventsSnapshot: Record<string, CalendarEventDTO[]> }>(
      `/newsletter/issues/${id}/preview`,
    ),

  /** Mint the review link, or replace the one that's live. The URL comes back
   *  ONCE — only its hash is stored — so whatever calls this is the only chance
   *  to show it. Calling again invalidates the previous link. */
  createPreviewLink: (id: string) =>
    request<{ url: string; createdAt: string }>(`/newsletter/issues/${id}/preview-link`, {
      method: "POST",
    }),
  revokePreviewLink: (id: string) =>
    request<{ ok: true }>(`/newsletter/issues/${id}/preview-link`, { method: "DELETE" }),

  // ── The gate ── may this member author? Resolved server-side; see lib/access.tsx.
  access: () => request<NewsletterAccessDTO>("/newsletter/access"),
  metrics: () => request<{ metrics: NewsletterMetricsDTO }>("/newsletter/metrics"),

  // Who may author (system admin). The picker lists generic groups only.
  editorGroups: () =>
    request<{ groups: { id: string; name: string; memberCount: number }[] }>("/newsletter/groups"),
  setEditorGroup: (groupId: string | null) =>
    request<NewsletterAccessDTO>("/newsletter/editors", {
      method: "PUT",
      body: JSON.stringify({ groupId }),
    }),

  // Settings (read: editors; write: admin) + subscribers (admin). The read also
  // says whether the AI assist is available, so the composer can hide the
  // buttons on an instance with no Workers AI binding.
  settings: () =>
    request<{ settings: NewsletterSettingsDTO; aiAssist?: boolean }>("/newsletter/settings"),
  saveSettings: (body: NewsletterSettingsDTO) =>
    request<{ settings: NewsletterSettingsDTO }>("/newsletter/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  subscribers: () =>
    request<{ subscribers: NewsletterSubscriberDTO[]; audienceTotal: number }>(
      "/newsletter/subscribers",
    ),
  addSubscriber: (email: string) =>
    request<{ subscriber: NewsletterSubscriberDTO }>("/newsletter/subscribers", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  importSubscribers: (text: string) =>
    request<{ result: NewsletterSubscriberImportResultDTO }>("/newsletter/subscribers/import", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  removeSubscriber: (id: string) =>
    request<{ ok: true }>(`/newsletter/subscribers/${id}`, { method: "DELETE" }),

  /** Raw image upload — the body is the file itself, so Content-Type identifies
   *  the format rather than describing JSON. */
  uploadMedia: (file: File) =>
    request<{ url: string }>("/newsletter/media", {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type },
    }),

  // Public (no auth) — the unsubscribe confirmation screen. The archive itself
  // is server-rendered by Pages Functions, so nothing here fetches it.
  unsubscribeTarget: (token: string) =>
    request<{ email: string }>(`/newsletter-public/unsubscribe/${token}`),
  unsubscribe: (token: string) =>
    request<{ ok: true; email: string }>(`/newsletter-public/unsubscribe/${token}`, {
      method: "POST",
    }),
};

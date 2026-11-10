// Thin fetch client, same shape as the directory app's. Points at the SAME API
// Worker: the session cookie is host-only to that Worker and both SPAs live on
// eisenhower.school subdomains, so credentialed requests carry the cookie with no
// cross-domain cookie tricks. The API must list this origin in ALLOWED_ORIGINS.
import type {
  CalendarEventDTO,
  EventAlbumDTO,
  PublicCalendarEventDTO,
  PublicCalendarFeedDTO,
  CalendarSourceDTO,
  CalendarSourceInput,
  Locale,
  ManagedCalendarDTO,
  ManagedCalendarInput,
  ManagedCalendarRemovalImpactDTO,
  ManagedEventDTO,
  ManagedEventInput,
  ManagedOccurrenceDTO,
  MeDTO,
  PublicVolunteerSheetDTO,
  VolunteerEmailsDTO,
  VolunteerPositionInput,
  VolunteerSheetDTO,
  VolunteerSheetInput,
  PlatformAppKey,
  PlatformOrigins,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** The directory app — linked to from nav; not an API base. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";
/** The newsletter app — linked to from nav; not an API base. */
export const NEWSLETTER_URL = import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175";

/** Which of the platform's apps THIS bundle is, and where the others live —
 *  what `PLATFORM_APPS` in @sd/shared needs to render the switcher. Origins are
 *  build-time config like the API's; the list itself is shared so that every
 *  app shows the same four in the same order. This app's own entry is `""`:
 *  the switcher marks it as current rather than linking to it. */
export const CURRENT_APP: PlatformAppKey | null = "calendar";
export const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173",
  calendar: "",
  newsletter: import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175",
  lostandfound: import.meta.env.VITE_LOSTFOUND_URL ?? "http://localhost:5179",
  pto: import.meta.env.VITE_PTO_URL ?? "http://localhost:5178",
};


export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

/** The server's human-readable reason, when it sent one (managed-calendar routes
 *  return `message` on a 400 so a rejected recurrence can explain itself). */
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
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** What a managed-event save did to the volunteer sheets hanging off it. */
export interface EventSaved {
  event: ManagedEventDTO;
  sheetsMoved: number;
  signupsMoved: number;
  sheetsStranded: number;
}

/** The one sentence every edit surface says about it, or null when an edit
 *  touched no sheets. One function because there are two editors — the calendar
 *  admin's list and the event page's own form — and a report that existed on
 *  only one of them would make "it is not silent" true of the surface nobody
 *  uses. Admin chrome is English-only here, like the rest of it. */
export function eventSavedNote(r: EventSaved): string | null {
  const moved =
    r.sheetsMoved > 0
      ? `${r.sheetsMoved === 1 ? "The volunteer sheet" : `All ${r.sheetsMoved} volunteer sheets`}` +
        `${r.signupsMoved > 0 ? `, with ${r.signupsMoved} sign-up${r.signupsMoved === 1 ? "" : "s"},` : ""}` +
        ` moved to the new date. Nobody was told — use "Email volunteers" on the sheet to say so.`
      : "";
  const stranded =
    r.sheetsStranded > 0
      ? `${r.sheetsStranded === 1 ? "A volunteer sheet is" : `${r.sheetsStranded} volunteer sheets are`}` +
        ` on a date this event no longer has, so nothing links to ${r.sheetsStranded === 1 ? "it" : "them"}.` +
        ` Open Volunteers to see what is there.`
      : "";
  return [moved, stranded].filter(Boolean).join(" ") || null;
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

  // Agenda reads — imported feeds and managed calendars, unioned.
  //
  // Deliberately the /calendar-public/* routes, not the session-gated
  // /calendar/* ones: this app's home screen renders for anonymous visitors, so
  // these two calls must succeed with no cookie. They return
  // PublicCalendarEventDTO, which omits seriesId/recurrenceId. That narrower type
  // is what keeps the agenda honest about what an anonymous reader is entitled
  // to; the one place this app wants seriesId — an admin's edit affordance — asks
  // the members-only route below for it rather than widening this response.
  calendarEvents: (opts: { limit?: number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.from) q.set("from", opts.from);
    const qs = q.toString();
    return request<{ events: PublicCalendarEventDTO[] }>(
      `/calendar-public/events${qs ? `?${qs}` : ""}`,
    );
  },
  calendarFeeds: () => request<{ sources: PublicCalendarFeedDTO[] }>("/calendar-public/sources"),

  /** ONE event, by the content identity that IS its page URL (/e/:date/:slug).
   *  Public for the same reason the agenda is: an event page has to open from a
   *  text message with no account. Returns the narrowed shape — the member
   *  counterpart below is the only way to `seriesId`. */
  calendarEvent: (date: string, slug: string) =>
    request<{ event: PublicCalendarEventDTO }>(
      `/calendar-public/events/${encodeURIComponent(date)}/${encodeURIComponent(slug)}`,
    ),

  /** The single-event read through the members-only route. Same event, plus
   *  `seriesId` — the durable handle on a managed occurrence's authored series
   *  (invariant 8), and the only way the event page can offer an admin an edit
   *  form. Asked for ONLY once the session resolves to a system admin, and never
   *  as the first read: the page renders from `calendarEvent` above so an
   *  anonymous visitor is not made to wait on /me. The narrowing in
   *  `publicEventOf` is what keeps seriesId off the anonymous wire, and that
   *  stays true — this is a different route with its own auth. */
  memberCalendarEvent: (date: string, slug: string) =>
    request<{ event: CalendarEventDTO }>(
      `/calendar/events/${encodeURIComponent(date)}/${encodeURIComponent(slug)}`,
    ),

  /** The event's photo album, members only (the link is a capability — it is a
   *  route of its own so it can't ride an agenda/newsletter DTO). */
  eventAlbum: (date: string, slug: string) =>
    request<{ albumUrl: string | null }>(
      `/calendar/events/${encodeURIComponent(date)}/${encodeURIComponent(slug)}/album`,
    ),
  eventAlbums: () => request<{ albums: EventAlbumDTO[] }>("/calendar/albums"),
  /** Admin: set (or, with an empty url, clear) one occurrence's album link. */
  setEventAlbum: (seriesId: string, occurrenceStart: string, url: string) =>
    request<{ ok: true; changed: boolean }>(`/admin/managed-events/${seriesId}/album`, {
      method: "PUT",
      body: JSON.stringify({ occurrenceStart, url }),
    }),

  // Imported ICS sources (admin).
  calendarSources: () => request<{ sources: CalendarSourceDTO[] }>("/admin/calendar-sources"),
  addCalendarSource: (body: CalendarSourceInput) =>
    request<{ source: CalendarSourceDTO }>("/admin/calendar-sources", { method: "POST", body: JSON.stringify(body) }),
  updateCalendarSource: (id: string, body: Partial<CalendarSourceInput>) =>
    request<{ source: CalendarSourceDTO }>(`/admin/calendar-sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCalendarSource: (id: string) =>
    request<{ ok: true }>(`/admin/calendar-sources/${id}`, { method: "DELETE" }),
  refreshCalendar: () =>
    request<{ ok: true; sources: number; events: number }>("/admin/calendar-sources/refresh", { method: "POST" }),

  // Managed calendars (admin).
  managedCalendars: () => request<{ calendars: ManagedCalendarDTO[] }>("/admin/managed-calendars"),
  managedCalendar: (id: string) =>
    request<{ calendar: ManagedCalendarDTO }>(`/admin/managed-calendars/${id}`),
  addManagedCalendar: (body: ManagedCalendarInput) =>
    request<{ calendar: ManagedCalendarDTO }>("/admin/managed-calendars", { method: "POST", body: JSON.stringify(body) }),
  updateManagedCalendar: (id: string, body: Partial<ManagedCalendarInput>) =>
    request<{ calendar: ManagedCalendarDTO }>(`/admin/managed-calendars/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  /** What deleting a calendar would take with it. Read when the confirmation
   *  opens, not with the list — see the route's own note. */
  managedCalendarRemovalImpact: (id: string) =>
    request<{ impact: ManagedCalendarRemovalImpactDTO }>(`/admin/managed-calendars/${id}/removal-impact`),
  deleteManagedCalendar: (id: string) =>
    request<{ ok: true }>(`/admin/managed-calendars/${id}`, { method: "DELETE" }),

  // Managed events (admin).
  /** One authored series by its durable id — what the agenda's event modal has
   *  (as `seriesId`) when it opens an editor away from the calendar's own page. */
  managedEvent: (eventId: string) =>
    request<{ event: ManagedEventDTO }>(`/admin/managed-events/${eventId}`),
  managedEvents: (calendarId: string) =>
    request<{ events: ManagedEventDTO[] }>(`/admin/managed-calendars/${calendarId}/events`),
  addManagedEvent: (calendarId: string, body: ManagedEventInput) =>
    request<{ event: ManagedEventDTO }>(`/admin/managed-calendars/${calendarId}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Moving an event carries its volunteer sheets onto the new date, and the
   *  people already signed up go with them. The counts come back so every
   *  editor can say so — an admin nudging a date is not thinking about eighteen
   *  families, and they should not have to. `sheetsStranded` is the same
   *  obligation pointing the other way: an edit that took a date away left a
   *  sheet's sign-ups somewhere nothing links to. */
  updateManagedEvent: (eventId: string, body: Partial<ManagedEventInput>) =>
    request<EventSaved>(`/admin/managed-events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteManagedEvent: (eventId: string) =>
    request<{ ok: true }>(`/admin/managed-events/${eventId}`, { method: "DELETE" }),

  // Volunteer sheets — reads.
  //
  // TWO endpoints for one screen, deliberately. `publicVolunteerSheet` returns
  // counts and no names and needs no cookie; `volunteerSheet` returns the roster
  // and requires one. The screen picks by whether there's a session, so an
  // anonymous reader never issues a request that would 401, and a member never
  // renders a page missing the names they're entitled to. The narrower
  // PublicVolunteerSheetDTO is what keeps the signed-out branch honest.
  publicVolunteerSheet: (slug: string) =>
    request<{ sheet: PublicVolunteerSheetDTO }>(`/volunteers-public/sheets/${slug}`),
  volunteerSheet: (slug: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/sheets/${slug}`),

  // Volunteer sheets — member writes. Both return the refreshed sheet, so the
  // screen never has to guess what the server decided about counts.
  claimVolunteerSpot: (positionId: string, personId: string, note: string | null) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/positions/${positionId}/signups`, {
      method: "POST",
      body: JSON.stringify({ personId, note }),
    }),
  releaseVolunteerSpot: (signupId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/signups/${signupId}`, { method: "DELETE" }),
  /** A signup as a `.ics` file. A URL rather than a fetch: it is opened as a
   *  plain link, so the browser (and on a phone, the OS) hands the file to the
   *  calendar app. The session cookie rides a top-level navigation to the API
   *  just as it rides a credentialed fetch. */
  volunteerSignupIcsUrl: (signupId: string, locale: string) =>
    `${API_BASE}/volunteers/signups/${encodeURIComponent(signupId)}/ics?lang=${encodeURIComponent(locale)}`,

  // Volunteer sheets — authoring (admin).
  eventOccurrences: (eventId: string) =>
    request<{ occurrences: ManagedOccurrenceDTO[] }>(`/admin/managed-events/${eventId}/occurrences`),
  adminVolunteerSheet: (sheetId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}`),
  // Read on the click, not with the sheet: a roster of addresses is the one
  // thing on this screen worth fetching only when it is about to be used.
  volunteerSheetEmails: (sheetId: string) =>
    request<VolunteerEmailsDTO>(`/admin/volunteer-sheets/${sheetId}/emails`),
  // Proof the two-evenings-before reminder email: sends it (runbook link and
  // all) to the admin's own address, never the volunteers'. Body may carry
  // { to: string[] } to proof to someone else instead.
  testVolunteerReminder: (sheetId: string) =>
    request<{ ok: boolean; sent: number; attempted: number }>(
      `/admin/volunteer-sheets/${sheetId}/test-reminder`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  addVolunteerSheet: (eventId: string, body: VolunteerSheetInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/managed-events/${eventId}/sheets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVolunteerSheet: (sheetId: string, body: VolunteerSheetInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  /** Move an ORPHANED sheet onto a date its event actually has, carrying its
   *  positions' shift windows and everyone already signed up. Its own route
   *  rather than a field on the PATCH above, because re-dating a sheet is not
   *  an ordinary edit — see `moveSheet` in the API. */
  moveVolunteerSheet: (sheetId: string, occurrenceStart: string) =>
    request<{ sheet: VolunteerSheetDTO; moved: boolean }>(
      `/admin/volunteer-sheets/${sheetId}/occurrence`,
      { method: "POST", body: JSON.stringify({ occurrenceStart }) },
    ),
  deleteVolunteerSheet: (sheetId: string) =>
    request<{ ok: true }>(`/admin/volunteer-sheets/${sheetId}`, { method: "DELETE" }),
  addVolunteerPosition: (sheetId: string, body: VolunteerPositionInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}/positions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVolunteerPosition: (positionId: string, body: Partial<VolunteerPositionInput>) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-positions/${positionId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVolunteerPosition: (positionId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-positions/${positionId}`, {
      method: "DELETE",
    }),
};

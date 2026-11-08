// Thin fetch client. Always sends credentials so the session cookie rides along.
import type {
  AdminUserDTO,
  UserDeletionImpactDTO,
  AuditActionCountDTO,
  AuditEntryDTO,
  BackupDocument,
  BulkImportOptions,
  BulkImportResult,
  BulkImportRow,
  CalendarEventDTO,
  Capability,
  ContactItemInput,
  PersonSummaryDTO,
  CreatePersonBody,
  CreateShareBody,
  GroupDetailDTO,
  GroupKind,
  GroupRefDTO,
  GroupSummaryDTO,
  MeDTO,
  AccessClaimStatusDTO,
  AccessRequestDTO,
  DirectoryAccessState,
  MyHouseholdDTO,
  NeighborsResponse,
  NewUserNotify,
  NotificationSettingsDTO,
  PublicNewsletterArchiveDTO,
  PersonPatchBody,
  PersonProfileDTO,
  PersonRemovalImpactDTO,
  RestoreReportDTO,
  ShareGranteeDTO,
  ShareTargetDTO,
  SuiteMetricsDTO,
  PlatformAppKey,
  PlatformOrigins,
} from "@sd/shared";
import { RESTORE_CONFIRM } from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** The calendar app's origin. The calendar moved to its own site, so nav and the
 *  Home events block link out here rather than to an in-app route. */
export const CALENDAR_APP_URL = import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174";
/** The newsletter app's origin. Its archive pages are public, so the Home card
 *  links straight to an issue rather than through a members-only route. */
export const NEWSLETTER_APP_URL = import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175";

/** Which of the platform's apps THIS bundle is, and where the others live —
 *  what `PLATFORM_APPS` in @sd/shared needs to render the switcher. Origins are
 *  build-time config like the API's; the list itself is shared so that every
 *  app shows the same four in the same order. This app's own entry is `""`:
 *  the switcher marks it as current rather than linking to it. */
export const CURRENT_APP: PlatformAppKey | null = "directory";
export const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: "",
  calendar: import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174",
  newsletter: import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175",
  lostandfound: import.meta.env.VITE_LOSTFOUND_URL ?? "http://localhost:5179",
  pto: import.meta.env.VITE_PTO_URL ?? "http://localhost:5178",
};


/** Resolve an API-relative media path (e.g. "/photos/abc.jpg") to an absolute URL. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  // Fail writes fast while offline; reads still go through (the SW serves cache).
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

export const api = {
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", { method: "POST", body: JSON.stringify({ email }) }),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),

  me: () => request<MeDTO>("/me"),
  createPerson: (body: CreatePersonBody) =>
    request<{ id: string; activated: boolean }>("/me/persons", { method: "POST", body: JSON.stringify(body) }),
  myHouseholds: () =>
    request<{ households: MyHouseholdDTO[] }>("/me/households"),
  setActivePerson: (personId: string) =>
    request<{ ok: true; activePersonId: string }>("/me/active-person", {
      method: "POST",
      body: JSON.stringify({ personId }),
    }),
  setLocale: (locale: string) =>
    request<{ ok: true }>("/me/locale", { method: "PUT", body: JSON.stringify({ locale }) }),

  /** `asMember` renders a profile you control the way everyone else sees it. */
  person: (id: string, opts?: { asMember?: boolean }) =>
    request<PersonProfileDTO>(`/persons/${id}${opts?.asMember ? "?as=member" : ""}`),
  patchPerson: (id: string, body: PersonPatchBody) =>
    request<PersonProfileDTO>(`/persons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  uploadPhoto: async (personId: string, file: File): Promise<{ photoUrl: string }> => {
    if (navigator.onLine === false) throw new ApiError(0, { error: "offline" });
    const res = await fetch(`${API_BASE}/persons/${personId}/photo`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError(res.status, body);
    return body as { photoUrl: string };
  },

  addContact: (personId: string, body: ContactItemInput) =>
    request<{ id: string }>(`/persons/${personId}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  patchContact: (id: string, body: Partial<ContactItemInput>) =>
    request<{ ok: true }>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteContact: (id: string) => request<{ ok: true }>(`/contacts/${id}`, { method: "DELETE" }),

  /** `householdId` widens the invitation from "co-manage this Person" to "you
   *  are the other parent here" — see the route's own comment. Passed only by
   *  the welcome wizard's partner form, which is the one place that means it. */
  inviteController: (personId: string, email: string, householdId?: string | null) =>
    request<{ ok: true; inviteId: string }>(`/persons/${personId}/controllers`, {
      method: "POST",
      body: JSON.stringify({ email, householdId: householdId ?? null }),
    }),

  personRemovalImpact: (personId: string) =>
    request<PersonRemovalImpactDTO>(`/persons/${personId}/removal-impact`),
  deletePerson: (personId: string) =>
    request<{ ok: true; emptiedHouseholds: number }>(`/persons/${personId}`, { method: "DELETE" }),

  neighbors: () => request<NeighborsResponse>("/home/neighbors"),

  /** `capabilities` narrows the listing to Persons holding ANY of them; an empty
   *  array is "no filter" and sends no param. */
  directory: (q: string, offset = 0, capabilities: Capability[] = []) =>
    request<{ people: PersonSummaryDTO[]; total: number; offset: number; pageSize: number }>(
      `/directory?q=${encodeURIComponent(q)}&offset=${offset}` +
        capabilities.map((c) => `&capability=${encodeURIComponent(c)}`).join(""),
    ),

  group: (id: string) => request<GroupDetailDTO>(`/groups/${id}`),
  /** `kinds` narrows the listing to groups of ANY of them; an empty array is
   *  "no filter" and sends no param, like `directory`'s capabilities. */
  searchGroups: (q: string, kinds: GroupKind[] = []) =>
    request<{ groups: GroupSummaryDTO[] }>(
      `/groups?q=${encodeURIComponent(q)}` + kinds.map((k) => `&kind=${encodeURIComponent(k)}`).join(""),
    ),
  createGroup: (body: { kind: GroupKind; name: string; parentId?: string }) =>
    request<{ id: string }>("/groups", { method: "POST", body: JSON.stringify(body) }),
  /** Rename and/or re-type a group; send only what changed. */
  updateGroup: (groupId: string, patch: { name?: string; kind?: GroupKind }) =>
    request<{ id: string; name: string; kind: GroupKind }>(`/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteGroup: (groupId: string) =>
    request<{ ok: true }>(`/groups/${groupId}`, { method: "DELETE" }),
  setGroupParent: (groupId: string, parentId: string | null) =>
    request<{ ok: true }>(`/groups/${groupId}/parent`, { method: "PATCH", body: JSON.stringify({ parentId }) }),
  groupParentCandidates: (groupId: string, q: string) =>
    request<{ candidates: GroupRefDTO[] }>(`/groups/${groupId}/parent-candidates?q=${encodeURIComponent(q)}`),
  groupCandidates: (groupId: string, q: string) =>
    request<{ targets: ShareTargetDTO[] }>(`/groups/${groupId}/candidates?q=${encodeURIComponent(q)}`),
  addGroupMember: (groupId: string, body: { personId: string; title?: string }) =>
    request<{ ok: true }>(`/groups/${groupId}/members`, { method: "POST", body: JSON.stringify(body) }),
  updateGroupMember: (groupId: string, personId: string, body: { title?: string | null; isAdmin?: boolean }) =>
    request<{ ok: true }>(`/groups/${groupId}/members/${personId}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeGroupMember: (groupId: string, personId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/members/${personId}`, { method: "DELETE" }),
  /** Place one of your OWN children in a classroom, moving them out of any other
   *  — a Person sits in one room at a time. Keyed on the person, not the group,
   *  because that is where the authority is (isController) and where the
   *  single-valued rule lives; the classroom screen just happens to be where you
   *  press it. */
  setClassroom: (personId: string, groupId: string) =>
    request<{ ok: true; moved: boolean }>(`/persons/${personId}/classroom`, {
      method: "PUT",
      body: JSON.stringify({ groupId }),
    }),
  /** Remove them from ONE room. The group is named rather than implied: a child
   *  can hold more than one classroom membership (bulk import creates classrooms
   *  by default), and "remove from this class" must not take the others. */
  clearClassroom: (personId: string, groupId: string) =>
    request<{ ok: true }>(`/persons/${personId}/classroom?groupId=${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    }),
  addGroupContact: (groupId: string, body: ContactItemInput) =>
    request<{ id: string }>(`/groups/${groupId}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  patchGroupContact: (groupId: string, contactId: string, body: Partial<ContactItemInput>) =>
    request<{ ok: true }>(`/groups/${groupId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteGroupContact: (groupId: string, contactId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/contacts/${contactId}`, { method: "DELETE" }),

  listShares: (subjectKind: string, subjectRef: string) =>
    request<{ grantees: ShareGranteeDTO[] }>(
      `/shares?subjectKind=${encodeURIComponent(subjectKind)}&subjectRef=${encodeURIComponent(subjectRef)}`,
    ),
  createShare: (body: CreateShareBody) =>
    request<{ ok: true }>("/shares", { method: "POST", body: JSON.stringify(body) }),
  deleteShare: (id: string) => request<{ ok: true }>(`/shares/${id}`, { method: "DELETE" }),
  shareTargets: (q: string) =>
    request<{ targets: ShareTargetDTO[] }>(`/shares/targets?q=${encodeURIComponent(q)}`),

  adminUsers: () => request<{ users: AdminUserDTO[] }>("/admin/users"),
  createUser: (body: { email: string; isSystemAdmin?: boolean; sendEmail?: boolean }) =>
    request<{ user: AdminUserDTO }>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  /** Take an account out of use, or put it back. Reversible, and it touches
   *  only the `user` row — their people and groups are left alone. */
  setUserDisabled: (userId: string, disabled: boolean) =>
    request<{ ok: true; disabled: boolean; disabledAt: string | null }>(
      `/admin/users/${userId}/disabled`,
      { method: "POST", body: JSON.stringify({ disabled }) },
    ),
  /** Take a Person off the roster, or put them back. System admins only, and
   *  the flag lives on the PERSON — unlike setUserDisabled, which is about an
   *  account's own access. Reversible; nothing else about them changes. */
  setPersonUnlisted: (personId: string, unlisted: boolean) =>
    request<{ ok: true; unlisted: boolean }>(
      `/persons/${personId}/unlisted`,
      { method: "POST", body: JSON.stringify({ unlisted }) },
    ),
  // ── Directory access (migration 0029, invariant 32) ──────────────────────
  /** The rooms the application form offers. Its own route because GET /groups
   *  is gated and a pending account still has to name a classroom. */
  classroomOptions: () =>
    request<{ classrooms: { id: string; name: string }[] }>("/me/classroom-options"),
  /** Ask to read the directory. The claim is the Person rows already entered,
   *  so this body carries only the optional free-text line; the server
   *  re-derives completeness rather than trusting the button being enabled. */
  requestDirectoryAccess: (note?: string) =>
    request<{ directoryAccess: DirectoryAccessState; accessClaim?: AccessClaimStatusDTO }>(
      "/me/access-request",
      { method: "POST", body: JSON.stringify({ note: note ?? null }) },
    ),
  /** The review queue. `pending` is the work, `decided` the record, and `never`
   *  the accounts that signed up and entered nobody. */
  accessRequests: (state: "pending" | "decided" | "never" = "pending") =>
    request<{ requests: AccessRequestDTO[] }>(`/admin/access-requests?state=${state}`),
  /** Approve or decline. Approving also promotes the applicant's classroom
   *  placements to trusted, which is why the response reports a count. */
  decideAccess: (userId: string, approve: boolean) =>
    request<{ ok: true; state: DirectoryAccessState; promoted: number }>(
      `/admin/access-requests/${userId}`,
      { method: "POST", body: JSON.stringify({ approve }) },
    ),
  /** Dry run: what a permanent delete would remove. Writes nothing. */
  userDeletionImpact: (userId: string) =>
    request<UserDeletionImpactDTO>(`/admin/users/${userId}/impact`),
  /** Permanently delete a (disabled) account and execute its impact report.
   *  Irreversible. The server refuses unless the account is already disabled. */
  deleteUser: (userId: string) =>
    request<{ ok: true }>(`/admin/users/${userId}`, { method: "DELETE" }),
  setUserAdmin: (userId: string, isSystemAdmin: boolean) =>
    request<{ user: AdminUserDTO }>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isSystemAdmin }),
    }),
  startMasquerade: (userId: string) =>
    request<{ ok: true }>("/admin/masquerade", { method: "POST", body: JSON.stringify({ userId }) }),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),
  auditLog: (opts: { action?: string; q?: string; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.action) q.set("action", opts.action);
    if (opts.q) q.set("q", opts.q);
    if (opts.before) q.set("before", opts.before);
    const qs = q.toString();
    return request<{ entries: AuditEntryDTO[]; nextBefore: string | null }>(`/admin/audit${qs ? `?${qs}` : ""}`);
  },
  auditActions: () => request<{ actions: AuditActionCountDTO[] }>("/admin/audit/actions"),
  /** Counts across every app in the suite — numbers only, never identities. */
  suiteMetrics: () => request<{ metrics: SuiteMetricsDTO }>("/admin/metrics"),
  bulkImport: (rows: BulkImportRow[], dryRun: boolean, options: BulkImportOptions & { sendInvites?: boolean }) =>
    request<BulkImportResult>("/admin/bulk-import", { method: "POST", body: JSON.stringify({ rows, dryRun, ...options }) }),

  /** Download the whole database as one JSON file.
   *
   *  Fetched rather than linked. A plain <a href> would work — the session
   *  cookie is same-site to the API — but it gives no way to show an error, and
   *  a silent no-op on the one screen whose job is "make sure you have a copy"
   *  is the worst possible failure. This resolves to the parsed document, and
   *  the caller decides whether to save it.
   *
   *  Note what comes back: the directory itself, coordinates and private
   *  contact items included. See apps/api/src/lib/backup.ts for why a backup
   *  deliberately doesn't narrow the way every other outbound seam does. */
  downloadBackup: async (): Promise<BackupDocument> => {
    const res = await fetch(`${API_BASE}/admin/backup`, { credentials: "include" });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return (await res.json()) as BackupDocument;
  },
  /** Validate a backup file without writing anything. Always call this first —
   *  the API defaults to a dry run anyway, so an omitted flag validates rather
   *  than destroys. */
  restorePreview: (backup: unknown) =>
    request<RestoreReportDTO>("/admin/restore", {
      method: "POST",
      body: JSON.stringify({ backup, dryRun: true }),
    }),
  /** Replace the database. Irreversible; the API refuses without the confirm
   *  word, which is deliberately not something a replayed dry-run body has. */
  restoreBackup: (backup: unknown) =>
    request<RestoreReportDTO>("/admin/restore", {
      method: "POST",
      body: JSON.stringify({ backup, dryRun: false, confirm: RESTORE_CONFIRM }),
    }),
  getRegistration: () => request<{ open: boolean }>("/settings/registration"),
  setRegistration: (open: boolean) =>
    request<{ open: boolean }>("/settings/registration", { method: "PUT", body: JSON.stringify({ open }) }),
  getNotifications: () => request<NotificationSettingsDTO>("/settings/notifications"),
  setNotifications: (patch: { newUser?: NewUserNotify; accessRequest?: boolean }) =>
    request<NotificationSettingsDTO>("/settings/notifications", { method: "PUT", body: JSON.stringify(patch) }),

  // Calendar. Only the read remains here — it feeds Home's upcoming-events
  // block. Feed listing and all calendar admin moved to the calendar app.
  /** Most recent published newsletter, for the Home card. Deliberately the
   *  PUBLIC endpoint — the archive needs no session, and using the same one the
   *  archive site uses means there's no second surface to keep in step. */
  newsletterLatest: () => request<PublicNewsletterArchiveDTO>("/newsletter-public/issues?limit=1"),

  calendarEvents: (opts: { limit?: number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.from) q.set("from", opts.from);
    const qs = q.toString();
    return request<{ events: CalendarEventDTO[] }>(`/calendar/events${qs ? `?${qs}` : ""}`);
  },
};

// Domain types shared between the API (Workers) and the web client.
// These describe the *serialized* shapes that cross the wire — privacy filtering
// and geo-coordinate stripping happen on the server before anything here is sent.

export type Locale = "en" | "es" | "zh" | "so";
export const LOCALES: Locale[] = ["en", "es", "zh", "so"];

export type Capability =
  | "parent"
  | "teacher"
  | "staff"
  | "student"
  | "household_admin";

/** All capability codes (mirrors the `capability` seed table). */
export const CAPABILITIES: Capability[] = [
  "parent",
  "teacher",
  "staff",
  "student",
  "household_admin",
];

/** Capabilities a User may assign when creating a Person they manage.
 *  `household_admin` is intentionally excluded — it's a household role granted
 *  through group membership, not a self-assigned type. */
export const ASSIGNABLE_CAPABILITIES: Capability[] = [
  "parent",
  "student",
  "teacher",
  "staff",
];

/** The capabilities that describe WHAT a Person is — the ones shown as tags on
 *  a row, in a profile hero, under a name in the switcher, and offered as
 *  directory filter chips. `household_admin` is excluded: it is authority over
 *  a group, not a category of person, and nobody browsing a directory is asking
 *  who may edit a household. It stays a capability — the grant still gates
 *  household edits — it just isn't a badge any more. The server's directory
 *  filter refuses it for invariant 18's reason: a search may not match on more
 *  than it renders, and nothing renders it now. */
export const ROLE_CAPABILITIES: Capability[] = ["parent", "teacher", "staff", "student"];

/** A Person's capabilities as they should be DISPLAYED — see `ROLE_CAPABILITIES`. */
export function roleCapabilities(caps: Capability[]): Capability[] {
  return caps.filter((c) => ROLE_CAPABILITIES.includes(c));
}

/** Visibility level on a field or contact item. There is no "public" level. */
export type Visibility = "service" | "private";

/** How a Person's last name renders to viewers who can see it.
 *  Note: there is intentionally no "hidden" — a name is needed to disambiguate
 *  the many members who share a first name. */
export type LastNameDisplay = "full" | "initial";

export type ContactType = "address" | "phone" | "email" | "url";

export type GroupKind = "household" | "classroom" | "generic";

/** Every group kind, in the order the groups index offers them as filter chips.
 *  The counterpart to `ROLE_CAPABILITIES`: one list the client renders from and
 *  the server validates against, so a chip can never ask for a kind the route
 *  refuses. A kind is rendered as the type column on the very row a filter by it
 *  selects, so matching on it clears invariant 18's bar the way `?capability=`
 *  does — it confirms nothing the response wasn't already going to show. */
export const GROUP_KINDS: GroupKind[] = ["household", "classroom", "generic"];

// ── Wire DTOs ──────────────────────────────────────────────────────────────

/** A contact item as serialized to a client. geo_lat/geo_lng are NEVER included. */
export interface ContactItemDTO {
  id: string;
  type: ContactType;
  label: string | null;
  value: string;
  visibility: Visibility;
  /** Address-only: whether this address opts into neighbor discovery. */
  neighborDiscoverable?: boolean;
  /** Address-only: true when the address is geocoded AND the viewer may see the
   *  exact location (a controller). Drives the server-rendered map thumbnail.
   *  Coordinates themselves are never serialized. */
  hasLocation?: boolean;
  /** Resolved share state for the active viewer's UI chip. */
  shareCount?: number;
  /** Set when this item is cascaded from a group the Person belongs to (e.g. a
   *  household's shared address). Read-only on the Person; edited on the group. */
  viaGroup?: { id: string; name: string };
}

/** A classroom named on a directory row — the group's id and the name the
 *  school gave it, and deliberately nothing else. It is a LABEL, not a summary:
 *  `memberCount` and the viewer's role belong on `GroupSummaryDTO`, where a
 *  screen about the group can pay for them. */
export interface ClassroomRefDTO {
  id: string;
  name: string;
}

export interface PersonSummaryDTO {
  id: string;
  /** Already last-name-rule-applied for the requesting viewer (e.g. "Dana R."). */
  displayName: string;
  firstName: string;
  capabilities: Capability[];
  photoUrl: string | null;
  /** The classrooms this Person is on the roster of. Present only where a
   *  listing asked for it (the directory does; a profile answers the same
   *  question with `groups`, and a household roster is about the household), so
   *  absent and `[]` mean different things: "not looked up" and "no classroom".
   *
   *  It discloses nothing new. `GET /groups/:id` already serves every roster to
   *  any authenticated member — migration 0023's header says so in as many
   *  words — so this moves a fact the viewer could already read into the one
   *  place they are actually asking it, which is a list of children whose first
   *  names repeat. It is also the safe direction of invariant 18: the row now
   *  RENDERS more than the search matches on, where the danger is matching on
   *  more than the row renders. Adding `?classroom=` later would therefore be
   *  allowed — but it would have to be ANDed onto `personSearchSql` the way
   *  `?capability=` is, never in place of it.
   *
   *  It deliberately does NOT filter `self_asserted`. That column (migration
   *  0023, invariant 27) decides what a membership lets a viewer READ, not who
   *  is on the list; a row that hid a parent's own placement would disagree
   *  with the roster it names, and would hide it from exactly the parent who
   *  made it. */
  classrooms?: ClassroomRefDTO[];
}

export interface PersonProfileDTO extends PersonSummaryDTO {
  /** Present only when the viewer controls this Person (full editable view). */
  lastName?: string | null;
  lastNameDisplay?: LastNameDisplay;
  contacts: ContactItemDTO[];
  /** Contacts cascaded from the Person's groups (e.g. household address),
   *  privacy-filtered for the viewer. Read-only; carry `viaGroup`. */
  groupContacts?: ContactItemDTO[];
  groups: GroupSummaryDTO[];
  /** The other Persons sharing each of this Person's households — the closest
   *  thing this schema records to a family, there being no Person→Person edge
   *  anywhere in it. Deliberately NOT folded into `GroupSummaryDTO`, which is
   *  also Home's tiles, the group list and `GroupDetailDTO.children[]`: none of
   *  those want a roster riding along.
   *
   *  Households only. A classroom's roster would be 25 names of noise on a
   *  profile, and its membership is deliberately the weaker kind (invariant 27).
   *  A household with nobody else in it is omitted rather than serialized empty,
   *  so the array's presence means there is someone to show. */
  households?: HouseholdMembersDTO[];
  /** True when the requesting User is a Controller of this Person. */
  controlledByViewer: boolean;
  /** Set when the profile was built with `?as=member`: a Controller asked to see
   *  it exactly as an ordinary member does, so private items are absent. */
  previewAsMember?: boolean;
  /** Preview only — how many of this Person's own contact items members cannot
   *  see. Group-owned cascaded items are excluded; they're edited on the group. */
  hiddenFromMembers?: number;
  /** True when this Person is off the roster (migration 0018). Only ever present
   *  for a viewer who already cleared the enumeration gate — a system admin or a
   *  Controller — because nobody else is served this profile at all. */
  unlisted?: boolean;
}

/** One of a Person's households and the co-members a given viewer may see.
 *
 *  `members` is enumeration-gated (invariant 21), so it can legitimately be
 *  shorter than the household's `GroupSummaryDTO.memberCount` — that count is an
 *  unfiltered `COUNT(*)` on purpose ("numbers, never identities"). The two are
 *  never rendered beside each other: the profile drops the count for any
 *  household it can show faces for. */
export interface HouseholdMembersDTO {
  id: string;
  name: string;
  /** Never empty — a household with nobody else in it isn't serialized at all. */
  members: PersonSummaryDTO[];
}

export interface GroupSummaryDTO {
  id: string;
  kind: GroupKind;
  name: string;
  memberCount: number;
  /** Viewer's role in this group, if any. */
  isAdmin?: boolean;
  /** Parent group in the hierarchy (School → Grade → Classroom), or null. */
  parentId?: string | null;
}

/** A bare group reference for breadcrumbs / pickers. */
export interface GroupRefDTO {
  id: string;
  name: string;
  kind: GroupKind;
}

export interface GroupMemberDTO {
  personId: string;
  /** Last-name-rule-applied display name. */
  displayName: string;
  title: string | null;
  isAdmin: boolean;
  /** True when this member is one of the viewing User's controlled Persons. */
  isYou: boolean;
  capabilities: Capability[];
  photoUrl: string | null;
  /** The classrooms this member is on the roster of — served for a HOUSEHOLD's
   *  roster only, which is why it is optional here as it is on
   *  `PersonSummaryDTO`: absent means the route did not look, `[]` means the
   *  member is on no classroom's roster.
   *
   *  Households only because that is the roster the room is missing from. On a
   *  classroom's own page the label would repeat the page's title on every row,
   *  and on a school or committee group it is mostly adults. The route spends
   *  the extra read where it answers something, and `GET /groups/:id` rolls up a
   *  SUBTREE — a school group's roster can be the whole school, which is a read
   *  worth not doing for a line nothing renders. */
  classrooms?: ClassroomRefDTO[];
}

/** One of the viewer's own Persons, offered for placement in a classroom.
 *
 *  Built only for a classroom group, and only from Persons the viewer controls
 *  who hold `student` — the two halves of the rule `PUT /persons/:id/classroom`
 *  enforces, surfaced so the UI never offers a button the server would refuse.
 *  `currentClassrooms` is what makes the "one room at a time" rule legible: a
 *  non-empty list means confirming MOVES the child out of those rooms, and the
 *  client says so rather than letting the move be a surprise. */
export interface ClassroomCandidateDTO {
  personId: string;
  /** Last-name rule applied, as everywhere else. */
  displayName: string;
  /** EVERY classroom this Person is in today, usually zero or one.
   *
   *  A list rather than a single room because placing them here moves them out
   *  of ALL of them, and more than one is reachable without a system admin:
   *  `lib/bulkImport.ts` defaults `groupKind` to "classroom", so a child imported
   *  into "Room 12" and "Chorus" holds two. A single-valued field let the UI name
   *  one room and delete the other without saying so. */
  currentClassrooms: GroupRefDTO[];
  /** True when this group is among `currentClassrooms` — the row renders as
   *  "remove" rather than "add". Computed against this group by identity, never
   *  by comparing against an arbitrarily-picked "current" one. */
  isHere: boolean;
}

export interface GroupDetailDTO {
  id: string;
  kind: GroupKind;
  name: string;
  memberCount: number;
  /** True when the viewer's active Person is an admin of this group. */
  viewerIsAdmin: boolean;
  /** True when the viewer's active Person is a member at all. */
  viewerIsMember: boolean;
  /** True when the viewer may delete this group. Deleting takes the authority to
   *  create the kind (generic groups are system-admin-only) plus admin rights
   *  over the group; the server owns the rule, the UI just reads it. */
  viewerCanDelete?: boolean;
  /** True when the viewer may add, retitle and remove members. Wider than
   *  `viewerIsAdmin`: a system admin runs every group's roster even when they
   *  belong to none of them, which is the same authority `requireGroupAdmin`
   *  enforces on the member routes. Kept separate because `viewerIsAdmin` also
   *  means "you run this group" for the badge and the group-owned contacts,
   *  which a system admin who isn't a member is not offered. */
  viewerCanManageMembers?: boolean;
  /** Classrooms only, and deliberately NOT gated on `viewerCanManageMembers`:
   *  placing your own child in a room is a Controller's right, not a roster
   *  admin's. Empty (or absent) for every other kind of group, and for a viewer
   *  who controls no student. The server owns the eligibility rule; the UI reads
   *  the list rather than re-deriving who qualifies. */
  viewerEnrollable?: ClassroomCandidateDTO[];
  members: GroupMemberDTO[];
  /** Group-owned contact items (e.g. household cascading address), filtered. */
  contacts: ContactItemDTO[];
  /** Hierarchy. `ancestors` runs root → … → immediate parent (breadcrumb);
   *  `children` are the immediate sub-groups. A household may sit UNDER a group
   *  but never contains one, so `children` is always empty for a household. */
  parentId?: string | null;
  ancestors?: GroupRefDTO[];
  children?: GroupSummaryDTO[];
}

export interface ControllablePersonDTO {
  id: string;
  firstName: string;
  displayName: string;
  capabilities: Capability[];
  photoUrl: string | null;
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** An admin-managed public ICS feed that populates the shared calendar. */
export interface CalendarSourceDTO {
  id: string;
  url: string;
  name: string;
  /** Hex color for the source's event tag. */
  color: string;
  enabled: boolean;
  /** ISO-8601, or null until first fetched. */
  lastFetchedAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  /** Count of stored upcoming events from this source. */
  eventCount: number;
}

export interface CalendarSourceInput {
  url: string;
  name: string;
  color?: string;
  enabled?: boolean;
}

/** Where an event came from: an imported ICS feed, or a calendar authored here. */
export type CalendarEventKind = "imported" | "managed";

/** A single (possibly recurrence-expanded) event, already source-joined. */
export interface CalendarEventDTO {
  /** Render key only — NOT a durable handle. Materialized rows are recreated
   *  (with fresh ULIDs) whenever their feed refreshes or their event is edited.
   *  Use `seriesId` + `recurrenceId` to refer to a managed occurrence. */
  id: string;
  kind: CalendarEventKind;
  /** Managed only — the durable `managed_event` id this occurrence belongs to. */
  seriesId?: string;
  /** Managed only — ISO-8601 UTC start of this occurrence, the RECURRENCE-ID
   *  equivalent. `(seriesId, recurrenceId)` is stable across re-materialization
   *  and is what a volunteer sheet attaches to. */
  recurrenceId?: string;
  title: string;
  location: string | null;
  description: string | null;
  /** Where an online event happens: an https link an admin put on a managed
   *  event (migration 0025). Always null for an imported event — an upstream
   *  feed's `URL` property is not read, since on a district feed it names a
   *  web page rather than a meeting. May be ABSENT from a newsletter events
   *  snapshot frozen before the field existed; read it with a falsy check. */
  meetingUrl: string | null;
  /** ISO-8601 UTC. */
  start: string;
  /** ISO-8601 UTC, or null. */
  end: string | null;
  allDay: boolean;
  /** Every calendar this (de-duplicated) event appears on — imported source ids
   *  and/or managed calendar ids — for the per-calendar filter. The event is
   *  hidden only when all of its calendars are hidden. */
  sourceIds: string[];
  /** Representative calendar, for the event's color tag. */
  source: { name: string; color: string };
  /** Slug of this occurrence's PUBLISHED volunteer sheet, or null when it has
   *  none. Managed events only — an imported event has no durable handle to hang
   *  a sheet off (invariant 8). Drives the "volunteers needed" affordance in the
   *  agenda; the sheet itself lives at /v/{slug} on the calendar site. */
  volunteerSlug: string | null;
}

/** The subset of an event an ANONYMOUS caller may see, served by
 *  /calendar-public/events.
 *
 *  Hand-written rather than `Omit<CalendarEventDTO, …>` on purpose, exactly like
 *  NewsletterBrandingDTO: a field added to CalendarEventDTO must be added HERE
 *  and to `publicEventOf()` before it can reach the public agenda. Structural
 *  typing would have made that a silent, automatic leak instead.
 *
 *  `seriesId`/`recurrenceId` are deliberately withheld even though they carry no
 *  PII today. They are the durable handle a volunteer signup attaches to (see
 *  CalendarEventDTO above and CLAUDE.md invariant 8), so withholding the join
 *  key means that even a careless future edit to `publicEventOf` can't make
 *  member signup data addressable from an unauthenticated response.
 *
 *  `volunteerSlug` IS carried, and is the one considered exception. It is an
 *  opaque per-sheet handle, not the durable join key: it addresses the public
 *  volunteer page — which itself publishes counts and never names — and it
 *  cannot be used to reach the member-only sheet, which is gated on the session
 *  rather than on knowing an id. The whole point of the sheet having its own
 *  slug is that the public link needn't reveal (seriesId, recurrenceId).
 *
 *  `meetingUrl` is the second deliberate addition. It is public for the reason
 *  `location` is: it says where an event happens, it was typed by an admin
 *  onto an event anyone can read, and the published .ics feed (served without
 *  a session) carries it as the `URL` property in any case. It is never
 *  derived from member data. */
export interface PublicCalendarEventDTO {
  id: string;
  kind: CalendarEventKind;
  title: string;
  location: string | null;
  description: string | null;
  meetingUrl: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  sourceIds: string[];
  source: { name: string; color: string };
  volunteerSlug: string | null;
}

/** Public-facing calendar feed — for the show/hide filter and ICS download link.
 *  The URL is exposed (these are public feeds); admin-only status stays private.
 *  Covers both imported sources (the upstream feed URL) and managed calendars
 *  (this API's own published /ics/:id.ics URL). */
export interface CalendarFeedDTO {
  id: string;
  name: string;
  color: string;
  url: string;
}

/** The subset of a calendar an ANONYMOUS caller may see. Hand-written for the
 *  same reason as PublicCalendarEventDTO.
 *
 *  `url` is ALWAYS a feed on this API's own origin — /ics/:id.ics for a managed
 *  calendar, /ics/source/:id.ics for an imported one — and never the URL an
 *  admin pasted. Providers like Google and Outlook hand out secret subscribe
 *  links that grant the raw upstream feed, which carries ORGANIZER/ATTENDEE
 *  addresses this app deliberately never stores, and a URL served publicly can't
 *  be un-published. The imported form is therefore a mirror of what we store
 *  (see renderImportedSourceIcs), which is exactly the data the agenda already
 *  shows. Members still get the real upstream URLs from the authenticated
 *  /calendar/sources. */
export interface PublicCalendarFeedDTO {
  id: string;
  name: string;
  color: string;
  url: string;
}

// ── Managed calendars (authored here, rather than imported) ─────────────────

export type RecurFreq = "daily" | "weekly" | "monthly";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A recurrence rule, stored structured. The RRULE line in a published feed is
 *  derived from this — the string form is never the source of truth. */
export interface RecurrenceInput {
  freq: RecurFreq;
  /** Every N days/weeks/months. Defaults to 1. */
  interval?: number;
  /** Weekly only — which weekdays the event lands on. */
  byDay?: Weekday[];
  /** ISO-8601 UTC. Required: bounding every rule keeps expansion finite. */
  until: string;
}

/** A calendar created in this app. Analogous to CalendarSourceDTO, but instead
 *  of fetching an external URL it publishes one. */
export interface ManagedCalendarDTO {
  id: string;
  name: string;
  color: string;
  description: string | null;
  /** Count of events (series, not expanded occurrences) on this calendar. */
  eventCount: number;
  /** Absolute, public, unauthenticated .ics URL for this calendar. */
  icsUrl: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ManagedCalendarInput {
  name: string;
  color?: string;
  description?: string | null;
}

/** What deleting a calendar would take with it, read before it is done.
 *
 *  Its own DTO on its own route rather than fields on `ManagedCalendarDTO`
 *  (the same trade `PersonRemovalImpactDTO` makes): the admin list would
 *  otherwise pay four counts per row that nothing renders, where this is
 *  fetched once, when the confirmation opens — and fetched THEN, so a sign-up
 *  claimed since the list loaded is inside the number the admin is shown. */
export interface ManagedCalendarRemovalImpactDTO {
  calendarId: string;
  /** Kept because after the delete the id resolves to nothing. */
  name: string;
  /** Authored series on this calendar. */
  events: number;
  /** Dates those series expand to — what comes off the agenda and the feed. */
  occurrences: number;
  sheets: number;
  /** Claimed volunteer spots. Not recoverable, and nobody is told. */
  signups: number;
}

/** One authored event and its recurrence rule — the editable master row. */
export interface ManagedEventDTO {
  /** Durable series id: created once, never regenerated. */
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  description: string | null;
  /** Online meeting link, validated to an http(s) URL on write, or null. */
  meetingUrl: string | null;
  /** ISO-8601 UTC start of the first occurrence. */
  start: string;
  /** ISO-8601 UTC end, or null. For all-day events this is the RFC5545-exclusive
   *  day after the last day, not the inclusive last day. */
  end: string | null;
  allDay: boolean;
  recurrence: RecurrenceInput | null;
  /** Number of materialized occurrences currently visible in the agenda. */
  occurrenceCount: number;
  /** Volunteer sheets hung off this series' occurrences, and the spots claimed
   *  across them. Admin-only, like the rest of this DTO — they exist so a
   *  delete can say what it is about to take with it (invariant 13: a sheet
   *  keys on the series, so removing the series removes the sheet). */
  sheetCount: number;
  signupCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedEventInput {
  title: string;
  location?: string | null;
  description?: string | null;
  /** Must parse as an http(s) URL when non-empty; the API 400s otherwise. */
  meetingUrl?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  recurrence?: RecurrenceInput | null;
}

// ── Volunteer signups ───────────────────────────────────────────────────────
//
// A volunteer SHEET hangs off one occurrence of a managed event and holds
// POSITIONS ("snack table, 4 people, 5–7pm"); members claim a SIGNUP on a
// position as one of the Persons they control. Three audiences read this data
// and they see three different things:
//
//   anonymous  → PublicVolunteerSheetDTO: positions and filled COUNTS, no names
//   member     → VolunteerSheetDTO: the same plus who took each spot
//   admin      → VolunteerSheetDTO with `manage` set
//
// The first split is the one that matters and it is enforced server-side in
// lib/volunteers.ts's `publicSheetOf`, the companion to `publicEventOf`.

/** One person's claim on a position. Member-visible only — this shape never
 *  appears in an anonymous response. */
export interface VolunteerSignupDTO {
  id: string;
  personId: string;
  /** Last-name-rule-applied, like every other name that crosses the wire. */
  displayName: string;
  note: string | null;
  /** True when this signup is for one of the viewing User's controlled Persons —
   *  i.e. when the viewer may withdraw it. */
  isYou: boolean;
  createdAt: string;
}

/** A job on a sheet: what it is, how many people it takes, and optionally the
 *  slice of the event they're needed for. */
export interface VolunteerPositionDTO {
  id: string;
  title: string;
  description: string | null;
  /** How many people are needed. */
  slots: number;
  /** How many are signed up. Always present, for both audiences. */
  filled: number;
  /** Optional shift window, ISO-8601 UTC. Display-only; independent of the
   *  event's own start/end, since a shift may cover part of an event. */
  startsAt: string | null;
  endsAt: string | null;
  /** Who took the spots. Member-only — absent from the public projection. */
  signups: VolunteerSignupDTO[];
}

/** The occurrence a sheet belongs to, resolved from `managed_event` plus the
 *  sheet's own `occurrence_start` — never from `calendar_event`, whose ids and
 *  rows are disposable (invariant 8). */
export interface VolunteerEventDTO {
  /** The durable `managed_event` id. Member-only; see PublicVolunteerSheetDTO. */
  seriesId: string;
  /** ISO-8601 UTC start of this occurrence. Member-only, as the RECURRENCE-ID
   *  half of the durable pair — the same instant reaches anonymous callers as
   *  the plain `start` below, which is what the public agenda already shows. */
  recurrenceId: string;
  title: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
}

/** A sheet as a signed-in member sees it. */
export interface VolunteerSheetDTO {
  id: string;
  /** The public URL segment: /v/{slug} on the calendar site. */
  slug: string;
  intro: string | null;
  /** ISO-8601 UTC after which claims are refused, or null for "until it fills". */
  closesAt: string | null;
  /** Server's verdict on whether claims are currently accepted — resolved here
   *  rather than in the client so a stale clock can't invite a doomed request. */
  closed: boolean;
  /** False while the sheet is a draft; the public route 404s on those. */
  published: boolean;
  /** Optional link to an external runbook (a Google Doc, typically) describing
   *  how the event is run. Member-only: deliberately withheld by
   *  `publicSheetOf` — a working document like this routinely names families
   *  and logistics that don't belong on an enumerable anonymous page. http(s)
   *  only, enforced on write (migration 0039). */
  runbookUrl: string | null;
  event: VolunteerEventDTO;
  positions: VolunteerPositionDTO[];
  /** True when the viewer may edit the sheet (system admins today). */
  canManage: boolean;
  /** Admin-facing: the occurrence this sheet names no longer exists in the
   *  materialized agenda, because the series was edited after it was created.
   *  The sheet and its signups are intact — it just isn't on the calendar. */
  orphaned?: boolean;
}

/** The subset of a sheet an ANONYMOUS caller may see, served by
 *  /volunteers-public/sheets/:slug.
 *
 *  Hand-written rather than `Omit<VolunteerSheetDTO, …>` for the same reason as
 *  PublicCalendarEventDTO: structural typing would let a field added upstream
 *  ride along into a public response by itself. Build it field by field in
 *  `publicSheetOf`, never by spreading.
 *
 *  Two withholdings are the point of this type. **Names never appear** — a
 *  volunteer's identity is member-only (invariant 1), so positions carry a
 *  `filled` count and nothing else about who filled them; `VolunteerSignupDTO`
 *  must never be reachable from here. And `seriesId`/`recurrenceId` are withheld
 *  exactly as PublicCalendarEventDTO withholds them, so the durable handle that
 *  addresses member signup data stays out of unauthenticated responses. The
 *  occurrence's instant still reaches the reader as `event.start`, which the
 *  public agenda publishes anyway; it is the durable PAIR that is withheld.
 *  `runbookUrl` is withheld too — see its note on VolunteerSheetDTO. */
export interface PublicVolunteerSheetDTO {
  slug: string;
  intro: string | null;
  closesAt: string | null;
  closed: boolean;
  event: {
    title: string;
    location: string | null;
    description: string | null;
    start: string;
    end: string | null;
    allDay: boolean;
  };
  positions: Array<{
    id: string;
    title: string;
    description: string | null;
    slots: number;
    filled: number;
    startsAt: string | null;
    endsAt: string | null;
  }>;
}

export interface VolunteerSheetInput {
  /** ISO-8601 UTC start of the occurrence to open. Create-only — moving a sheet
   *  to another date would silently relocate everyone who already signed up. */
  occurrenceStart?: string;
  intro?: string | null;
  closesAt?: string | null;
  published?: boolean;
  /** http(s) link to an external runbook; see VolunteerSheetDTO.runbookUrl. */
  runbookUrl?: string | null;
}

export interface VolunteerPositionInput {
  title: string;
  description?: string | null;
  slots?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export interface VolunteerSignupInput {
  /** A Person the requesting User controls. */
  personId: string;
  note?: string | null;
}

/** How to reach the people on one sheet — the admin's "Email volunteers"
 *  button, and nothing else.
 *
 *  Deliberately its OWN response rather than a field on VolunteerSignupDTO.
 *  That DTO is member-visible, so an address hanging off it would put every
 *  volunteer's email in front of every signed-in reader of the event page; here
 *  the whole payload is behind the system-admin gate and cannot reach a member
 *  by being carried along. Same reasoning as `GET /persons/:id/removal-impact`
 *  being a route of its own.
 *
 *  One address per volunteer, deduped, in the order they appear on the sheet —
 *  see `sheetVolunteerEmails` for which address that is and why. */
export interface VolunteerEmailsDTO {
  emails: string[];
  /** Signed-up Persons with no reachable address, so the admin is told rather
   *  than left to assume the list is everyone. */
  withoutEmail: number;
}

/** One occurrence of an authored event, for the admin's "which date?" picker.
 *  Read from the materialized agenda, so it lists exactly the dates a member
 *  can currently see. */
export interface ManagedOccurrenceDTO {
  /** ISO-8601 UTC start — the value that becomes a sheet's `occurrenceStart`. */
  start: string;
  end: string | null;
  allDay: boolean;
  /** The sheet already open on this date, if any. */
  sheet: { id: string; slug: string; published: boolean; positionCount: number } | null;
}

/** One album in the members-only albums list (GET /calendar/albums). Hand-built
 *  from `event_album` + `managed_event`; there is no public twin — an album link
 *  is a capability, so none of this reaches `publicEventOf` (migration 0045). */
export interface EventAlbumDTO {
  title: string;
  /** ISO-8601 UTC start of the occurrence the album belongs to. */
  start: string;
  allDay: boolean;
  /** https link to the album. */
  url: string;
}

/** A current grantee of a share, for the visibility sheet's "Shared with" list. */
export interface ShareGranteeDTO {
  id: string; // share row id
  targetKind: "person" | "group";
  targetId: string;
  name: string;
}

/** A pickable target when adding a grantee. */
export interface ShareTargetDTO {
  kind: "person" | "group";
  id: string;
  name: string;
  /** For groups, the kind (household/classroom/generic) for the icon. */
  groupKind?: GroupKind;
}

export interface CreateShareBody {
  subjectKind: "contact_item" | "field";
  subjectRef: string;
  targetKind: "person" | "group";
  targetId: string;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  isSystemAdmin: boolean;
  personCount: number;
  /** Disabled accounts cannot sign in, receive the newsletter, or be
   *  masqueraded as, and they keep everything they own. Reversible. */
  disabled: boolean;
  /** ISO-8601, or null while active. */
  disabledAt: string | null;
}

/** What permanently deleting a User would remove — a dry run, computed on
 *  demand and never acted on automatically.
 *
 *  The whole point of this shape is that "delete a user and everything they
 *  made" is not a thing this schema can answer: `grp` records no creator, and
 *  `control` is many-to-many precisely so two parents can share a child. So the
 *  report distinguishes what is genuinely only theirs from what merely passes
 *  through them, and an admin reads it before anything irreversible happens. */
export interface UserDeletionImpactDTO {
  user: { id: string; email: string; disabled: boolean };
  /** Sole controller — nobody else can edit these, so a delete would take them. */
  orphanedPersons: { id: string; name: string }[];
  /** Co-controlled. A delete would drop only this user's control row and leave
   *  the Person for whoever else holds one. */
  sharedPersons: { id: string; name: string; otherControllers: number }[];
  /** Households left with no members once the orphaned Persons are gone. */
  emptiedHouseholds: { id: string; name: string }[];
  /** Groups this user administers that would SURVIVE — classrooms and generic
   *  groups belong to the school, not to a member, so a delete never removes
   *  them. Listed because losing their only admin is worth knowing about. */
  retainedGroupsAdministered: { id: string; name: string; kind: GroupKind }[];
  /** Audit rows naming this user. Always retained — the log is append-only and
   *  hash-chained, so removing entries would break tamper-evidence and erase
   *  the record of what they did. */
  auditEntries: number;
  /** Volunteer spots this account claimed that a delete would give back — for
   *  their own Persons and for co-controlled ones alike, since the claim is the
   *  account's. */
  volunteerClaimsWithdrawn: number;
  /** PTO board comments this account authored that a delete would remove.
   *  Comments are speech tied to the account, not a Person, so nothing else
   *  holds them. */
  boardCommentsDeleted: number;
  /** Fields this account shared with a person or group, including on a Person
   *  someone else also controls. A share is the account's act (`created_by`
   *  is NOT NULL), so it goes with the account; the other controller can share
   *  the field again. */
  sharesWithdrawn: number;
}

/** One normalized row submitted to bulk import (client maps CSV columns to these). */
export interface BulkImportRow {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  group?: string;
  groupKind?: GroupKind;
  title?: string;
  /** Comma- or space-separated capability codes. */
  capabilities?: string;
}

export interface BulkImportOptions {
  /**
   * A row whose email has no account gets an ACCOUNT rather than a pending
   * invite: the `user` row is minted the way `POST /admin/users` mints one
   * (`joined_via 'admin'`, no email sent) and the Person is attached to it on
   * the spot. From then on "Email me a link" on the sign-in screen finds the
   * account — registration open or closed — and the member lands already
   * controlling their Person. Built for a staff roster, where the school
   * vouches for every address and nobody wants an invitation to answer. In
   * this mode there are no invites, so there is nothing for `sendInvites` to
   * mail; the two are alternatives, not layers.
   */
  createAccounts?: boolean;
  /**
   * Visibility of the contact items this import writes. Defaults to `private`
   * (invariant 3) — right for a family roster, where the member decides what
   * to show, and wrong for a staff one, where a classroom phone nobody but the
   * teacher can see is not a directory entry. An explicit admin choice on the
   * import, never a new default.
   */
  contactVisibility?: Visibility;
  /**
   * The email column is the named Person's OWN address, so store it on their
   * profile as an email contact item. Off by default because on a family
   * roster that column is the PARENT'S address repeated on each child's row —
   * the account that controls the Person, not the Person's own contact — and
   * a child's profile must not carry it.
   */
  emailAsContact?: boolean;
}

export interface BulkImportResult {
  dryRun: boolean;
  rowsProcessed: number;
  personsCreated: number;
  personsMatched: number;
  groupsCreated: number;
  membershipsCreated: number;
  invitesQueued: number;
  /** Sign-in accounts minted by this import (`createAccounts` mode only). */
  accountsCreated: number;
  errors: { row: number; message: string }[];
}

export const BULK_IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "group",
  "title",
  "capabilities",
] as const;
export type BulkImportField = (typeof BULK_IMPORT_FIELDS)[number];

// ── Backup / restore ────────────────────────────────────────────────────────

/** The word `POST /admin/restore` requires in its body before it will write
 *  anything. The dry run doesn't need it, so a dry-run request body replayed by
 *  accident can never become a restore — the confirmation is a separate thing
 *  the admin has to have typed, not a flag a client can flip. */
export const RESTORE_CONFIRM = "RESTORE";

/** A whole-database backup. The API writes it and reads it back; nothing else
 *  should construct one by hand. `tables` is table name → rows, with each row a
 *  plain column-keyed object — deliberately untyped per column, because the
 *  point of this file is to survive columns the shared types don't know about. */
export interface BackupDocument {
  format: number;
  generatedAt: string;
  school: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** What a restore would do, or did. Returned by both the dry run and the real
 *  thing, so the screen renders one shape either way. */
export interface RestoreReportDTO {
  dryRun: boolean;
  /** Row counts per table. `skipped` marks a table present in the file that
   *  this restore will not write — `audit_log`, which is append-only and
   *  survives the restore that would otherwise have erased it. */
  tables: { table: string; rows: number; skipped: boolean }[];
  totalRows: number;
  /** Non-empty means nothing was written and nothing will be until it's fixed. */
  errors: string[];
  /** Worth reading before confirming; none of them stop a restore. */
  warnings: string[];
  restored: boolean;
  rowsWritten?: number;
}

export interface AuditEntryDTO {
  id: string;
  action: AuditAction | string;
  /** Acting human's email (the admin during masquerade), or null for system. */
  actorEmail: string | null;
  /** When masquerading, the email of the target being acted as. */
  masqueradingAsEmail: string | null;
  entityKind: string | null;
  entityId: string | null;
  /** The row's `detail_json`, parsed. Admin-only, like the rest of this DTO;
   *  it is here because `q` searches it, and a match must be visible. */
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditActionCountDTO {
  action: string;
  count: number;
}

/** GET /admin/metrics — one read across the whole suite (system admins only).
 *  Every field is a COUNT or a SUM: numbers, never identities — invariant 21's
 *  own carve-out for `member_count`, applied suite-wide. Nothing here names a
 *  person, an email address or a street. */
export interface SuiteMetricsDTO {
  directory: {
    /** Sign-in accounts, disabled included (they're flagged, not hidden). */
    accounts: number;
    disabledAccounts: number;
    /** Enabled system admins. */
    admins: number;
    /** Enabled accounts holding directory access (invariant 32). */
    approvedAccounts: number;
    /** Applications waiting on a reviewer. */
    pendingAccessRequests: number;
    newAccounts30d: number;
    /** All Persons, unlisted included — the viewer is a system admin, the one
     *  audience `unlisted_at` never hides from. */
    people: number;
    unlistedPeople: number;
    households: number;
    classrooms: number;
  };
  calendar: {
    calendars: number;
    managedEvents: number;
    importedSources: number;
    /** Expanded occurrences from now on — the agenda's forward horizon. */
    upcomingOccurrences: number;
  };
  volunteers: {
    publishedSheets: number;
    signups: number;
    signups30d: number;
  };
  newsletter: {
    /** Currently subscribed (not unsubscribed) addresses. */
    subscribers: number;
    issuesSent: number;
    /** All-time public archive page loads (migration 0042 — a floor, not a
     *  census: email opens are never tracked). */
    archiveViews: number;
    archiveViews30d: number;
  };
  store: {
    /** Orders money actually arrived for (`paid_at` set), all later states
     *  included. */
    paidOrders: number;
    paidOrders30d: number;
    /** SUM(total_cents) over those orders. */
    revenueCents: number;
    /** Paid orders stuck in `fulfillment_failed` — the ones needing a human. */
    fulfillmentFailed: number;
  };
  pto: {
    boards: number;
    openCards: number;
  };
  lostAndFound: {
    /** On the public site right now. */
    listed: number;
    /** Held for staff review (invariant 33's hold). */
    awaitingReview: number;
    returned: number;
    openClaims: number;
  };
  /** Audit rows appended in the last 30 days — a rough pulse of member and
   *  admin activity, every app combined. */
  auditEvents30d: number;
}

/**
 * Where an account stands with the one gate that is not `requireAuth`
 * (migration 0029, invariant 32).
 *
 *   incomplete — nothing asked for yet, or the claim is not answerable. The
 *                app shows the form rather than an explanation.
 *   pending    — asked, nobody has decided. The common case, and the one the
 *                copy has to be kind about.
 *   approved   — reads the directory. A system admin is always this.
 *   declined   — a decision, reversible. The account still works everywhere
 *                else; only the directory is closed.
 *
 * Derived from three dates on `user`, never stored as a word: two of them
 * could otherwise disagree with it.
 */
export type DirectoryAccessState = "incomplete" | "pending" | "approved" | "declined";

/** What `POST /me/access-request` needs before it will accept a submission, and
 *  what the app checks to decide whether to enable the button. Each flag is one
 *  sentence of the form, so a false one can be pointed at. */
export interface AccessClaimStatusDTO {
  /** The applicant has a Person of their own carrying a full name. */
  selfNamed: boolean;
  /** At least one Person they control holds `student`. */
  hasStudent: boolean;
  /** That student sits on a classroom roster — the part a reviewer checks. */
  studentPlaced: boolean;
  /** The applicant works at the school: a Person they control holds `teacher`
   *  or `staff`. The OTHER route to a complete claim, because a teacher, the
   *  office and the nurse have no child to name and would otherwise meet a
   *  form they could never finish. Self-asserted like `student` is, and safe
   *  for the same reason — it decides what a reviewer is shown, never what
   *  anyone may read. */
  isStaff: boolean;
  /** The family has entered at least one contact item (any Person they
   *  control, or their household). Required before the directory opens — the
   *  read gate is reciprocal — so the form requires it too, or an approved
   *  family would still meet a locked directory with no warning. */
  hasContactInfo: boolean;
  /** All conditions. The route re-derives this; the client never asserts it. */
  complete: boolean;
}

export interface MeDTO {
  user: {
    id: string;
    email: string;
    isSystemAdmin: boolean;
    locale: Locale | null;
  };
  persons: ControllablePersonDTO[];
  activePersonId: string | null;
  masqueradingAs: string | null;
  /** The gate, on the one route that is deliberately outside it. A pending
   *  member has to be told why the directory is empty, which a route that
   *  refused them could not do — the reason `GET /pto/access` and
   *  `GET /newsletter/access` sit outside their own gates too. */
  directoryAccess: DirectoryAccessState;
  /** Why the button is disabled, present only while `directoryAccess` is
   *  `incomplete` — there is nothing to itemise once they have asked. */
  accessClaim?: AccessClaimStatusDTO;
  /** The reciprocity half of the read gate: the family has entered at least
   *  one contact item. `approved` with this false means the directory is
   *  still closed, and the fix is adding contact info, not re-applying. Raw
   *  fact for every account; the admin exemption lives in the gate itself. */
  hasContactInfo: boolean;
}

/** One pending (or decided) application, as the admin queue renders it.
 *
 *  The claim is READ LIVE from the Person rows the applicant created rather
 *  than copied onto the request at submit time: a family who fixes a typo
 *  before anyone looks should be reviewed on what is true now, and a second
 *  copy is a second thing to keep in step. Nothing here is a projection of
 *  `person` for an ordinary viewer — the route is system-admin only. */
export interface AccessRequestDTO {
  userId: string;
  email: string;
  /** ISO-8601. Null for an account that never asked (the queue can show
   *  these separately — they are the ones that signed up and stopped). */
  submittedAt: string | null;
  createdAt: string;
  state: DirectoryAccessState;
  /** The applicant's own name, as they entered it. */
  applicantName: string | null;
  /** The children they entered, with the rooms they claim. */
  students: { id: string; name: string; classrooms: string[] }[];
  /** What the applicant says they are — `parent`, `teacher`, `staff`. Present
   *  so a teacher does not read to a reviewer as a parent who forgot to enter
   *  their children: a staff applicant has no child to name, by design. */
  roles: Capability[];
  /** Their free-text line, if they wrote one. Never translated (invariant 6). */
  note: string | null;
  decidedAt: string | null;
  /** Email of the admin who decided, for a queue that several people work. */
  decidedBy: string | null;
}

export interface NeighborDTO {
  /** Person (or household) id — the card links to this profile/group. */
  id: string;
  /** Person or household display name (last-name rule applied). */
  name: string;
  /** Rounded, human string e.g. "~0.4 mi". Never raw coordinates. */
  approxDistance: string;
  kind: "person" | "household";
  /** The classrooms the STUDENTS of this neighbour's household are on the
   *  roster of — the grade and teacher a parent actually scans this row for,
   *  since "who lives nearby" is asked in order to find the family whose child
   *  is in the same room. Deduped across the household's children, so a card
   *  names each room once however many siblings sit in it.
   *
   *  Household-derived by construction, for BOTH kinds of card: a `household`
   *  card reads its own roster, and a `person` card reads the households that
   *  Person belongs to. A Person in no household therefore carries nothing,
   *  which is the ask read literally — the question is what the HOUSEHOLD's
   *  children are in, not what this one adult's memberships are.
   *
   *  Optional for `PersonSummaryDTO`'s reason: absent is "the route did not
   *  look", `[]` is "no student in the household is on a roster". It discloses
   *  nothing new — `GET /groups/:id` already serves every roster to any
   *  authenticated member — and it is invariant 18's SAFE direction, the card
   *  rendering more than the scan matched on. The co-members it reads are
   *  nonetheless put through `personListableSql`: a room is a fact about a
   *  child, and invariant 21 decides whether that child exists to this viewer
   *  before any field on them does. */
  classrooms?: ClassroomRefDTO[];
}

export type NeighborsResponse =
  | { neighbors: NeighborDTO[] }
  | { addCta: true };

// ── Request bodies ──────────────────────────────────────────────────────────

export interface AuthStartBody {
  email: string;
  /** Origin to return to after the magic link is clicked, so a sibling app
   *  (calendar.eisenhower.school) can start a sign-in and get the member back.
   *  Ignored unless it exactly matches an allowed origin; omit for the default. */
  returnTo?: string;
}

export interface ContactItemInput {
  type: ContactType;
  label?: string | null;
  value: string;
  visibility?: Visibility;
  neighborDiscoverable?: boolean;
}

export interface PersonPatchBody {
  firstName?: string;
  lastName?: string | null;
  lastNameDisplay?: LastNameDisplay;
  /** When present, REPLACES the Person's assignable capabilities (the
   *  `ASSIGNABLE_CAPABILITIES` set — the tags shown on a row). Anything outside
   *  that set, `household_admin` included, is neither granted nor revoked by
   *  this field: it is conferred through group membership, not typed. */
  capabilities?: Capability[];
}

/** Body for POST /me/persons — create a Person the requesting User controls.
 *  Used both for self-onboarding (name only) and for adding family members. */
export interface CreatePersonBody {
  firstName: string;
  lastName?: string | null;
  /** Optional capability codes to grant (validated server-side). */
  capabilities?: Capability[];
  /** Optional household group to add the new Person to. Must be a household the
   *  requesting User administers; the household's address then cascades. */
  householdId?: string | null;
}

/** A household the requesting User administers (for the create-person picker). */
export interface MyHouseholdDTO {
  id: string;
  name: string;
}

/** Body for POST /persons/:id/controllers — invite a co-Controller by email. */
export interface InviteControllerBody {
  email: string;
  /** Optional: the household this invitation is ABOUT. When given (and the
   *  inviter administers it), accepting grants the invitee control of every
   *  Person in that household the inviter controls — not just `:id` — and makes
   *  them an admin of it. That is what stops a co-parent arriving to an empty
   *  family and re-creating children who already exist. Omit it for the narrow
   *  case the route was built for: letting one more adult co-manage one Person. */
  householdId?: string | null;
}

/** What DELETE /persons/:id is about to remove, read before confirming it.
 *
 *  The same shape of promise `ManagedEventDTO.sheetCount`/`signupCount` make for
 *  a calendar delete (invariant 13): count it BEFORE removing it, because none
 *  of this is countable afterwards and none of it is recoverable. */
export interface PersonRemovalImpactDTO {
  personId: string;
  /** False when a guard below refuses; `reason` says which. */
  allowed: boolean;
  /** `shared` — another User also controls them, so they are not yours alone to
   *  take (invariant 17's rule, applied to a Person rather than a User).
   *  `household_admin` — they are the only admin of a household that still has
   *  other members, which would leave that household unmanageable. */
  reason?: "shared" | "household_admin";
  /** Other Users who control them; the count `shared` is about. */
  otherControllers: number;
  contactItems: number;
  groups: number;
  /** Volunteer spots that will be released. Named plainly because someone is
   *  expecting them at the event. */
  volunteerSignups: number;
  /** Households that would be left with no members at all and are removed with
   *  them, per the rule GET /admin/users/:id/impact states (invariant 17). */
  emptiedHouseholds: number;
  /** True when they are the Person the requester is currently acting as. */
  isActive: boolean;
}

// ── Instance settings ──────────────────────────────────────────────────────

/** How system admins hear about something that happened without them. `off` by
 *  default (NFR-1): the instance sends nothing until an admin opts in.
 *  - `instant` — one email per event, as it happens.
 *  - `daily`   — a single digest of everything since the last one.
 *
 *  Shared by new-member notifications (chosen per admin) and new-subscriber
 *  notifications (one instance-wide setting); they sit on separate screens, but
 *  the shape and the machinery behind them (lib/notify.ts) are one. */
export type NotifyMode = "off" | "instant" | "daily";

export const NOTIFY_MODES = ["off", "instant", "daily"] as const;

/** How ONE system admin hears about new sign-ups — each admin's own choice,
 *  stored on their `user` row (migration 0026). */
export type NewUserNotify = NotifyMode;

export const NEW_USER_NOTIFY_MODES = NOTIFY_MODES;

/** The CALLER's own notification choices, not the instance's. */
export interface NotificationSettingsDTO {
  newUser: NewUserNotify;
  /** Whether "directory access requested" emails reach this admin (migration
   *  0034). Off by default, like `newUser`. */
  accessRequest: boolean;
}

// ── Newsletter ─────────────────────────────────────────────────────────────

/** `draft` is the only mutable state. `sending` is entered by an atomic
 *  compare-and-swap so a double-clicked Send can't queue a second fan-out, and
 *  it is never left except by the fan-out finishing. */
export type NewsletterIssueStatus = "draft" | "sending" | "sent";

export const NEWSLETTER_ISSUE_STATUSES = ["draft", "sending", "sent"] as const;

/** One recipient's delivery outcome for one issue. */
export type NewsletterRecipientStatus = "pending" | "sent" | "failed";

/** A ProseMirror/TipTap document node, described structurally rather than
 *  imported from @tiptap/core — `@sd/shared` stays framework-free, and the
 *  editor and this type independently describe the same stored wire shape. */
export interface NewsletterNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NewsletterNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** The one newsletter-specific node type. It is an atom: it has no children,
 *  and its event list is resolved (live while drafting, frozen at send) rather
 *  than stored in the document. */
export const EVENTS_BLOCK_TYPE = "eventsBlock";

/** Attributes on an `eventsBlock` node. Several may appear in one issue, each
 *  with its own calendars and window, so `blockId` keys the frozen snapshot. */
export interface NewsletterEventsBlockAttrs {
  /** Assigned when the block is inserted; stable for the issue's lifetime. */
  blockId: string;
  /** calendar_source / managed_calendar ids (see CalendarFeedDTO). Empty means
   *  "every calendar", matching the settings default. */
  calendarIds: string[];
  /** Days ahead of the render moment to include. Used only when the block has
   *  no fixed range — see `rangeStart`. */
  lookaheadDays: number;
  /** Start of an explicit window, as a YYYY-MM-DD calendar date read in the
   *  school's zone. Set together with `rangeEnd`; when BOTH are present the
   *  block is pinned to those dates and `lookaheadDays` is ignored. Null means
   *  the rolling "next N days" window. */
  rangeStart: string | null;
  /** Inclusive end of the explicit window; see `rangeStart`. */
  rangeEnd: string | null;
  /** Events the author removed from the block, as `eventKey` handles. Applied
   *  at render time, so the frozen snapshot keeps the whole queried window and
   *  the removal travels with the (immutable) document instead. */
  excluded: string[];
  /** Optional heading rendered above the list; null renders no heading. */
  heading: string | null;
}

/** Whether this caller may author the newsletter, and which group decides.
 *
 *  Resolved server-side by `newsletterAccess` in apps/api/src/lib/newsletter.ts
 *  — the same roster gate the PTO boards use (`PtoAccessDTO`), keyed on the
 *  `newsletter_editor_group_id` setting instead. The client reads it to choose
 *  between the issue list and the member's preferences screen; it is a UI
 *  convenience, and every authoring route is independently gated. */
export interface NewsletterAccessDTO {
  /** True when the caller is a system admin, or controls a Person on the
   *  editors group's roster. Editors author issues; settings and the
   *  subscriber list stay with system admins, so this is not `isSystemAdmin`. */
  canUse: boolean;
  isSystemAdmin: boolean;
  /** Name of the configured editors group, or null when none has been named —
   *  the bootstrap state, in which only system admins author. */
  groupName: string | null;
  groupId: string | null;
}

/** Instance-wide newsletter configuration. Stored as one JSON blob under a
 *  single `setting` key rather than its own table. */
export interface NewsletterSettingsDTO {
  /** Display name on the From header. */
  senderName: string;
  /** From address. Off the onboarded sending domain it keeps its display name
   *  and survives as Reply-To while the address is swapped (lib/email.ts). */
  senderEmail: string;
  replyTo: string | null;
  /** The footer, as hand-written HTML. Used in the email's HTML part and on the
   *  public archive pages; the text-only part gets it flattened by
   *  `footerTextOf`. Stored already sanitized by `sanitizeFooterHtml` — see
   *  invariant 9 in CLAUDE.md. */
  footerHtml: string;
  /** Physical mailing address, expected in bulk mail. */
  mailingAddress: string;
  unsubscribeWording: string;
  /** Absolute URL of an uploaded logo, or null. */
  logoUrl: string | null;
  /** Hex, e.g. "#0068A8". Applied to the email and the public page. */
  accentColor: string;
  /** Masthead title, distinct from any single issue's title. */
  newsletterTitle: string;
  /** Pre-fills a newly inserted events block. */
  defaultCalendarIds: string[];
  defaultLookaheadDays: number;
  /** The school's IANA zone, e.g. "America/Chicago". Comes from the Worker's
   *  SCHOOL_TIMEZONE var, NOT from the settings blob — it is echoed here (and
   *  ignored on write) purely so the composer can resolve an events block's
   *  fixed date range to the same instants the server will at send time. */
  timeZone: string;
  /** Public calendar site, from the Worker's CALENDAR_URL var. Env-derived and
   *  ignored on write, like `timeZone`. Events blocks link out to it. */
  calendarUrl: string;
  /** How system admins hear about someone confirming a subscription through the
   *  PUBLIC form. `off` by default, like every other notification (NFR-1).
   *
   *  Only the public double opt-in fires this. Addresses an admin adds on the
   *  subscribers screen or via bulk import never notify — the admin who added
   *  them already knows — which is the same rule notify.ts applies to
   *  admin-provisioned member accounts. */
  newSubscriberNotify: NotifyMode;
}

export interface NewsletterIssueSummaryDTO {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  status: NewsletterIssueStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  /** When its public `/n/:slug` page went up, or null while it has none.
   *  Independent of `status`: a draft may be published, and a sent issue
   *  unpublished (migration 0031). Sending publishes one that isn't yet. */
  publishedAt: string | null;
  /** Last write to the document itself (create or edit) — not a publish or a
   *  send, which move `updatedAt` too (migration 0032). */
  editedAt: string;
  /** Who made that edit, as the directory would name them to this viewer, or
   *  null when it can't say: an account with no Person, a Person the
   *  enumeration gate withholds (invariant 21), or a deleted account. */
  editedBy: { displayName: string; isYou: boolean } | null;
  /** Audience size measured when the send began; 0 while still a draft. */
  recipientTotal: number;
}

export interface NewsletterIssueDTO extends NewsletterIssueSummaryDTO {
  subject: string;
  content: NewsletterNode;
  /** Frozen per-block event lists, keyed by `blockId`. Absent while `draft`. */
  eventsSnapshot: Record<string, CalendarEventDTO[]> | null;
  /** Present once sending has begun, for the admin's progress display. */
  recipientCounts: { pending: number; sent: number; failed: number } | null;
  /** Whether a review link is live, and when it was minted. Never the token:
   *  only its hash is stored, so the URL shown at mint time is the one and only
   *  copy. "I lost it" is answered by minting a new one, which invalidates the
   *  old — see migration 0015. */
  previewLink: { active: boolean; createdAt: string | null };
}

export interface NewsletterIssueInput {
  title: string;
  subtitle?: string | null;
  /** Email subject. Defaults to `title` when omitted. */
  subject?: string;
  /** Defaults to `<today>-<slugified title>` when omitted. */
  slug?: string;
  content: NewsletterNode;
}

/** Body for POST …/test-send. Capped server-side. */
export interface NewsletterTestSendBody {
  to: string[];
}

export interface NewsletterSendResultDTO {
  status: NewsletterIssueStatus;
  recipientTotal: number;
}

/** What POST /newsletter/issues/:id/assist can be asked for: a tighter draft,
 *  or editorial notes. Both are advisory — the route never writes the issue,
 *  and a rewrite only lands when the author saves it through the normal PATCH,
 *  which is also what keeps `sanitizeNewsletterDoc` and the audit sitting on
 *  the one write path. */
export type NewsletterAssistMode = "succinct" | "suggestions";

export const NEWSLETTER_ASSIST_MODES: readonly NewsletterAssistMode[] = ["succinct", "suggestions"];

/** One block the rewrite changed, as the review sheet shows it: the block's
 *  text before and after, in the same minimal Markdown the model was given
 *  (**bold**, *italic*, ~~strike~~, [label](url)). */
export interface NewsletterAssistChangeDTO {
  before: string;
  after: string;
}

export interface NewsletterAssistResultDTO {
  mode: NewsletterAssistMode;
  /** `succinct` only: the rewritten document, already run through
   *  `sanitizeNewsletterDoc`, or null when the model changed nothing. The
   *  client applies it to the editor only when the author accepts. */
  content: NewsletterNode | null;
  /** `succinct` only: what changed, block by block, for the review sheet. */
  changes: NewsletterAssistChangeDTO[];
  /** `suggestions` only: editorial notes, bounded in count and length
   *  server-side. Advice, never a document edit. */
  suggestions: string[];
}

export interface NewsletterSubscriberDTO {
  id: string;
  email: string;
  subscribed: boolean;
  createdAt: string;
}

/** Summary returned by POST /newsletter/subscribers/import. Counts are over the
 *  unique, valid addresses found in the pasted/uploaded list. */
export interface NewsletterSubscriberImportResultDTO {
  /** Addresses that had no row before — brand-new subscribers. */
  added: number;
  /** Addresses whose row existed but was unsubscribed, now re-subscribed. */
  resubscribed: number;
  /** Addresses that were already active subscribers — no change. */
  alreadyActive: number;
  /** Count of duplicate addresses collapsed within the input itself. */
  duplicates: number;
  /** Tokens that looked like an address but failed validation (capped). */
  invalid: string[];
  /** Total unique, valid addresses processed (added + resubscribed + alreadyActive). */
  total: number;
}

/** A member's own newsletter preference (GET/PUT /me/newsletter). */
export interface NewsletterSubscriptionDTO {
  subscribed: boolean;
}

/** One published issue's readership tallies (GET /newsletter/metrics).
 *  Aggregate page-load counts only — the counters hold no reader identity of
 *  any kind (migration 0042), so there is nothing finer to expose. */
export interface NewsletterIssueMetricsDTO {
  issueId: string;
  slug: string;
  title: string;
  publishedAt: string;
  sentAt: string | null;
  /** Page loads of the issue's public web page, all languages. */
  total: number;
  /** Page loads by reading language — a LOCALES code, or "other" for a
   *  translate-proxy target outside the site's own four. "en" is a direct
   *  (untranslated) read. */
  byLang: Record<string, number>;
}

/** GET /newsletter/metrics — readership of the public archive. */
export interface NewsletterMetricsDTO {
  /** Published issues, newest first, with their view tallies. */
  issues: NewsletterIssueMetricsDTO[];
  /** Views per school-local day across all issues, oldest first (recent window). */
  days: { day: string; views: number }[];
  /** Where readers went from an issue page, by destination hostname. */
  clicks: { dest: string; clicks: number }[];
  /** All-time page loads across every issue. */
  totalViews: number;
}

/** Branding needed to render a public page, without exposing sender identity. */
export interface NewsletterBrandingDTO {
  newsletterTitle: string;
  accentColor: string;
  logoUrl: string | null;
  /** Sanitized HTML footer. Public, like the rest of this DTO — nothing
   *  member-private may be put in a footer. */
  footerHtml: string;
  /** Public calendar site, e.g. "https://calendar.eisenhower.school", or "" to
   *  render no link. Every events block links out to it. Safe to expose on the
   *  public archive: the calendar's home screen is deliberately ungated. */
  calendarUrl: string;
}

export interface PublicNewsletterIssueSummaryDTO {
  slug: string;
  title: string;
  subtitle: string | null;
  /** ISO-8601. When the page went up — the archive's date and sort key. Only
   *  published issues are listed, so never null. An issue may be published
   *  without ever being emailed (migration 0031). */
  publishedAt: string;
  /** First few lines of body text, for the archive card and OG description. */
  excerpt: string;
}

/** One issue's reader-facing page — everything needed to render it, whether it
 *  was reached by a sent issue's public slug or by a review token.
 *
 *  Carries data, not pre-rendered HTML: the page runs the same shared renderer
 *  the email did, over the same content and snapshot.
 *
 *  THE public seam for issue pages, built field by field by `issuePageOf` in
 *  apps/api/src/lib/newsletter.ts — the companion to `publicEventOf` and
 *  `publicSheetOf`. Never build it by spreading a wider DTO, and read that
 *  function's comment before adding a field here: a column added to
 *  `newsletter_issue` must not be able to reach a reader until someone edits
 *  that projection on purpose. */
export interface NewsletterIssuePageDTO {
  /** The permanent archive URL's slug — null for an issue that isn't
   *  published, which has no `/n/` page of its own, only its token's. */
  slug: string | null;
  title: string;
  subtitle: string | null;
  status: NewsletterIssueStatus;
  sentAt: string | null;
  /** Null while unpublished — what decides the draft banner, not `status`. */
  publishedAt: string | null;
  /** For the "last edited …" line an unsent issue shows in place of a date. */
  updatedAt: string;
  /** First few lines of body text, for the OG description. */
  excerpt: string;
  content: NewsletterNode;
  /** Narrowed on read, like the public agenda. A sent issue's snapshot is
   *  FROZEN at send as full CalendarEventDTOs (that stored artifact stays
   *  byte-identical to what was mailed — invariant 10) and an unsent one's is
   *  resolved live, but either way an issue page is readable without a session,
   *  so both go out through `publicEventOf`. Without that, an issue page would
   *  be a second, quieter way to read seriesId/recurrenceId. See invariant 12. */
  eventsSnapshot: Record<string, PublicCalendarEventDTO[]>;
  branding: NewsletterBrandingDTO;
}

export interface PublicNewsletterArchiveDTO {
  issues: PublicNewsletterIssueSummaryDTO[];
  branding: NewsletterBrandingDTO;
}

/** Branding on its own, for a public page that isn't showing an issue — the
 *  subscribe form. Same narrowing as everywhere else: `brandingOf` is the only
 *  thing that builds a NewsletterBrandingDTO, so sender identity can't leak
 *  into a page just because a new page needed a masthead. */
export interface PublicNewsletterBrandingDTO {
  branding: NewsletterBrandingDTO;
}

/** What a pending double opt-in confirmation reveals: the address it was mailed
 *  to, so the confirm page can show whose subscription is about to start.
 *
 *  Holding the token is what authorizes seeing this, exactly as with the
 *  unsubscribe token — the token went to that address and nowhere else. */
export interface PublicNewsletterConfirmationDTO {
  email: string;
}

// ── Store ─────────────────────────────────────────────────────────────────

/** One buyable size/colour of a product.
 *
 *  `id` is OURS — a ULID minted at first import and preserved across every
 *  re-sync — not Printful's numeric variant id, which never leaves the server.
 *  That is what lets the whole catalog be re-pointed at a different Printful
 *  store (this instance starts on a personal one and moves to the PTO's)
 *  without invalidating a cart someone left open or a line on a past order.
 *
 *  Price is per variant because Printful charges more for 2XL/3XL; a single
 *  product price would mean eating that or charging small sizes for it. */
export interface StoreVariantDTO {
  id: string;
  label: string;
  imageUrl: string | null;
  inStock: boolean;
  priceCents: number;
}

/** Admin's view of one overlay row. */
export interface StoreProductDTO {
  id: string;
  printfulSyncProductId: string;
  slug: string;
  /** Resolved: the admin's override, else Printful's own product name. */
  title: string;
  /** Printful's name, shown beside the override so an admin can see both. */
  printfulTitle: string;
  titleOverride: string | null;
  blurb: string | null;
  imageUrl: string | null;
  published: boolean;
  sortOrder: number;
  variants: StoreVariantDTO[];
  syncedAt: string;
  updatedAt: string;
}

/** What a storefront visitor may see of a variant. Hand-written, not a `Pick<>`
 *  of StoreVariantDTO, for the reason invariant 12 gives: a field added to the
 *  admin shape must not reach an anonymous reader until someone edits this on
 *  purpose. Today the two happen to match; that is not a licence to alias them. */
export interface PublicStoreVariantDTO {
  id: string;
  label: string;
  imageUrl: string | null;
  inStock: boolean;
  priceCents: number;
}

/** THE storefront projection — the companion to `publicEventOf`,
 *  `publicSheetOf` and `issuePageOf`, built field by field by `publicProductOf`
 *  and never by spreading a StoreProductDTO or a row.
 *
 *  Deliberately absent: `id` and `printfulSyncProductId` (a shopper addresses a
 *  product by slug and a variant by our variant id — Printful's own ids are
 *  server-side mapping, invariant 26), `published`/`sortOrder`/`syncedAt`
 *  (merchandising bookkeeping), and anything about wholesale cost or margin,
 *  which has no column here at all and therefore no path to one. */
export interface PublicStoreProductDTO {
  slug: string;
  title: string;
  blurb: string | null;
  imageUrl: string | null;
  variants: PublicStoreVariantDTO[];
  /** Cheapest variant, so a catalog tile can say "from $24" without the caller
   *  reducing over `variants` and getting it subtly different each time. */
  fromPriceCents: number;
}

/** One line of a cart, a quote or an order. The same shape at all three stages
 *  on purpose: a quote freezes the cart, an order freezes the quote, and a
 *  shape that changed between them would be a place for a price to drift. */
export interface StoreLineDTO {
  productId: string;
  variantId: string;
  title: string;
  variantLabel: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
}

/** What the client asks to be priced. Note what it does NOT carry: a price.
 *  Every amount in a quote is read server-side from `store_product`. */
export interface StoreCartItemInput {
  variantId: string;
  quantity: number;
}

export interface StoreAddressInput {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  /** Two-letter state/province code — Printful wants `state_code`. */
  state: string;
  postalCode: string;
  /** ISO-3166-1 alpha-2. */
  country: string;
  phone?: string | null;
}

/** One shipping option Printful offered for this cart and address. */
export interface StoreShippingRateDTO {
  /** Printful's own rate id ("STANDARD"), echoed back verbatim at order time
   *  so the method we quoted is the method we buy. */
  id: string;
  label: string;
  amountCents: number;
  /** Printful's own delivery estimate text, when it gave one. */
  deliveryEstimate: string | null;
}

export interface StoreShippingRatesDTO {
  lines: StoreLineDTO[];
  subtotalCents: number;
  rates: StoreShippingRateDTO[];
  currency: string;
}

/** A priced, signed, single-use quote. `token` is opaque to the client — an
 *  HMAC-signed payload it stores and echoes back at checkout, never inspects.
 *  The other fields are the same numbers, unsigned, purely so the cart can
 *  render a total without decoding anything. */
export interface StoreQuoteDTO {
  token: string;
  expiresAt: string;
  lines: StoreLineDTO[];
  subtotalCents: number;
  shippingLabel: string;
  shippingCents: number;
  totalCents: number;
  currency: string;
}

/** POST /store-public/checkout — where to send the buyer. */
export interface StoreCheckoutDTO {
  checkoutUrl: string;
}

export type StoreOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "submitting"
  | "submitted"
  | "shipped"
  | "fulfillment_failed"
  | "abandoned";

/** What a BUYER is told, which is not the internal enum. `submitting` and
 *  `submitted` are the same fact to someone waiting for a parcel, and
 *  `fulfillment_failed` must not read as "we lost your money" when the answer
 *  is that a person is about to look at it. */
export type PublicStoreOrderStatus = "processing" | "shipped" | "problem";

/** The token-gated order page, built by `orderStatusOf`.
 *
 *  Never carries: the order id, `userId`, the Stripe session/payment-intent
 *  ids, `printfulOrderId`, `submitAttempts`, `lastSubmitError`, Printful's raw
 *  `fulfillmentStatus`, or the status-token hash. Same discipline as
 *  `issuePageOf`, and for the same reason — the row holds a live bearer
 *  capability, so a spread would publish it on an enumerable page. */
export interface PublicStoreOrderDTO {
  status: PublicStoreOrderStatus;
  lines: StoreLineDTO[];
  subtotalCents: number;
  shippingLabel: string;
  shippingCents: number;
  totalCents: number;
  currency: string;
  /** Enough to recognise the parcel's destination, not the full address. */
  shipTo: { name: string; city: string; state: string; postalCode: string };
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  placedAt: string | null;
  shippedAt: string | null;
}

/** Admin order list/detail. Hand-written too, for the same reason: the row
 *  carries `status_token_hash`, and a spread would hand an admin screen a live
 *  capability onto a buyer's order page. */
export interface StoreOrderDTO {
  id: string;
  status: StoreOrderStatus;
  userId: string | null;
  email: string;
  lines: StoreLineDTO[];
  shippingAddress: StoreAddressInput;
  subtotalCents: number;
  shippingLabel: string;
  shippingCents: number;
  totalCents: number;
  currency: string;
  stripePaymentIntentId: string | null;
  printfulOrderId: string | null;
  submitAttempts: number;
  lastSubmitError: string | null;
  fulfillmentStatus: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  paidAt: string | null;
  submittedAt: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One Printful sync product as the admin's import screen sees it, merged with
 *  whether we already carry it. */
export interface StorePrintfulCatalogItemDTO {
  printfulSyncProductId: string;
  name: string;
  thumbnailUrl: string | null;
  variantCount: number;
  /** The store_product id, when this design is already imported. */
  importedAs: string | null;
}

/** Body for PATCH /store/products/:id. Every field optional — an admin edits
 *  one thing at a time and an absent key means "leave it". */
export interface StoreProductPatchBody {
  titleOverride?: string | null;
  blurb?: string | null;
  sortOrder?: number;
  published?: boolean;
  /** Per-variant prices, by our variant id. Variants omitted keep their price. */
  variantPrices?: Record<string, number>;
}

// ── PTO planning boards ────────────────────────────────────────────────────
//
// A board per event or initiative, columns down it, cards in the columns, and
// directory Persons assigned to the cards (migration 0024).
//
// THE THING TO KNOW ABOUT THIS SECTION: unlike the calendar, the newsletter and
// the store, there is exactly ONE audience here and therefore exactly ONE set of
// shapes. Every type below is members-and-PTO-board only. There is no
// `PublicPtoBoardDTO`, no `/pto-public/*` router and no projection function, and
// that absence is the design rather than an omission — a board carries vendor
// notes, money and half-finished opinions, and the cheapest way to guarantee
// none of it is ever published is for the public seam not to exist at all.
// If a public surface is ever wanted, it needs a hand-written projection built
// field by field the way `publicEventOf` and `publicSheetOf` are, and this
// comment is where to start reading.

/** A colour token from the small fixed label palette. A NAME, never a hex value:
 *  the client maps it to CSS variables, so labels answer to dark mode like
 *  everything else. */
export type PtoLabelColor = "blue" | "orange" | "green" | "red" | "purple" | "slate";

export const PTO_LABEL_COLORS: PtoLabelColor[] = [
  "blue",
  "orange",
  "green",
  "red",
  "purple",
  "slate",
];

/** Whether this caller may use the boards at all, and what they may do.
 *
 *  Resolved server-side by `ptoAccess` in apps/api/src/lib/ptoBoard.ts. The
 *  client reads it to choose between the boards and the "you're not on the PTO
 *  board" card; it is a UI convenience, and every route is independently gated. */
export interface PtoAccessDTO {
  /** True when the caller is a system admin, or controls a Person on the PTO
   *  board group's roster. */
  canUse: boolean;
  /** System admins configure which group is the PTO board. */
  isSystemAdmin: boolean;
  /** Name of the configured group, for the "you're not on the PTO board" copy.
   *  Null when no group has been configured yet — the bootstrap state, in which
   *  only system admins are admitted. */
  groupName: string | null;
  /** Null until a system admin names a group. */
  groupId: string | null;
}

/** Somebody a card can be assigned to. Always a directory Person, resolved
 *  through the enumeration gate (invariant 21) — see `PtoCardDTO.assignees`. */
export interface PtoPersonDTO {
  id: string;
  /** Last-name-rule-applied, like every other name that crosses the wire. */
  displayName: string;
  /** True when this is a Person the viewing User controls. */
  isYou: boolean;
}

export interface PtoLabelDTO {
  id: string;
  name: string;
  color: PtoLabelColor;
}

export interface PtoCommentDTO {
  id: string;
  body: string;
  /** Who wrote it — their first controlled Person's display name, else their
   *  email. Resolved server-side; a comment is speech by an account. */
  authorName: string;
  /** True when the viewer wrote it, and may therefore delete it. */
  isYou: boolean;
  createdAt: string;
}

export interface PtoCardDTO {
  id: string;
  listId: string;
  title: string;
  description: string | null;
  /** ISO-8601 UTC, optional. */
  dueAt: string | null;
  position: number;
  /** Who is doing it.
   *
   *  An assignee whose Person row the enumeration gate withholds still appears,
   *  with `id: null` and a generic label — the same answer `personLabel` gives a
   *  Slack channel (invariant 22). Reporting a withheld Person and a
   *  nonexistent one identically is what stops this list becoming an oracle for
   *  `unlisted_at`; dropping the entry entirely would instead advertise that a
   *  claimed card is unclaimed, which is invariant 21's `filled`-count problem
   *  in another costume. */
  assignees: Array<PtoPersonDTO | { id: null; displayName: string; isYou: false }>;
  labelIds: string[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PtoListDTO {
  id: string;
  title: string;
  position: number;
  cards: PtoCardDTO[];
}

/** A board in the index — no lists or cards, just enough to render a tile. */
export interface PtoBoardDTO {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  position: number;
  archived: boolean;
  /** Set when the board names a managed calendar event. The DATE is resolved
   *  live from the series (invariant 8) and is never stored on the board. */
  event: PtoBoardEventDTO | null;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The calendar event a board is about, as the board renders it.
 *
 *  `seriesId` is the durable `managed_event` id, which is safe here in a way it
 *  is not in `PublicCalendarEventDTO` (invariant 12 withholds it from anonymous
 *  responses precisely because it addresses member signup data) — this response
 *  requires a session AND PTO-board membership.
 *
 *  `path` is minted by `eventPath` in @sd/shared against the SCHOOL's timezone,
 *  because it is built server-side where there is no reader zone to use. */
export interface PtoBoardEventDTO {
  seriesId: string;
  title: string;
  /** ISO-8601 UTC start of the next occurrence at or after now; falls back to
   *  the most recent one when the whole series is in the past. */
  start: string | null;
  allDay: boolean;
  /** `/e/:date/:slug` on the calendar site, or null when no occurrence
   *  resolves. */
  path: string | null;
}

/** One board, with everything on it. Served in a single payload — a board is
 *  tens of cards, and a per-list fetch would be several D1 round trips to
 *  assemble a screen that is useless in pieces. */
export interface PtoBoardDetailDTO extends PtoBoardDTO {
  lists: PtoListDTO[];
  labels: PtoLabelDTO[];
}

/** What a board delete is about to remove, counted BEFORE it happens.
 *
 *  Its own route rather than a field on `PtoBoardDetailDTO`, so opening a board
 *  doesn't pay for four counts nobody reads — the shape invariant 25 settled on
 *  for `GET /persons/:id/removal-impact`, and for the same reason: none of it
 *  is countable afterwards. */
export interface PtoBoardImpactDTO {
  lists: number;
  cards: number;
  assignees: number;
  comments: number;
}

// Request bodies.

export interface PtoBoardInput {
  title: string;
  summary?: string | null;
  managedEventId?: string | null;
}

export interface PtoBoardPatchBody {
  title?: string;
  summary?: string | null;
  managedEventId?: string | null;
  archived?: boolean;
}

export interface PtoListInput {
  title: string;
}

export interface PtoCardInput {
  listId: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
}

export interface PtoCardPatchBody {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  labelIds?: string[];
  archived?: boolean;
}

/** Where a card is going. The neighbours are named rather than an index, so the
 *  server computes the midpoint itself and two clients working from slightly
 *  stale copies of the column can't disagree about what "index 3" meant. */
export interface PtoCardMoveBody {
  listId: string;
  /** The card this one should land AFTER, or null for the top of the column. */
  afterCardId?: string | null;
  /** The card this one should land BEFORE, or null for the bottom. */
  beforeCardId?: string | null;
}

/** A managed event a board may be pointed at, for the picker. */
export interface PtoEventOptionDTO {
  seriesId: string;
  title: string;
  start: string;
  calendarName: string;
}

// ── Lost & found ─────────────────────────────────────────────────────────────
//
// lostandfound.eisenhower.school. Staff photograph what turns up at school, a
// vision model describes it, and anyone can browse and say "that's mine". See
// invariant 33 in CLAUDE.md and the header of migration 0033.

/** The categories the vision model must choose from, and the browse filter.
 *  Parent-facing words, short on purpose: a filter row nobody can scan is a
 *  filter nobody uses. */
export const LF_CATEGORIES = [
  "Water bottle",
  "Lunch box",
  "Jacket or coat",
  "Sweatshirt or hoodie",
  "Clothing (other)",
  "Hat, gloves, or scarf",
  "Shoes or boots",
  "Backpack or bag",
  "Electronics",
  "Glasses",
  "Jewelry or accessory",
  "Toy",
  "Book or school supplies",
  "Sports equipment",
  "Other",
] as const;
export type LfCategory = (typeof LF_CATEGORIES)[number];

/** Colour words the model must choose from. Each app's swatch map must cover
 *  every one; an unknown colour falls back to grey rather than breaking. */
export const LF_COLORS = [
  "black",
  "white",
  "gray",
  "silver",
  "red",
  "pink",
  "orange",
  "yellow",
  "gold",
  "green",
  "blue",
  "navy",
  "purple",
  "brown",
  "tan",
  "multicolor",
] as const;
export type LfColor = (typeof LF_COLORS)[number];

/** A found item as ANYONE on the internet sees it — built field by field by
 *  `publicItemOf`, never by spreading a row (invariant 12's rule).
 *
 *  What is missing is the point. `visibleText` (whatever the model read off
 *  the item) and `nameText` (the person's name in that writing — on a school
 *  jacket, usually a child's) are staff-only (invariant 33). So are who
 *  uploaded it, its claims, and its tagging state beyond "still being
 *  described". Non-name writing may surface in the description and tags, so a
 *  brand stays searchable; a name never does. */
export interface LfPublicItemDTO {
  id: string;
  title: string;
  description: string;
  category: string;
  colors: string[];
  brand: string;
  material: string;
  tags: string[];
  location: string;
  /** ISO-8601 UTC. */
  foundAt: string;
  /** The model hasn't described it yet; the photo is all there is. */
  pending: boolean;
  photoUrl: string;
  thumbUrl: string;
}

export interface LfPublicListDTO {
  items: LfPublicItemDTO[];
  /** Another page exists. Always false for a search, which returns its best
   *  matches in one go. */
  hasMore: boolean;
  /** How many items are listed in all, ignoring any search or filter — the
   *  "N items are waiting" line up top. A count over exactly the public gate,
   *  so it discloses nothing browsing doesn't. */
  total: number;
  /** How many items have ever been returned to their owners, counted from the
   *  audit log (item rows are swept after a return; the log isn't), net of
   *  staff undoing a return. A bare all-time count, nothing per-item. */
  returnedTotal: number;
}

/** POST /lostfound-public/items/:id/claims. `website` is a honeypot: a person
 *  never sees the field, so anything in it is a script. */
export interface LfClaimInput {
  name: string;
  contact: string;
  /** The child the item belongs to, if the claimant is naming one (migration
   *  0043). Optional — the item may be the claimant's own. Free text for the
   *  office; staff-only like every other claim field. */
  childName?: string;
  /** That child's teacher or room, so the office can send the item back
   *  through the classroom. Optional free text; staff-only. */
  teacher?: string;
  message?: string;
  website?: string;
  /** The UI language the claim form was filled in (migration 0044), so the
   *  return notification can answer in it. Bucketed to LOCALES on write —
   *  anything else stores as "en" — so the field can't carry free text. */
  lang?: string;
}

export type LfItemStatus = "found" | "returned";
export type LfTagStatus = "pending" | "tagged" | "failed";

/** Degrees CLOCKWISE that would stand a photo upright — the vision model's
 *  suggestion (migration 0035). 0 is "upright, or it couldn't tell". */
export const LF_ROTATIONS = [0, 90, 180, 270] as const;
export type LfRotation = (typeof LF_ROTATIONS)[number];

/** A found item as STAFF see it. */
export interface LfStaffItemDTO extends Omit<LfPublicItemDTO, "pending"> {
  status: LfItemStatus;
  tagStatus: LfTagStatus;
  tagError: string | null;
  /** All writing the model read off the item. Staff-only; any writing keeps
   *  the item held until staff publish. */
  visibleText: string;
  /** The person's name within that writing, if any (migration 0038). Staff-only,
   *  and the only words scrubbed from the public title/description/tags. */
  nameText: string;
  /** Hidden from the public listing by staff (a face in frame, a duplicate). */
  hiddenAt: string | null;
  /** Held back until staff publish it: every item starts held, and the model
   *  releases it only if it read no writing on it — the PHOTO could show a
   *  child's name (invariant 33). Non-null while the model is still looking,
   *  after it read something, or after it failed. */
  heldAt: string | null;
  returnedAt: string | null;
  /** How far the model thinks the photo needs turning, clockwise. Cleared when
   *  staff rotate it. A suggestion only — staff apply it with one tap. */
  suggestedRotation: LfRotation;
  /** Unclaimed long enough that it's time to donate it (LF_DONATE_AFTER_DAYS). */
  donateDue: boolean;
  openClaims: number;
  /** Added by a signed-in member who isn't on the staff roster. Such an item
   *  stays held until staff publish it, whatever the model read. */
  memberSubmitted: boolean;
  createdByEmail: string | null;
  updatedAt: string;
}

export interface LfClaimDTO {
  id: string;
  itemId: string;
  itemTitle: string;
  thumbUrl: string;
  name: string;
  contact: string;
  /** Whose child the item is, as the claimant typed it ("" when they didn't
   *  say). A child's name: staff screens only, like `name` and `contact`. */
  childName: string;
  /** The child's teacher or room, as typed ("" when not given). */
  teacher: string;
  message: string;
  /** The claim form's UI language (migration 0044) — what language the return
   *  notification goes out in, and what the dashboard's prefilled manual
   *  message is written in. */
  lang: Locale;
  /** True when the claimant was signed in and the contact IS that account's
   *  email, checked server-side at submit time (migration 0044). The staff
   *  queue shows it as a "verified" chip: this address has already received a
   *  magic link, so a notification to it reaches a real inbox. */
  contactVerified: boolean;
  /** When the return notification email went out (migration 0044); null for
   *  never, including every phone-contact claim. */
  notifiedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: "returned" | "dismissed" | null;
}

export interface LfStaffItemDetailDTO extends LfStaffItemDTO {
  claims: LfClaimDTO[];
}

/** Why one past or present item looks like another (staff-only). */
export type LfSimilarReason = "look" | "color" | "brand" | "writing";

/** One earlier or concurrent item that resembles another, from the fingerprint
 *  index (migration 0046). Staff-only: `returnedTo`/`returnedRoom` are a child's
 *  name and room. `itemId`/`thumbUrl` are null once the item itself has been
 *  swept (30 days after a return) — the fingerprint outlives it, the photo
 *  does not. */
export interface LfSimilarDTO {
  itemId: string | null;
  /** The item is still in the lost & found right now. */
  here: boolean;
  title: string;
  category: string;
  colors: string[];
  brand: string;
  thumbUrl: string | null;
  foundAt: string;
  returnedAt: string | null;
  /** Who it went home to, as the claimant typed it ("" when unknown). */
  returnedTo: string;
  returnedRoom: string;
  /** 0..1, higher is more alike. */
  score: number;
  reasons: LfSimilarReason[];
}

/** A cluster of items that keep turning up: same kind of thing, found again
 *  and again. Newest member first. */
export interface LfRepeatGroupDTO {
  /** The most recent member's title, the cluster's label. */
  title: string;
  category: string;
  count: number;
  firstFoundAt: string;
  lastFoundAt: string;
  /** Distinct "went home to" values across the members, as typed. */
  returnedTo: string[];
  items: LfSimilarDTO[];
}

/** PATCH /lostfound/items/:id — every editable field, sent whole. */
export interface LfItemPatch {
  title: string;
  description: string;
  category: string;
  colors: string[];
  brand: string;
  material: string;
  visibleText: string;
  nameText: string;
  tags: string[];
  location: string;
}

/** GET /lostfound/access — `PtoAccessDTO`'s shape, for the same reason. */
export interface LfAccessDTO {
  canUse: boolean;
  isSystemAdmin: boolean;
  groupName: string | null;
  groupId: string | null;
}

/** GET /lostfound/settings — the lost & found's admin-editable configuration
 *  beyond the staff group (which rides `LfAccessDTO`). */
export interface LfSettingsDTO {
  /** Addresses mailed the moment a public claim is stored — typed by a system
   *  admin on the settings screen. The message names the item and links to the
   *  staff queue; claimant details stay behind the session (lib/email.ts). */
  claimNotifyEmails: string[];
}

/** Most addresses `claimNotifyEmails` may hold — a notification list, not a
 *  mailing list. */
export const LF_CLAIM_NOTIFY_MAX = 10;

/** Days after which an unclaimed item is flagged for donation. */
export const LF_DONATE_AFTER_DAYS = 120;

// ── Bingo (apps/bingo, migration 0040) ────────────────────────────────────

/** The live board — the whole of it. Served to ANYONE by
 *  GET /bingo-public/state: the game is 75 numbers and which have been called,
 *  so unlike every sibling public DTO there is nothing to withhold — but the
 *  projection in lib/bingo.ts is still hand-built, field by field, so a column
 *  added to `bingo_state` later does not reach the public response until
 *  someone decides it should. */
export interface BingoStateDTO {
  /** Numbers called so far, 1–75, in call order. */
  markedNumbers: number[];
  /** The ball on display. Always one of `markedNumbers`, or null. */
  currentNumber: number | null;
  /** Null only before the first game is ever played. */
  updatedAt: string | null;
}

/** PUT /bingo/state — the whole board, replaced. Full state rather than a
 *  toggle delta so a retry after a dropped write is trivially safe
 *  (last-write-wins, invariant 28's `position` reasoning). */
export interface BingoStateInput {
  markedNumbers: number[];
  currentNumber: number | null;
}

// ── Audit ─────────────────────────────────────────────────────────────────

/** Actions captured in the append-only audit log (FR-31). */
export type AuditAction =
  /** A `user` row was created by someone signing in for the first time — the
   *  self-serve half of joining, where `admin.action` op `user.create` is the
   *  half an admin performs. Recorded at the INSERT in /auth/callback, which
   *  had no entry of its own before: the account existing is a bigger fact than
   *  any single sign-in, and `auth.signin` (pushed moments later in the same
   *  request) could not distinguish the first one from the thousandth. There is
   *  no actor — nobody was signed in yet — so the row's actor column is null by
   *  construction, exactly as `newsletter.subscribed` is. */
  | "auth.registered"
  | "auth.signin"
  | "auth.signout"
  /** An account asked to read the directory (migration 0029, invariant 32).
   *  Pushed by POST /me/access-request, which is idempotent while pending, so
   *  one row is one ASKING rather than one tap — the rule invariants 27 and 28
   *  state for a repeated placement and a re-dropped card. `detail.resubmitted`
   *  distinguishes a first application from one made again after a decline,
   *  which is the only thing the row cannot be re-derived from later: the dates
   *  on `user` keep the latest of each, never the sequence. */
  | "access.requested"
  /** An admin decided. Two actions rather than one with a field, because the
   *  question asked of this log is almost always "who let them in" — and
   *  approving promotes the applicant's self-asserted classroom placements to
   *  trusted (invariant 27), which is a second effect worth naming separately
   *  from a decline that has none. */
  | "access.approved"
  | "access.declined"
  | "invite.sent"
  | "invite.accepted"
  | "control.granted"
  | "control.revoked"
  | "masquerade.start"
  | "masquerade.stop"
  | "share.created"
  | "share.revoked"
  | "bulk.import"
  | "registration.toggled"
  | "notify.toggled"
  | "calendar.source.created"
  | "calendar.source.updated"
  | "calendar.source.deleted"
  | "calendar.refreshed"
  | "calendar.managed.created"
  | "calendar.managed.updated"
  | "calendar.managed.deleted"
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  /** An occurrence's photo-album link was set or changed / cleared. `detail`
   *  carries the occurrence date only — the URL is a capability (migration 0045)
   *  and an audit row is forever. Slack-silent by default. */
  | "calendar.album.set"
  | "calendar.album.cleared"
  | "newsletter.issue.created"
  | "newsletter.issue.updated"
  | "newsletter.issue.deleted"
  | "newsletter.issue.sent"
  | "newsletter.issue.retried"
  /** Its public page went up or came down without a send (migration 0031).
   *  A send that publishes as a side effect records `newsletter.issue.sent`
   *  only — one act, one row. */
  | "newsletter.issue.published"
  | "newsletter.issue.unpublished"
  /** A review link was minted (or re-minted, invalidating the previous one) or
   *  revoked. Deliberately not the generic share.created/share.revoked above:
   *  those belong to routes/shares.ts, which grants a Person or Group sight of
   *  a private contact field. This is a bearer URL onto one issue — a different
   *  mechanism with a different blast radius, and worth telling apart in a log
   *  someone reads after the fact. */
  | "newsletter.issue.preview_link_created"
  | "newsletter.issue.preview_link_revoked"
  | "newsletter.media.uploaded"
  /** Someone completed double opt-in from the public form. Anonymous — there is
   *  no session on that route — so the actor column is null and the confirmed
   *  address is the only identity the row carries. */
  | "newsletter.subscribed"
  | "newsletter.test_sent"
  | "newsletter.settings.updated"
  /** A system admin named (or cleared) the group whose roster may author the
   *  newsletter — `pto.group.configured`'s twin, the single lever over who may
   *  write to every subscriber's inbox. */
  | "newsletter.editors.configured"
  | "newsletter.subscriber.added"
  | "newsletter.subscriber.imported"
  | "newsletter.subscriber.removed"
  | "newsletter.subscription.toggled"
  | "volunteer.sheet.created"
  | "volunteer.sheet.updated"
  /** An orphaned sheet moved onto another of its event's dates BY HAND — the
   *  repair for what `reanchorSheets` could not place automatically. Its own
   *  action rather than `updated` because it relocates everyone already signed
   *  up, and the date it left is not recorded anywhere else. */
  | "volunteer.sheet.moved"
  | "volunteer.sheet.deleted"
  | "volunteer.position.created"
  | "volunteer.position.updated"
  | "volunteer.position.deleted"
  // Signup create/delete are member actions, not admin ones — the only entries
  // in this log an ordinary member generates. They are recorded because a spot
  // changing hands is exactly the kind of thing someone later asks about.
  | "volunteer.signup.created"
  | "volunteer.signup.deleted"
  /** The reminder cron mailed a sheet's volunteers, two evenings before the
   *  event (lib/volunteerReminders.ts, migration 0041). No actor — a cron is
   *  not a person. `detail` keeps the counts; the addresses it reached are
   *  never recorded anywhere. */
  | "volunteer.reminder.sent"
  /** An admin proofed the reminder — `newsletter.test_sent`'s twin. Mails only
   *  the addresses the admin typed (default: their own), touches no
   *  `reminder_sent_at`, and is Slack-silent like every other test. */
  | "volunteer.reminder.test_sent"
  /** A Person was added to the directory. The companion to `person.updated`,
   *  which was for a long time the only thing said about a Person at all — so a
   *  row appearing was invisible to this log while every later edit to it was
   *  recorded. `control.granted` is pushed in the same request (the creator
   *  always controls what they create) but means something else, and would not
   *  fire for a Person created any other way. Bulk imports do NOT push this:
   *  `bulk.import` already reports the batch, and one draft per row would make
   *  a 200-child import 200 entries saying nothing the summary doesn't. */
  | "person.created"
  /** A Person was removed from the directory by a Controller, with everything
   *  hanging off them (contacts, memberships, shares, volunteer spots). The one
   *  member-initiated destructive act in this system, and unrecoverable, so the
   *  row's `detail` carries the NAME and the counts — nothing else will hold
   *  them a minute later. That detail is also why this action is deliberately
   *  absent from `slackNotify`'s FORMATTERS: a formatter must resolve a name
   *  through `personLabel` (invariant 22), and there is no longer a `person` row
   *  for that gated lookup to find, so the only way to name them in a channel
   *  would be to forward the unfiltered one from the draft. Silence is correct. */
  | "person.deleted"
  | "person.updated"
  /** A Controller placed one of their own Persons in a classroom, or took them
   *  out of one. The second and third member-initiated actions in this log,
   *  after the volunteer signup pair, and recorded for the same reason: a child
   *  appearing on or vanishing from a roster is exactly what someone asks about
   *  later, and no other row would hold it — `membership` keeps no history.
   *  A move is ONE `classroom.enrolled` carrying the rooms it left in `detail`,
   *  not an unenroll and an enroll, because it is one act.
   *  Neither is Slack-curated. A parent sorting their own child into the right
   *  room is routine in invariant 22's sense — the same line that keeps
   *  `person.updated` out — and it runs once per child per year, which is a
   *  channel nobody reads. */
  | "classroom.enrolled"
  | "classroom.unenrolled"
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  /** Anything an admin changes about the catalog — an import, a publish or
   *  unpublish, a price, a sort, a title or blurb. One action for all of it,
   *  the same economy `newsletter.settings.updated` uses: these are edits to a
   *  merchandising surface the admin is already looking at, and splitting them
   *  five ways would say nothing `detail` doesn't. Not Slack-curated, for the
   *  reason invariant 22 keeps `person.updated` out. */
  | "store.product.updated"
  /** Money arrived. The store's `auth.registered` — it fires once in an order's
   *  life, where the transitions around it fire on machine schedules — and one
   *  of only two store actions that reach Slack. Pushed from the Stripe webhook
   *  the moment the guarded UPDATE claims the row, never after the reads that
   *  build the confirmation email: those can fail on their own, and then a sale
   *  that really happened would have no audit row (invariant 22's ordering
   *  rule, and the reason test/storeCheckout.test.ts pins it). */
  | "store.order.paid"
  /** The parcel is moving, with tracking on it. Recorded even though
   *  `store_order` already holds the status, because it is a real-world event
   *  with an outbound email attached and the guarded transition that fires it
   *  is what stops a redelivered Printful webhook mailing a buyer twice. */
  | "store.order.shipped"
  /** Charged and not printed, after the retry budget is spent. The only store
   *  action that needs a human, and the second of the two that reach Slack. */
  | "store.order.fulfillment_failed"
  /** An admin cleared a given-up order for another attempt. Rare, deliberate,
   *  and the one lever anybody has over a charged-but-unprinted order — so who
   *  pressed it belongs in the log, exactly as `newsletter.issue.retried`
   *  records the same shape of act. Not Slack-curated: the channel already said
   *  the order failed, and an admin acting on that is the expected next step
   *  rather than news. */
  | "store.order.retried"
  /** The PTO's planning boards (migration 0024). One family, and NONE of it is
   *  Slack-curated — `FORMATTERS` in lib/slackNotify.ts is a
   *  `Partial<Record<AuditAction, …>>`, so an action with no entry already sends
   *  nothing, and that default is the right answer here for the reason
   *  invariant 22 keeps `person.updated` out: a board is where routine work
   *  happens, cards move several times a day while an event is being organised,
   *  and a channel that narrated it would be a channel nobody reads. The log
   *  still wants the rows — "who archived the Read-A-Thon board" is exactly the
   *  question asked six months later, and nothing else in the schema would hold
   *  the answer, since a delete here is a real delete.
   *
   *  Card TITLES stay in `detail` and never reach `notify`, which is moot while
   *  there is no formatter and deliberate anyway: `notify` is the bag a route
   *  fills in by hand for export, and a board's contents are not for export. */
  | "pto.board.created"
  | "pto.board.updated"
  | "pto.board.deleted"
  | "pto.list.created"
  | "pto.list.updated"
  | "pto.list.deleted"
  | "pto.card.created"
  | "pto.card.updated"
  /** A card changed column. Its own action rather than a `pto.card.updated`
   *  carrying a `list_id`, because it is the one card event somebody
   *  reconstructing a timeline actually looks for — the same reason
   *  `classroom.enrolled` is one row for a move rather than an unenroll and an
   *  enroll. Re-dropping a card where it already sits writes nothing and pushes
   *  no draft: an append-only log must not be paddable by a jittery mouse. */
  | "pto.card.moved"
  | "pto.card.deleted"
  /** The assignee SET was replaced. One row per PUT, not one per person added
   *  or removed: the client sends the whole set, so that is the act. */
  | "pto.card.assigned"
  | "pto.comment.created"
  | "pto.comment.deleted"
  /** A system admin named (or re-named) the group whose roster may use the
   *  boards. Rare, deliberate, and the single lever over who gets in — the
   *  same shape of act `registration.toggled` records. */
  | "pto.group.configured"
  /** Lost & found (migration 0033). Staff acts on items — none Slack-curated:
   *  a morning's uploads would be a dozen lines nobody needs. The AI's own
   *  tagging writes no row; it is a machine filling in fields, and a retry
   *  per failure would pad the log (invariant 5). */
  | "lostfound.item.created"
  | "lostfound.item.updated"
  /** Staff released a held item to the public listing — they've checked the
   *  photo shows no name. Not pushed when the model releases one itself. */
  | "lostfound.item.published"
  | "lostfound.item.hidden"
  | "lostfound.item.unhidden"
  | "lostfound.item.returned"
  | "lostfound.item.restored"
  | "lostfound.item.retagged"
  | "lostfound.item.deleted"
  /** Somebody said "that's mine". Anonymous — no session on that route — so
   *  the actor is null, as `newsletter.subscribed`'s is. The one lost & found
   *  action that reaches Slack, because it is the one that needs a human; the
   *  line names no claimant and no item text (invariant 22). */
  | "lostfound.claim.created"
  | "lostfound.claim.dismissed"
  /** Staff marked an item returned against a claim and the system mailed the
   *  claimant that it's on its way (routes/lostFound.ts). `detail` carries the
   *  item id and the return method only — the claimant's address, like every
   *  claim field, stays out of a row that lives forever. Slack-silent
   *  (FORMATTERS' default): the human act it records is already the
   *  `lostfound.item.returned` next to it. */
  | "lostfound.claim.return_notified"
  /** A system admin named the group whose roster runs the lost & found. */
  | "lostfound.staff.configured"
  /** A system admin changed who is emailed when a claim arrives. `detail`
   *  carries the count only — the addresses are readable from the setting, and
   *  an audit row is forever. */
  | "lostfound.claim_notify.configured"
  /** The bingo board changed (migration 0040) — a number toggled, or the game
   *  reset. One action for both: `detail` carries the counts, and a reset is
   *  legible as `marked` dropping to 0. One row per PUT, which is one tap
   *  during a game — human-paced like a PTO card move, so it is recorded
   *  per-act rather than coalesced per sitting (invariant 5), and like
   *  `pto.card.moved` it is not Slack-curated: a game night would be seventy
   *  lines nobody reads. A no-op PUT (the state unchanged) writes nothing and
   *  pushes no draft — the log must not be paddable by a double tap. */
  | "bingo.updated"
  | "admin.action";

// THE audit → Slack seam (invariant 22).
//
// Every other projection in this codebase — `publicEventOf`, `publicSheetOf`,
// `issuePageOf` — withholds data from a less-privileged reader INSIDE the
// system. This one faces a THIRD PARTY. A Slack channel has its own retention,
// its own search, its own export, and its own membership list that grows later
// without asking us. So a value that is perfectly safe to write into
// `audit_log` — which only a system admin ever reads, through a route we
// control — is not thereby safe to send here.
//
// Two mechanisms keep that honest, and neither relies on anyone remembering:
//
//  1. FORMATTERS is a curated `Partial<Record<AuditAction, …>>`. An action with
//     no entry sends nothing, which is the default for every action in the
//     union, including one added to it after this file was last touched — the
//     same property invariant 12 gives the public calendar projection. The
//     `satisfies` still catches a misspelled action name at compile time.
//
//  2. A formatter's input type, `SlackFormatInput`, has NO `detail` field. That
//     is the whole defence against forwarding the raw blob: there is nothing to
//     forward, because it is not in scope. `calendar.source.created` is the
//     case that forced this — it puts the feed's `url` in `detail`, and that
//     may be a secret Google/Outlook subscribe link (invariant 12).
//
// What a formatter may say instead comes from exactly three places: the
// entity's own id, the `notify` bag a route curated by hand at the push site,
// and the two shared lookups below.

import type { AuditAction } from "@sd/shared";
import { eventPath, resolveTimeZone } from "@sd/shared";
import type { Env } from "../env.js";
import type { AuditDraft, AuditMeta } from "./audit.js";
import { displayName, personListableSql } from "./privacy.js";
import { postToSlack } from "./slack.js";

/** The reader this channel represents, expressed as a viewer of the roster.
 *
 *  Nobody: not a system admin, controlling no Person. That is the honest
 *  description — a channel is not a person, and it holds no session — and it is
 *  what makes `personListableSql` below collapse to `unlisted_at IS NULL`, so
 *  an unlisted Person's row simply never comes back and `personLabel` renders
 *  the generic form instead of their name.
 *
 *  Deliberately NOT `personListableSql(x, true)`: passing `isSystemAdmin: true`
 *  short-circuits the seam to the literal `"1"`, which reads like a guard,
 *  satisfies test/personListable.test.ts's scan, and gates nothing. */
const NO_VIEWER = "";


/** What a Person is called in this channel.
 *
 *  Composes `personListableSql` rather than re-deriving the rule, so this call
 *  site is a GUARDED read of `person` under invariant 21, not an exempt one —
 *  it spends none of that test's exemption budget and stays under its scan.
 *
 *  An unlisted Person is withheld here for the reason invariant 21 gives and
 *  one Slack adds: the flag is reversible and a channel is not. A name posted
 *  today outlives the family's decision to come off the roster tomorrow.
 *  `last_name_visibility` is applied on top, with `viewerIsController` false —
 *  nothing about being read from Slack grants a Controller's extra trust. */
export async function personLabel(env: Env, personId: string): Promise<string> {
  const listable = personListableSql(NO_VIEWER, false);
  const row = await env.DB.prepare(
    `SELECT first_name, last_name, last_name_visibility
       FROM person
      WHERE id = ? AND ${listable.sql}`,
  )
    .bind(personId, ...listable.binds)
    .first<{ first_name: string; last_name: string | null; last_name_visibility: "full" | "initial" }>();
  // Covers both "no such Person" and "withheld", on purpose: telling those two
  // apart in the message would make the channel an oracle for the flag.
  if (!row) return "A member";
  return displayName(row.first_name, row.last_name, row.last_name_visibility, false);
}

/** Slack mrkdwn is not HTML, but `&`, `<` and `>` still carry meaning — `<…|…>`
 *  is a link. Member-entered text (names, event and position titles, a
 *  newsletter subject) is escaped so it cannot forge one. Same reasoning as
 *  `esc` in lib/email.ts. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A Slack link. The label is escaped; the URL is ours, never member-entered. */
function link(url: string, label: string): string {
  return `<${url}|${esc(label)}>`;
}

// ── The formatter contract ──────────────────────────────────────────────────

/** Scalars only. A route may not smuggle a row in here by widening the value
 *  type — if a formatter needs a name, it looks it up through the gated helper
 *  above rather than being handed one. */
export type NotifyBag = Readonly<Record<string, string | number | boolean | null>>;

export interface SlackFormatInput {
  /** This action's entity id. Safe on its own — an opaque ULID — but note it
   *  may name a row that is already GONE: `calendar.source.deleted` runs its
   *  DELETE before the draft is flushed. Anything a deletion takes away has to
   *  travel in `notify` instead. */
  entityId: string | null;
  /** What the pushing route decided, by name, may leave the system. Empty
   *  unless that route set `AuditDraft.notify`. */
  notify: NotifyBag;
  /** The acting human — "dana@school.edu", or "admin@school.edu (as
   *  dana@school.edu)" during a masquerade. */
  actor: string;
  env: Env;
}

/** Returns one line of Slack mrkdwn, or null to decline this instance — which
 *  is how `admin.action`, a fifteen-way catch-all, reports only the four ops
 *  that belong in a channel. */
type SlackFormatter = (input: SlackFormatInput) => Promise<string | null> | string | null;

function str(bag: NotifyBag, key: string, fallback = "(unknown)"): string {
  const v = bag[key];
  return typeof v === "string" && v ? esc(v) : fallback;
}
function num(bag: NotifyBag, key: string): number {
  const v = bag[key];
  return typeof v === "number" ? v : 0;
}

/** Integer cents → "$24.00". The store is the only thing here that talks about
 *  money, and it is single-currency (migration 0022). */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** " on Oct 17" — the date an event starts, or "" when the bag has no usable
 *  one. Read in SCHOOL_TIMEZONE, never the Worker's UTC: a 7pm event would
 *  otherwise report the following day for half the year. */
function whenOf(env: Env, bag: NotifyBag): string {
  const start = typeof bag.start === "string" ? bag.start : null;
  if (!start) return "";
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  // All-day values are stored at UTC midnight and must be read back that way.
  const timeZone = bag.allDay === true ? "UTC" : resolveTimeZone(env.SCHOOL_TIMEZONE);
  try {
    return ` on ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d)}`;
  } catch {
    return "";
  }
}

/** " on Oct 17" for an arbitrary key, where `whenOf` reads the fixed `start`.
 *  Same zone rule and the same "" on anything unusable. */
function dayOf(env: Env, bag: NotifyBag, key: string): string {
  const v = bag[key];
  if (typeof v !== "string") return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return ` ${new Intl.DateTimeFormat("en-US", { timeZone: resolveTimeZone(env.SCHOOL_TIMEZONE), month: "short", day: "numeric" }).format(d)}`;
  } catch {
    return "";
  }
}

/** The event's own page, when we can address it. Built from the same content
 *  identity the calendar app mints (`eventPath`), in the school's zone since a
 *  Worker has no reader timezone — the lookup searches ±1 day, so the two
 *  agreeing to within a day is enough. */
/** A volunteer sheet's public page. The slug is the durable handle a sheet has
 *  precisely so a link needn't carry the occurrence pair (invariant 12). */
function sheetLink(env: Env, bag: NotifyBag): string {
  const slug = typeof bag.slug === "string" ? bag.slug : null;
  if (!env.CALENDAR_URL || !slug) return "";
  return ` ${link(`${env.CALENDAR_URL}/v/${slug}`, "Open sheet")}`;
}

/** One line about a Person moving on or off a group's roster.
 *
 *  Shared by the three `member.*` ops because they differ only in verb, and
 *  because both lookups they need — the gated name and the group — should
 *  happen in exactly one place rather than three. */
async function rosterLine(
  input: SlackFormatInput,
  icon: string,
  verb: string,
): Promise<string> {
  const { env, entityId, notify, actor } = input;
  const [who, group] = await Promise.all([
    personLabel(env, String(notify.personId ?? "")),
    groupLabel(env, entityId),
  ]);
  return `${icon} *${esc(who)}* ${verb} *${esc(group?.name ?? "a group")}* — ${actor}.`;
}

function eventLink(env: Env, bag: NotifyBag): string {
  const title = typeof bag.title === "string" ? bag.title : null;
  const start = typeof bag.start === "string" ? bag.start : null;
  if (!env.CALENDAR_URL || !title || !start) return "";
  const path = eventPath(
    { title, start, allDay: bag.allDay === true },
    resolveTimeZone(env.SCHOOL_TIMEZONE),
  );
  return ` ${link(`${env.CALENDAR_URL}${path}`, "Open event")}`;
}

// ── The allowlist ───────────────────────────────────────────────────────────
//
// Curated for a school PTO's channel: things that are rare, or security-
// relevant, or that someone is actively waiting to hear. Two whole families are
// deliberately absent and should stay absent unless the reasoning changes:
//
//   Routine member traffic — auth.signin/signout, person.updated, contact.*,
//   share.* — is the highest-frequency thing in the log and would bury
//   everything else. Note the line this draws: `auth.signin` fires every time
//   somebody opens the app and stays off; `auth.registered` fires once in an
//   account's life and is on. Same for `person.created` against
//   `person.updated`. Arrival is news; existing is not.
//
//   Authoring CRUD — calendar.managed.*, volunteer.sheet.*,
//   volunteer.position.*, newsletter.issue.updated — fires once per HTTP
//   REQUEST, and the coalescing below only merges drafts within one request.
//   Building a sheet with six positions is six requests, so it would be six
//   messages however this file batches. newsletter.issue.updated was the worst
//   of them, firing on every autosave; migration 0020 collapsed it to one row
//   per editing sitting, and it stays out anyway — "an admin opened a draft" is
//   not news to a channel, only the send is.
//
// `calendar.event.*` was in that second family and was moved OUT of it by an
// explicit decision, against the advice above — the whole of an event's CRUD
// now posts, updates included. Know what that buys: an admin filling in a term
// generates one message per save, and re-saving the same event five times is
// five messages, because there is no dedupe across requests and this file will
// not grow one. If the channel gets noisy, `calendar.event.updated` is the
// entry to drop first; `created` and `deleted` are the rare, consequential
// halves, and deleting an event destroys volunteer signups with it.

const FORMATTERS = {
  // ── Joining: an account, or a Person on the roster ──
  //
  // Both are "someone new is here", which is the thing a PTO channel actually
  // wants to see. Note what each may say. A new USER is identified by email:
  // `user.email` carries no enumeration gate (invariant 21 is a rule about
  // `person`), and `actorLabel` already puts admin addresses in this channel.
  // A new PERSON is identified through `personLabel`, never from `notify` — so
  // an unlisted Person reads as "A member" and a withheld surname stays an
  // initial, the same treatment a volunteer signup gets.
  "auth.registered": ({ notify }) => {
    // No actor: nobody was signed in when the row was written, which is the
    // honest description of a self-serve signup and why this is not phrased as
    // something an admin did.
    const how = notify.via === "invite" ? "accepted an invitation" : "signed up";
    return `:wave: *${str(notify, "email")}* ${how} — new account.`;
  },

  /**
   * Somebody is waiting for a human (invariant 32).
   *
   * This is the one line in this file that deliberately names NOBODY — no
   * address, no child, no room. That is not caution, it is the shape of the
   * data: the applicant's claim is their child's name and their teacher, which
   * is the most sensitive thing this feature touches, and a channel is a third
   * party with its own retention, search and export. The three `access.*`
   * drafts carry no `notify` bag at all, so a formatter here has nothing
   * identifying in scope even if a later edit wanted it — the same defence
   * invariant 22 gets from a formatter's input type having no `detail` field.
   *
   * It earns its place because it is the one event in this feature that needs
   * a person to DO something, and because `auth.registered` beside it no
   * longer implies it: since 0029, signing up does not get anyone into the
   * directory, so a channel that reported arrivals and nothing else would be
   * silent on the only actionable step. The queue screen is where the claim is
   * read; this is a nudge to go and read it.
   *
   * Its siblings stay off. `access.approved` and `access.declined` are the
   * answer to this one and are already visible to whoever is working the
   * queue, and a decision per applicant is the per-event noise the allowlist
   * exists to keep out (invariant 22's counting rule).
   */
  "access.requested": ({ notify }) =>
    notify.resubmitted === true
      ? `:mailbox: A family corrected their details and asked for directory access again — one to review.`
      : `:mailbox: A family asked for directory access — one to review.`,

  "person.created": async ({ env, entityId, actor }) => {
    const who = await personLabel(env, entityId ?? "");
    return `:bust_in_silhouette: *${who}* was added to the directory — ${actor}.`;
  },

  /** A User gained control of a Person — but ONLY when that is news.
   *
   *  A self-grant is the second half of creating your own child's listing, and
   *  `person.created` above already reported it from the same request; saying
   *  it twice in one message is noise, not detail. So this speaks for the other
   *  case only: somebody ELSE accepted an invitation and can now manage that
   *  Person — a second parent joining a listing, which is a real change in who
   *  holds a family's data and worth seeing. Declining an instance is what a
   *  formatter returning null is for. */
  "control.granted": async ({ env, entityId, notify, actor }) => {
    if (notify.self === true) return null;
    const who = await personLabel(env, entityId ?? "");
    return `:handshake: ${actor} can now manage *${who}*'s listing.`;
  },

  "invite.sent": async ({ env, entityId, notify, actor }) => {
    const who = await personLabel(env, entityId ?? "");
    return `:envelope: ${actor} invited *${str(notify, "email")}* to help manage *${who}*'s listing.`;
  },

  // ── Volunteer sheets and the positions on them ──
  //
  // The authoring side; `volunteer.signup.*` below is the member side. Low
  // volume in practice — a sheet is built once and then filled — which is why
  // these are here at all despite firing one request at a time.
  "volunteer.sheet.created": ({ env, notify, actor }) =>
    `:clipboard: Volunteer sheet opened for *${str(notify, "eventTitle")}*` +
    `${notify.published === false ? " (draft)" : ""} — ${actor}.${sheetLink(env, notify)}`,

  "volunteer.sheet.updated": ({ env, notify, actor }) =>
    // Publishing is the transition worth naming: it is what puts the sheet in
    // front of members, where every other edit is bookkeeping.
    `:clipboard: Volunteer sheet for *${str(notify, "eventTitle")}* ` +
    `${notify.published === true ? "published" : "updated"} — ${actor}.${sheetLink(env, notify)}`,

  "volunteer.sheet.deleted": ({ notify, actor }) =>
    // No link: the sheet's page is exactly what stopped resolving.
    `:wastebasket: Volunteer sheet for *${str(notify, "eventTitle")}* deleted — ${actor}.`,

  "volunteer.position.created": ({ notify, actor }) =>
    `:heavy_plus_sign: *${str(notify, "title")}* (${num(notify, "slots")} needed) added to the ` +
    `*${str(notify, "eventTitle")}* sheet — ${actor}.`,

  "volunteer.position.updated": ({ notify, actor }) =>
    `:pencil2: Position *${str(notify, "title")}* on the *${str(notify, "eventTitle")}* sheet ` +
    `updated — ${actor}.`,

  "volunteer.position.deleted": ({ notify, actor }) =>
    // The position is gone before this runs and its title was never carried
    // out, so this names the sheet rather than the spot. Deliberate: recovering
    // the title would cost a second read of a row that no longer exists, on a
    // route that fires a few times a year.
    `:heavy_minus_sign: A position was removed from the *${str(notify, "eventTitle")}* sheet — ${actor}.`,

  // ── Calendar events: the whole of one series' CRUD ──
  //
  // Everything these say travels in `notify`, never `detail`, for the reason
  // invariant 22 gives — and for a second one specific to deletes: the row is
  // already gone by the time the draft is flushed, so a title this did not
  // carry could not be looked up afterwards at all.
  //
  // Only created/updated get a link. A deleted event's page is exactly what no
  // longer resolves (the URL is a content identity — invariant 8), so linking
  // it would send readers to the "event not found" card.
  "calendar.event.created": ({ env, notify, actor }) =>
    `:calendar: New event *${str(notify, "title")}*${whenOf(env, notify)}` +
    ` — ${actor}.${eventLink(env, notify)}`,

  "calendar.event.updated": ({ env, notify, actor }) => {
    // The one edit worth more than a line: moving an event carries its
    // volunteer sheets onto the new date (`reanchorSheets`), and the people
    // already signed up are moved without being asked or told. The channel is
    // where that gets said out loud. Counts only — a sheet's slug is the
    // capability that opens it, and this is a third party.
    const sheets = num(notify, "sheetsMoved");
    const signups = num(notify, "signupsMoved");
    const carried = sheets
      ? ` — ${sheets} volunteer sheet${sheets === 1 ? "" : "s"}` +
        (signups ? ` and ${signups} sign-up${signups === 1 ? "" : "s"}` : "") +
        " moved with it"
      : "";
    return (
      `:pencil2: Event *${str(notify, "title")}* edited${whenOf(env, notify)}${carried}` +
      ` — ${actor}.${eventLink(env, notify)}`
    );
  },

  "calendar.event.deleted": ({ notify, actor }) => {
    const signups = num(notify, "signups");
    // The sting in the tail: a delete cascades through volunteer sheets, and
    // the people who had claimed those spots are never told (see the admin's
    // own confirmation copy). If anyone was signed up, the channel says so.
    const took = signups
      ? `, taking ${signups} volunteer sign-up${signups === 1 ? "" : "s"} with it`
      : "";
    return (
      `:wastebasket: Event *${str(notify, "title")}* deleted` +
      ` (${num(notify, "occurrences")} date${num(notify, "occurrences") === 1 ? "" : "s"}${took})` +
      ` — ${actor}.`
    );
  },

  /** Rare and consequential, which is the bar this list is curated to: it fires
   *  when an admin repairs a sheet the automatic re-anchor could not place, and
   *  it relocates everyone already signed up. Twice a year at most — counted
   *  before adding it, the way invariant 22 says to. */
  "volunteer.sheet.moved": ({ env, notify }) => {
    const signups = num(notify, "signups");
    const who = signups
      ? `, taking ${signups} sign-up${signups === 1 ? "" : "s"} with it`
      : "";
    return (
      `:calendar: A volunteer sheet moved${dayOf(env, notify, "from")} →` +
      `${dayOf(env, notify, "to") || " another date"}${who}.`
    );
  },

  // ── Volunteering: the one member-initiated action worth watching live ──
  "volunteer.signup.created": async ({ env, notify }) => {
    const who = await personLabel(env, String(notify.personId ?? ""));
    const where = env.CALENDAR_URL ? ` ${link(`${env.CALENDAR_URL}/v/${notify.sheetSlug}`, "View sheet")}` : "";
    return (
      `:raising_hand: *${esc(who)}* signed up for *${str(notify, "positionTitle")}*` +
      ` — ${str(notify, "eventTitle")} (${num(notify, "filled")}/${num(notify, "slots")} filled).${where}`
    );
  },

  "volunteer.signup.deleted": async ({ env, notify }) => {
    const who = await personLabel(env, String(notify.personId ?? ""));
    const where = env.CALENDAR_URL ? ` ${link(`${env.CALENDAR_URL}/v/${notify.sheetSlug}`, "View sheet")}` : "";
    return (
      `:leftwards_arrow_with_hook: *${esc(who)}* gave back *${str(notify, "positionTitle")}*` +
      ` — ${str(notify, "eventTitle")} (${num(notify, "filled")}/${num(notify, "slots")} filled).${where}`
    );
  },

  /** The two-evenings-before reminder went out (lib/volunteerReminders.ts).
   *  No actor — a cron is not a person, so it is phrased as a thing that
   *  happened, like the store's webhook lines. Counts and the event's public
   *  title only: the addresses it reached are exactly what may not cross this
   *  seam. The zero-recipient form is the line that needs a human — everyone
   *  on the sheet was unreachable. One line per event with volunteers, a few
   *  a month (invariant 22's counting rule). */
  "volunteer.reminder.sent": ({ env, notify }) => {
    const n = num(notify, "recipients");
    if (n === 0) {
      return (
        `:alarm_clock: Volunteer reminder for *${str(notify, "eventTitle")}*${whenOf(env, notify)}` +
        ` found no reachable addresses.${sheetLink(env, notify)}`
      );
    }
    return (
      `:alarm_clock: Volunteer reminder sent to ${n} address${n === 1 ? "" : "es"}` +
      ` for *${str(notify, "eventTitle")}*${whenOf(env, notify)}.${sheetLink(env, notify)}`
    );
  },

  // ── Newsletter: the two "it actually left the building" events ──
  "newsletter.issue.sent": async ({ env, entityId, notify, actor }) => {
    const issue = await issueLabel(env, entityId);
    const read = issue && env.NEWSLETTER_URL ? ` ${link(`${env.NEWSLETTER_URL}/n/${issue.slug}`, "Read it")}` : "";
    return (
      `:mailbox_with_mail: Newsletter *${esc(issue?.title ?? "(untitled)")}* sent to` +
      ` ${num(notify, "recipientTotal")} subscribers — ${actor}.${read}`
    );
  },

  // A page going up without a send is the same "left the building" event for
  // the web half — public, indexed, linkable — and rarer than a send. Coming
  // down is worth a line too: it breaks links people may already be holding.
  "newsletter.issue.published": async ({ env, entityId, actor }) => {
    const issue = await issueLabel(env, entityId);
    const read = issue && env.NEWSLETTER_URL ? ` ${link(`${env.NEWSLETTER_URL}/n/${issue.slug}`, "Read it")}` : "";
    return `:globe_with_meridians: Newsletter *${esc(issue?.title ?? "(untitled)")}* published on the web — ${actor}.${read}`;
  },

  "newsletter.issue.unpublished": async ({ env, entityId, actor }) => {
    const issue = await issueLabel(env, entityId);
    return `:no_entry_sign: Newsletter *${esc(issue?.title ?? "(untitled)")}* taken off the web — ${actor}.`;
  },

  "newsletter.issue.retried": async ({ env, entityId, actor }) => {
    const issue = await issueLabel(env, entityId);
    return `:arrows_counterclockwise: Retrying delivery of *${esc(issue?.title ?? "(untitled)")}* — ${actor}.`;
  },

  // ── Instance-level admin: rare, wide blast radius ──
  "bulk.import": ({ notify, actor }) =>
    `:inbox_tray: *Roster import* — ${num(notify, "rows")} rows → ${num(notify, "personsCreated")} people,` +
    ` ${num(notify, "groupsCreated")} groups, ${num(notify, "accountsCreated")} accounts,` +
    ` ${num(notify, "invitesQueued")} invites queued (${num(notify, "emailsAttempted")} to email) — ${actor}.`,

  "registration.toggled": ({ notify, actor }) =>
    `:door: Registration ${notify.open === true ? "*opened*" : "*closed*"} — ${actor}.`,

  // ── Security ──
  "masquerade.start": ({ notify, actor }) =>
    `:eyes: ${actor} started masquerading as *${str(notify, "targetEmail")}*.`,

  /** The catch-all, dispatched on the `op` its route curated into `notify`.
   *  Only these four ops reach the channel; every other op (group.create,
   *  member.add, bootstrap_admin, …) declines by falling through to null. */
  "admin.action": (input) => {
    const { notify, actor } = input;
    const email = str(notify, "email");
    switch (notify.op) {
      case "user.disabled":
        return `:no_entry: *${email}* was removed from the directory — ${actor}.`;
      case "user.enabled":
        return `:white_check_mark: *${email}* was restored — ${actor}.`;
      case "user.deleted":
        // Permanent, so worth the channel — the email only, the same identifier
        // the disable/enable lines carry and no name looked up (the Persons it
        // took are gone by the time this renders anyway).
        return `:wastebasket: *${email}* was permanently deleted — ${actor}.`;
      case "user.admin.granted":
        return `:key: *${email}* was made a system admin — ${actor}.`;
      case "user.admin.revoked":
        return `:key: *${email}* is no longer a system admin — ${actor}.`;
      case "user.create":
        // The admin-created half of joining; `auth.registered` above is the
        // self-serve half. `joined_via = 'admin'` keeps this one out of the
        // new-member EMAIL digest, deliberately — but a channel is where an
        // admin acting on someone else's behalf is worth seeing.
        return (
          `:heavy_plus_sign: *${email}* was added as a user — ${actor}` +
          `${notify.emailSent === false ? " (no invitation sent)" : ""}.`
        );
      // Backup and restore. Both are rare, both are the loudest things an admin
      // can do here, and neither carries anything but counts — the bag has no
      // name, no email and no table contents in it, which is the point of
      // `notify` being a second bag rather than `detail` (invariant 22).
      case "backup.exported":
        return (
          `:floppy_disk: A full backup of the directory was downloaded ` +
          `(${num(notify, "rows")} rows across ${num(notify, "tables")} tables) — ${actor}.`
        );
      case "backup.restored":
        // The one line in this file worth waking somebody for: the database was
        // replaced. Pushed before the write, so this fires even if the restore
        // dies part-way — which is exactly when somebody needs to know.
        return (
          `:rotating_light: The database was RESTORED from a backup ` +
          `(${num(notify, "rows")} rows across ${num(notify, "tables")} tables) — ${actor}.`
        );
      case "group.create":
        return `:busts_in_silhouette: New ${str(notify, "kind", "group")} *${str(notify, "name")}* created — ${actor}.`;
      // Roster membership. `entityId` is the group; the Person travels as a
      // ULID in `notify` so the name goes through the gate like every other.
      case "member.add":
        return rosterLine(input, ":heavy_plus_sign:", "added to");
      case "member.remove":
        return rosterLine(input, ":heavy_minus_sign:", "removed from");
      case "member.update":
        return rosterLine(input, ":pencil2:", "had their role changed in");
      default:
        return null;
    }
  },

  // ── Calendar feeds ──
  "calendar.source.created": async ({ env, entityId, actor }) => {
    // The name is READ BACK from the row, never taken from `detail` — which
    // here holds the feed's `url`, possibly a secret subscribe link
    // (invariant 12). The formatter cannot see `detail` at all; this comment
    // records why that mattered enough to shape the type.
    const row = entityId
      ? await env.DB.prepare("SELECT name FROM calendar_source WHERE id = ?")
          .bind(entityId)
          .first<{ name: string }>()
      : null;
    return `:calendar: Calendar feed added: *${esc(row?.name ?? "(unknown)")}* — ${actor}.`;
  },

  "calendar.source.deleted": ({ notify, actor }) =>
    // No lookup possible: the row is gone by the time this runs, which is why
    // its route captures the name into `notify` before the delete.
    `:calendar: Calendar feed removed: *${str(notify, "name")}* — ${actor}.`,

  // ── Store ──
  //
  // Two of the store's four actions, and the split is the one this whole
  // allowlist keeps making: a sale is an arrival, and a charged-but-unprinted
  // order needs a human. The other two stay out for the reasons that keep
  // `person.updated` out — `store.product.updated` is an admin editing a screen
  // they are already looking at, and `store.order.shipped` is already emailed to
  // the person who actually cares.
  //
  // Note what these lines may NOT say. `notify` carries scalars a route named by
  // hand, and neither of these routes put a buyer's name or street address in
  // it. That is not restraint at the formatter — a formatter cannot see `detail`
  // at all, so the name simply is not in scope here. A Slack channel has its own
  // retention, export and membership list (invariant 22), and "a sale happened,
  // this big, to this town" is the whole of what a PTO channel needs.
  //
  // There is no actor on either: a webhook and a cron are not people, so both
  // are phrased as things that happened rather than things somebody did.

  "store.order.paid": ({ notify }) => {
    const where = [str(notify, "city", ""), str(notify, "state", "")].filter(Boolean).join(", ");
    const items = num(notify, "itemCount");
    return (
      `:shopping_trolley: Store order — ${money(num(notify, "totalCents"))}` +
      `, ${items} item${items === 1 ? "" : "s"}` +
      (where ? ` — ${where}.` : ".")
    );
  },

  "store.order.fulfillment_failed": ({ entityId, notify }) =>
    `:rotating_light: Store order \`${esc(entityId ?? "(unknown)")}\` was PAID (${money(
      num(notify, "totalCents"),
    )}) but Printful refused it after ${num(notify, "attempts")} attempts — it needs a person.`,

  // ── Lost & found ─────────────────────────────────────────────────────────

  /** "That's mine." The only lost & found action in this map, because it is
   *  the only one that needs a person. It names no claimant and no item text —
   *  the route hands this formatter an empty `notify`, and the item's own words
   *  may include a child's name (invariant 33). */
  "lostfound.claim.created": () => `:raising_hand: Someone said "that's mine" on a lost & found item — one to look at.`,
} satisfies Partial<Record<AuditAction, SlackFormatter>>;

// ── Shared lookups ──────────────────────────────────────────────────────────

/** A group's name and kind.
 *
 *  A plain lookup with no gate, and that is a deliberate reading of invariant
 *  21 rather than an oversight: `unlisted_at` withholds a PERSON, not a Group,
 *  and that invariant says so — group-level hiding was considered and not
 *  built. It reads `grp` alone and joins no `person`, so it is outside the
 *  scope of test/personListable.test.ts's scan entirely. The Person on the
 *  other half of a roster line still goes through `personLabel`. */
async function groupLabel(
  env: Env,
  groupId: string | null,
): Promise<{ name: string; kind: string } | null> {
  if (!groupId) return null;
  return env.DB.prepare("SELECT name, kind FROM grp WHERE id = ?")
    .bind(groupId)
    .first<{ name: string; kind: string }>();
}

/** A newsletter issue's title and slug. Safe to read back: unlike a deleted
 *  calendar source, an issue still exists when it is sent or retried. */
async function issueLabel(
  env: Env,
  issueId: string | null,
): Promise<{ title: string; slug: string } | null> {
  if (!issueId) return null;
  return env.DB.prepare("SELECT title, slug FROM newsletter_issue WHERE id = ?")
    .bind(issueId)
    .first<{ title: string; slug: string }>();
}

/** The acting human. `user.email` carries no enumeration gate — invariant 21 is
 *  a rule about `person`, not `user` — so this is the same plain lookup
 *  GET /admin/audit already does to render its actor column.
 *
 *  Resolved from `meta.actorUserId` (the REAL human) rather than from
 *  `c.var.auth.email` (the EFFECTIVE one), because those differ during a
 *  masquerade and the admin is the one who acted. Both ids come back in one
 *  statement. */
async function actorLabel(env: Env, meta: AuditMeta): Promise<string> {
  if (!meta.actorUserId) return "someone signed out";
  const ids = meta.masqueradingAs ? [meta.actorUserId, meta.masqueradingAs] : [meta.actorUserId];
  const rows = await env.DB.prepare(
    `SELECT id, email FROM user WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ id: string; email: string }>();
  const byId = new Map(rows.results.map((r) => [r.id, r.email]));
  const actor = esc(byId.get(meta.actorUserId) ?? "(unknown)");
  if (!meta.masqueradingAs) return actor;
  return `${actor} (as ${esc(byId.get(meta.masqueradingAs) ?? "(unknown)")})`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** How many lines one message may carry before the rest are summarised. Not a
 *  rate limit — the allowlist above is what keeps the volume down — just a
 *  ceiling so a future endpoint that loops `audit.push` over rows can't post a
 *  thousand-line wall. */
const MAX_LINES = 20;

/** Build the Slack lines for one request's worth of audit drafts.
 *
 *  Exported for tests: this is the seam whose behaviour is worth pinning, and
 *  it is pure apart from the two lookups above. Returns [] when nothing in the
 *  batch is curated, which is the common case. */
export async function slackLinesOf(
  env: Env,
  drafts: readonly AuditDraft[],
  meta: AuditMeta,
): Promise<string[]> {
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so "toString"
  // would match, resolve to `Object.prototype.toString`, and — called as a
  // formatter — return the truthy string "[object Object]" straight into the
  // channel. Unreachable while every push site uses an `AuditAction` literal,
  // but "an action with no entry sends nothing" is either true of any string or
  // it is not a property worth claiming.
  const curated = drafts.filter((d) => Object.hasOwn(FORMATTERS, d.action));
  if (!curated.length) return [];

  // One lookup for the whole batch rather than one per line.
  const actor = await actorLabel(env, meta);

  const lines: string[] = [];
  for (const draft of curated) {
    const formatter = FORMATTERS[draft.action as keyof typeof FORMATTERS] as SlackFormatter;
    const line = await formatter({
      entityId: draft.entityId ?? null,
      notify: draft.notify ?? {},
      actor,
      env,
    });
    if (line) lines.push(line);
  }
  return lines;
}

/** Fire-and-forget entry point, called from the audit middleware with the whole
 *  request's drafts.
 *
 *  Coalesces to ONE post per request: `c.var.audit` is already the batch, and a
 *  handler that pushes two curated drafts should read as one event in the
 *  channel rather than two. Never throws — a Slack failure must not affect the
 *  audit write, and a dropped message is cosmetic where a dropped audit row is
 *  not (invariant 5), which is why the two share no machinery. */
export async function notifySlackForAudit(
  env: Env,
  drafts: readonly AuditDraft[],
  meta: AuditMeta,
): Promise<void> {
  try {
    const lines = await slackLinesOf(env, drafts, meta);
    if (!lines.length) return;
    const shown = lines.slice(0, MAX_LINES);
    if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more.`);
    // One line posts as itself; several post as a bulleted list.
    const text = shown.length === 1 ? shown[0]! : shown.map((l) => `• ${l}`).join("\n");
    await postToSlack(env, { text });
  } catch (err) {
    console.error(`[slack] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

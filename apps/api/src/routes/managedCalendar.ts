// Managed calendars + their events (system admins). Mounted under /admin
// alongside routes/admin.ts, which keeps the imported-feed CRUD.
//
// Authorization is system-admin-only for now; `created_by` is recorded on every
// row so per-calendar editor delegation can be added later without a migration.

import { Hono } from "hono";
import type {
  ManagedCalendarInput,
  ManagedEventInput,
  VolunteerPositionInput,
  VolunteerSheetInput,
} from "@sd/shared";
import { normalizeEmail } from "../lib/db.js";
import { isEmail } from "../lib/newsletter.js";
import { sendEmailResult } from "../lib/email.js";
import { buildTestReminder } from "../lib/volunteerReminders.js";
import type { HonoEnv } from "../env.js";
import type { AuditDraft } from "../lib/audit.js";
import { requireAuth } from "../middleware/session.js";
import {
  createManagedCalendar,
  createManagedEvent,
  deleteManagedCalendar,
  deleteManagedEvent,
  listManagedCalendars,
  listManagedEvents,
  managedCalendarRemovalImpact,
  loadCalendar,
  loadManagedEvent,
  ManagedEventError,
  updateManagedCalendar,
  updateManagedEvent,
} from "../lib/managedCalendar.js";
import {
  createPosition,
  createSheet,
  deletePosition,
  deleteSheet,
  listOccurrences,
  moveSheet,
  loadSheetForAdmin,
  sheetVolunteerEmails,
  updatePosition,
  updateSheet,
  VolunteerError,
} from "../lib/volunteers.js";

export const managedCalendar = new Hono<HonoEnv>();

/** Our own origin, used to build the published .ics URL we hand back to clients. */
function apiOrigin(url: string): string {
  return new URL(url).origin;
}

/** Authored-input failures become a 400 carrying the message, so the admin UI can
 *  show why a recurrence (or a volunteer position) was rejected. Anything else
 *  propagates to app.onError. */
function invalid(err: unknown): { error: string; message: string } | null {
  return err instanceof ManagedEventError || err instanceof VolunteerError
    ? { error: "invalid_body", message: err.message }
    : null;
}

// ── Calendars ───────────────────────────────────────────────────────────────

/** GET /admin/managed-calendars — every managed calendar with its event count. */
managedCalendar.get("/managed-calendars", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ calendars: await listManagedCalendars(c.env, apiOrigin(c.req.url)) });
});

/** GET /admin/managed-calendars/:id — one calendar, for its detail page. */
managedCalendar.get("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const calendar = await loadCalendar(c.env, c.req.param("id"), apiOrigin(c.req.url));
  if (!calendar) return c.json({ error: "not_found" }, 404);
  return c.json({ calendar });
});

/** POST /admin/managed-calendars { name, color?, description? }. */
managedCalendar.post("/managed-calendars", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<ManagedCalendarInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const calendar = await createManagedCalendar(c.env, body, auth.userId, apiOrigin(c.req.url));
    c.var.audit.push({
      action: "calendar.managed.created",
      entityKind: "managed_calendar",
      entityId: calendar.id,
      detail: { name: calendar.name },
    });
    return c.json({ calendar }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** PATCH /admin/managed-calendars/:id { name?, color?, description? }. */
managedCalendar.patch("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<Partial<ManagedCalendarInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const calendar = await updateManagedCalendar(c.env, c.req.param("id"), body, apiOrigin(c.req.url));
    if (!calendar) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "calendar.managed.updated",
      entityKind: "managed_calendar",
      entityId: calendar.id,
    });
    return c.json({ calendar });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** GET /admin/managed-calendars/:id/removal-impact — what the DELETE below
 *  would take with it, before it is done rather than after it is regretted.
 *
 *  Its own route rather than fields on ManagedCalendarDTO, for the reason
 *  GET /persons/:id/removal-impact is its own route: the calendars list would
 *  pay four counts a row that nothing renders. Read at the confirmation, so the
 *  numbers are the ones true when the admin is looking at them — and re-counted
 *  by the DELETE regardless, which trusts none of this. */
managedCalendar.get("/managed-calendars/:id/removal-impact", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const impact = await managedCalendarRemovalImpact(c.env, c.req.param("id"));
  if (!impact) return c.json({ error: "not_found" }, 404);
  return c.json({ impact });
});

/** DELETE /admin/managed-calendars/:id — removes its events, their volunteer
 *  sheets and their occurrences too. What went is recorded on the audit row:
 *  once the rows are gone the id resolves to nothing, so an entry saying only
 *  which id was deleted says almost nothing. */
managedCalendar.delete("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const removed = await deleteManagedCalendar(c.env, id);
  if (!removed) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "calendar.managed.deleted",
    entityKind: "managed_calendar",
    entityId: id,
    detail: { ...removed },
  });
  return c.json({ ok: true, removed });
});

// ── Events ──────────────────────────────────────────────────────────────────

/** GET /admin/managed-calendars/:id/events — the editable series rows (not the
 *  expanded occurrences, which members read via /calendar/events). */
managedCalendar.get("/managed-calendars/:id/events", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ events: await listManagedEvents(c.env, c.req.param("id")) });
});

/** POST /admin/managed-calendars/:id/events — create an event and materialize
 *  its occurrences immediately, so it shows in the agenda without waiting. */
managedCalendar.post("/managed-calendars/:id/events", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<ManagedEventInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const event = await createManagedEvent(c.env, c.req.param("id"), body, auth.userId);
    if (!event) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "calendar.event.created",
      entityKind: "managed_event",
      entityId: event.id,
      detail: { calendarId: event.calendarId, occurrences: event.occurrenceCount },
      // Curated by hand for Slack (invariant 22): the title and start are what
      // name the event and mint its link. Scalars only, and never `detail` —
      // which is why these are spelled out again rather than shared.
      notify: {
        title: event.title,
        start: event.start,
        allDay: event.allDay,
        occurrences: event.occurrenceCount,
      },
    });
    return c.json({ event }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** GET /admin/managed-events/:id — one authored series.
 *
 *  The by-calendar list above backs the calendar's own page, which already has
 *  every event in hand. This exists for the other entry point: the agenda's
 *  event modal, which knows only the occurrence's `seriesId` and needs the
 *  series itself to seed an edit form. */
managedCalendar.get("/managed-events/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const event = await loadManagedEvent(c.env, c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  return c.json({ event });
});

/** PATCH /admin/managed-events/:id — re-expands and bumps SEQUENCE. */
managedCalendar.patch("/managed-events/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<Partial<ManagedEventInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const updated = await updateManagedEvent(c.env, c.req.param("id"), body);
    if (!updated) return c.json({ error: "not_found" }, 404);
    const { event, sheets } = updated;
    const signupsMoved = sheets.moves.reduce((n, s) => n + s.signups, 0);
    c.var.audit.push({
      action: "calendar.event.updated",
      entityKind: "managed_event",
      entityId: event.id,
      detail: {
        occurrences: event.occurrenceCount,
        // The dates the sheets LEFT. `reanchorSheets` overwrites
        // `occurrence_start` in place and `volunteer_sheet` keeps no history,
        // so after this request nothing else in the system remembers where a
        // sign-up used to be — same reasoning as the pre-count on a delete
        // (invariant 13), one step short of destruction.
        ...(sheets.moves.length
          ? { sheetsMoved: sheets.moves.map(({ slug, from, to, signups }) => ({ slug, from, to, signups })) }
          : {}),
        ...(sheets.stranded ? { sheetsStranded: sheets.stranded } : {}),
      },
      notify: {
        title: event.title,
        start: event.start,
        allDay: event.allDay,
        occurrences: event.occurrenceCount,
        // Counts, never a slug or a name: the channel is a third party
        // (invariant 22), and a sheet's slug is the capability that opens it.
        sheetsMoved: sheets.moves.length,
        signupsMoved,
        sheetsStranded: sheets.stranded,
      },
    });
    // The client shows both numbers. An admin who nudged a date by an hour
    // should be told that eighteen families came along with it — and one whose
    // edit took a date away should be told that a sheet could NOT follow,
    // which is the same obligation pointing the other way.
    return c.json({ event, sheetsMoved: sheets.moves.length, signupsMoved, sheetsStranded: sheets.stranded });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** DELETE /admin/managed-events/:id — the whole authored series, every date it
 *  expanded to, and any volunteer sheet hung off one of those dates.
 *
 *  There is no per-occurrence delete, for the same reason there is no
 *  per-occurrence edit: this system stores a series, not a list of exceptions.
 *  Ending a run early is an edit to its UNTIL, which is what the editor offers;
 *  this route is for the event ceasing to exist.
 *
 *  The counts it answers with are the ones the admin was shown before
 *  confirming, re-reported from what the delete actually touched. */
managedCalendar.delete("/managed-events/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const removed = await deleteManagedEvent(c.env, id);
  if (!removed) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "calendar.event.deleted",
    entityKind: "managed_event",
    entityId: id,
    detail: { ...removed },
    // Named field by field rather than spread from `removed`, so a field added
    // to Removal later cannot reach the channel on its own — the same property
    // the public projections have. No `start`: the event is gone, so there is
    // no page left to link.
    notify: {
      title: removed.title,
      occurrences: removed.occurrences,
      sheets: removed.sheets,
      signups: removed.signups,
    },
  });
  return c.json({ ok: true, removed });
});

// ── Volunteer sheets ────────────────────────────────────────────────────────
//
// The authoring half of volunteer signups; the reading halves are
// routes/volunteers.ts (members, with names) and routes/volunteersPublic.ts
// (anonymous, counts only). These live here rather than in their own router
// because they are managed-event administration — same base, same system-admin
// gate, same audit discipline.
//
// Only authored events can carry a sheet: an imported ICS event has no durable
// id to attach one to (invariant 8). That is why there is no imported-feed
// counterpart to any of these routes.

/** GET /admin/managed-events/:id/occurrences — the dates this event lands on,
 *  each with the sheet already open on it. Backs the admin's date picker. */
managedCalendar.get("/managed-events/:id/occurrences", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ occurrences: await listOccurrences(c.env, c.req.param("id")) });
});

/** POST /admin/managed-events/:id/sheets { occurrenceStart, intro?, runbookUrl?, closesAt?, published? } */
managedCalendar.post("/managed-events/:id/sheets", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<VolunteerSheetInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const sheet = await createSheet(c.env, c.req.param("id"), body, auth.userId);
    if (!sheet) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "volunteer.sheet.created",
      entityKind: "volunteer_sheet",
      entityId: sheet.id,
      detail: { seriesId: sheet.event.seriesId, occurrenceStart: sheet.event.recurrenceId },
      // NOT the seriesId/occurrence pair from `detail` — that is the durable
      // handle signups key on, which invariant 12 withholds from anything
      // outward-facing. The slug is the sheet's own public handle.
      notify: { eventTitle: sheet.event.title, slug: sheet.slug, published: sheet.published },
    });
    return c.json({ sheet }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** The newsletter's MAX_TEST_RECIPIENTS, for the same reason: a test is a
 *  proof, not a distribution list. */
const MAX_TEST_REMINDERS = 10;

/** GET /admin/volunteer-sheets/:id — one sheet with its roster and orphan flag. */
managedCalendar.get("/volunteer-sheets/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const sheet = await loadSheetForAdmin(c.env, c.req.param("id"));
  if (!sheet) return c.json({ error: "not_found" }, 404);
  return c.json({ sheet });
});

/** GET /admin/volunteer-sheets/:id/emails — one address per volunteer, for the
 *  admin's "Email volunteers" button.
 *
 *  A route of its own rather than a field on the sheet: VolunteerSheetDTO is
 *  what every signed-in member reads on the event page, and an address carried
 *  there would be published to all of them. Which address is chosen, and why
 *  each is one a system admin can already read, is in `sheetVolunteerEmails`. */
managedCalendar.get("/volunteer-sheets/:id/emails", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const result = await sheetVolunteerEmails(c.env, c.req.param("id"));
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result);
});

/** POST /admin/volunteer-sheets/:id/test-reminder { to?: string[] } — proof the
 *  reminder email before the cron sends it (newsletter test-send's twin).
 *
 *  Sends the reminder as a volunteer holding EVERY position would get it
 *  (`buildTestReminder` — same renderer as the cron, runbook link included),
 *  to the addresses the admin typed, defaulting to their own account email.
 *  Never to the volunteers, never touching `reminder_sent_at`: the subject is
 *  prefixed so a forwarded test can't read as the real thing, and the real
 *  send remains the cron's alone. Works on drafts and orphans — proofing is
 *  wanted BEFORE publishing, and the reader is an admin. */
managedCalendar.post("/volunteer-sheets/:id/test-reminder", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ to?: string[] }>().catch(() => null);
  const raw = Array.isArray(body?.to) && body.to.length > 0 ? body.to : [auth.email ?? ""];
  const to = [...new Set(raw.map((e) => normalizeEmail(String(e))).filter(isEmail))];
  if (to.length === 0) {
    return c.json({ error: "invalid_body", message: "Add at least one valid address." }, 400);
  }
  if (to.length > MAX_TEST_REMINDERS) {
    return c.json(
      { error: "too_many", message: `Test sends are limited to ${MAX_TEST_REMINDERS} addresses.` },
      400,
    );
  }

  const built = await buildTestReminder(c.env, c.req.param("id"));
  if (!built) return c.json({ error: "not_found" }, 404);
  if (built.positionCount === 0) {
    return c.json(
      { error: "no_positions", message: "Add a position first — the reminder lists the shifts." },
      400,
    );
  }

  let sent = 0;
  for (const address of to) {
    // Same channel the cron will use, or the admin proofs a different sender
    // identity than the volunteers get (the newsletter test's reasoning).
    const result = await sendEmailResult(c.env, {
      ...built.msg,
      to: address,
      subject: `[Test] ${built.msg.subject}`,
    });
    if (result.ok) sent++;
  }

  c.var.audit.push({
    action: "volunteer.reminder.test_sent",
    entityKind: "volunteer_sheet",
    entityId: c.req.param("id"),
    detail: { count: to.length },
  });
  return c.json({ ok: true, sent, attempted: to.length });
});

/** PATCH /admin/volunteer-sheets/:id { intro?, runbookUrl?, closesAt?, published? }.
 *  Publishing is what puts the link on the public calendar; the date itself is
 *  create-only (see VolunteerSheetInput). */
managedCalendar.patch("/volunteer-sheets/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<VolunteerSheetInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const sheet = await updateSheet(c.env, c.req.param("id"), body);
    if (!sheet) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "volunteer.sheet.updated",
      entityKind: "volunteer_sheet",
      entityId: sheet.id,
      detail: { published: sheet.published },
      notify: { eventTitle: sheet.event.title, slug: sheet.slug, published: sheet.published },
    });
    return c.json({ sheet });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** POST /admin/volunteer-sheets/:id/occurrence { occurrenceStart } — move an
 *  orphaned sheet onto a date its event actually has.
 *
 *  Its own route rather than a field on the PATCH above, because
 *  `VolunteerSheetInput.occurrenceStart` stays create-only on purpose: re-dating
 *  a sheet relocates everyone already signed up. That objection is answered by
 *  narrowness, not overruled — `moveSheet` accepts only a date the materialized
 *  agenda actually offers and only one no other sheet holds — and the admin is
 *  the one who asked, having been shown the orphan banner that names the
 *  problem. A move that changes nothing writes nothing and audits nothing. */
managedCalendar.post("/volunteer-sheets/:id/occurrence", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ occurrenceStart?: string }>().catch(() => null);
  if (!body?.occurrenceStart) return c.json({ error: "invalid_body" }, 400);

  try {
    const result = await moveSheet(c.env, c.req.param("id"), body.occurrenceStart);
    if (!result) return c.json({ error: "not_found" }, 404);
    if (result.move) {
      c.var.audit.push({
        action: "volunteer.sheet.moved",
        entityKind: "volunteer_sheet",
        entityId: result.move.id,
        // The date it LEFT, which nothing else will remember a second from now:
        // `occurrence_start` is overwritten in place and the table keeps no
        // history. Same reasoning as the pre-count on a delete (invariant 13).
        detail: { from: result.move.from, to: result.move.to, signups: result.move.signups },
        // Dates and a count, no slug: the event-update line beside this one
        // sends none either, and two spellings of "what may leave the system"
        // for one feature is how the narrower one stops being true.
        notify: {
          from: result.move.from,
          to: result.move.to,
          signups: result.move.signups,
        },
      });
    }
    return c.json({ sheet: result.sheet, moved: !!result.move });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** DELETE /admin/volunteer-sheets/:id — removes its positions and signups too. */
managedCalendar.delete("/volunteer-sheets/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  // Read the event's title BEFORE the delete: the sheet joins managed_event, so
  // once it is gone there is nothing left to look the name up from. Same shape
  // as the calendar-source delete (invariant 22).
  const doomed = await loadSheetForAdmin(c.env, id);
  if (!(await deleteSheet(c.env, id))) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "volunteer.sheet.deleted",
    entityKind: "volunteer_sheet",
    entityId: id,
    notify: { eventTitle: doomed?.event.title ?? null },
  });
  return c.json({ ok: true });
});

/** POST /admin/volunteer-sheets/:id/positions { title, description?, slots?, startsAt?, endsAt? } */
managedCalendar.post("/volunteer-sheets/:id/positions", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<VolunteerPositionInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const sheet = await createPosition(c.env, c.req.param("id"), body);
    if (!sheet) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "volunteer.position.created",
      entityKind: "volunteer_sheet",
      entityId: sheet.id,
      detail: { title: body.title },
      notify: {
        title: body.title ?? null,
        eventTitle: sheet.event.title,
        slots: sheet.positions.find((p) => p.title === body.title)?.slots ?? 1,
      },
    });
    return c.json({ sheet }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** PATCH /admin/volunteer-positions/:id. */
managedCalendar.patch("/volunteer-positions/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<Partial<VolunteerPositionInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const sheet = await updatePosition(c.env, c.req.param("id"), body);
    if (!sheet) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "volunteer.position.updated",
      entityKind: "volunteer_position",
      entityId: c.req.param("id"),
      notify: {
        title: sheet.positions.find((p) => p.id === c.req.param("id"))?.title ?? null,
        eventTitle: sheet.event.title,
      },
    });
    return c.json({ sheet });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** DELETE /admin/volunteer-positions/:id — takes its signups with it. */
managedCalendar.delete("/volunteer-positions/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const sheetId = await deletePosition(c.env, c.req.param("id"));
  if (!sheetId) return c.json({ error: "not_found" }, 404);
  // Pushed BEFORE the read below, then enriched in place — the position is
  // already gone and invariant 22 wants that recorded whether or not the read
  // that builds the response succeeds. Same shape as routes/volunteers.ts.
  const draft: AuditDraft = {
    action: "volunteer.position.deleted",
    entityKind: "volunteer_position",
    entityId: c.req.param("id"),
    notify: {},
  };
  c.var.audit.push(draft);
  const sheet = await loadSheetForAdmin(c.env, sheetId);
  draft.notify!.eventTitle = sheet?.event.title ?? null;
  return c.json({ sheet });
});

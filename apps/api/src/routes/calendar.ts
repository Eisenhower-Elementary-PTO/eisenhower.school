// Shared calendar reads — available to any signed-in member. Events come from
// two origins that share one read model (`calendar_event`): public ICS feeds
// imported by the cron refresh (lib/calendar.ts), and calendars authored here
// (lib/managedCalendar.ts). Neither carries per-event privacy.
//
// These routes return the FULL CalendarEventDTO, including the seriesId/
// recurrenceId handles. The anonymous equivalents live in calendarPublic.ts and
// return a narrowed shape — if you are adding a field here, that is the file to
// check before assuming it stays private.

import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { requireApproved } from "../lib/directoryAccess.js";
import { albumFor, listAlbums } from "../lib/eventAlbums.js";
import { findEventByPath, listCalendarFeeds, queryUpcomingEvents, type UpcomingEventsQuery } from "../lib/calendar.js";

export const calendar = new Hono<HonoEnv>();

/** Parse the shared `?limit=&from=&to=&calendars=` surface. Lives here and is
 *  reused by calendarPublic.ts so the member and anonymous agendas can never
 *  disagree about what window they are showing. */
export function upcomingEventsQuery(c: Context<HonoEnv>): UpcomingEventsQuery {
  const calendars = (c.req.query("calendars") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    from: c.req.query("from") || new Date().toISOString(),
    to: c.req.query("to") || undefined,
    calendarIds: calendars,
    limit: Number(c.req.query("limit")) || 100,
  };
}

/** GET /calendar/sources — every calendar available to the show/hide filter:
 *  enabled imported feeds (upstream URL) plus managed calendars (this API's own
 *  published feed). Admin-only status/error fields stay out of this response. */
calendar.get("/sources", async (c) => {
  const auth = requireAuth(c);
  // Approval-gated even though nothing here reads `person`: an imported feed's
  // upstream URL can be a secret Google/Outlook subscribe link granting the raw
  // feed, ORGANIZER/ATTENDEE addresses included — invariant 12's reason for
  // mirroring it on the anonymous route. Handing it to a self-registered,
  // never-approved account would re-admit exactly the population invariant 32
  // exists to remove. Approved members still get the real URL, as documented.
  requireApproved(auth);
  const sources = await listCalendarFeeds(c.env, new URL(c.req.url).origin);
  return c.json({ sources });
});

/** GET /calendar/events?limit=&from=&to=&calendars= — upcoming (ongoing or
 *  future) events, earliest first. `from` defaults to now; an event counts as
 *  upcoming if it ends at/after `from`, has no end (open-ended/all-day without
 *  DTEND), or starts at/after `from`. Imported events are bounded to the refresh
 *  window (≈ now-2d forward) and managed ones to their recurrence's UNTIL, so an
 *  open-ended past event can't accumulate.
 *
 *  `to` (ISO, exclusive upper bound on the start) and `calendars` (comma-
 *  separated CalendarFeedDTO ids) are optional and exist for the newsletter's
 *  upcoming-events block, which needs a fixed window over chosen calendars.
 *  Both default to unbounded, so existing callers are unaffected. */
calendar.get("/events", async (c) => {
  requireAuth(c);
  const events = await queryUpcomingEvents(c.env, upcomingEventsQuery(c));
  return c.json({ events });
});

/** GET /calendar/events/:date/:slug — the same single event as the anonymous
 *  route, read as a member: the full CalendarEventDTO, `seriesId` included.
 *
 *  That one extra field is why this exists. The event page renders from the
 *  public read so a shared link is fast for someone with no cookie, and a system
 *  admin re-reads it here to get the durable handle on the authored series that
 *  the edit form opens — the same two-step the agenda does. */
calendar.get("/events/:date/:slug", async (c) => {
  requireAuth(c);
  const event = await findEventByPath(c.env, c.req.param("date"), c.req.param("slug"));
  if (!event) return c.json({ error: "not_found" }, 404);
  return c.json({ event });
});

/** GET /calendar/events/:date/:slug/album — the photo album on this event's
 *  occurrence, `{ albumUrl: string | null }`. Signed-in members only: the link is
 *  a capability, so it is a route of its own rather than a field on the event —
 *  `CalendarEventDTO` also feeds the agenda and the newsletter's frozen
 *  snapshots, and anything added there travels with them. An imported event has
 *  no durable handle (invariant 8) and so no album. */
calendar.get("/events/:date/:slug/album", async (c) => {
  requireAuth(c);
  const event = await findEventByPath(c.env, c.req.param("date"), c.req.param("slug"));
  if (!event) return c.json({ error: "not_found" }, 404);
  const albumUrl =
    event.seriesId && event.recurrenceId ? await albumFor(c.env, event.seriesId, event.recurrenceId) : null;
  return c.json({ albumUrl });
});

/** GET /calendar/albums — every event photo album, newest first. The page that
 *  outlives the event page (the agenda forgets an occurrence ~2 days after it
 *  ends). Signed-in members only. */
calendar.get("/albums", async (c) => {
  requireAuth(c);
  return c.json({ albums: await listAlbums(c.env) });
});

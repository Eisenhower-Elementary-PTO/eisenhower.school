// The link-preview card for one event — what Slack, iMessage and SMS show when
// someone pastes `/e/:date/:slug`.
//
// Unfurlers fetch the HTML once and read meta tags; none run JavaScript. The
// bundle's index.html says the same generic thing for every URL, so every event
// link previewed identically. This file builds the tags the Function injects.
//
// It is a pure function of ONE `PublicCalendarEventDTO` (invariant 12), so the
// card can say nothing the open event page doesn't already. Deliberately left
// out: `meetingUrl` (a join link belongs in the page, not a group chat's
// preview) and volunteer counts (a second subrequest for a number that is
// stale by the time it is read; the page shows it live).
//
// Every value is admin-typed text going into an HTML attribute, so escaping is
// the point of this file's tests.

import { formatClockRange, type PublicCalendarEventDTO } from "@sd/shared";

/** Previews clip around 150–200 characters; leave room for the ellipsis. */
const MAX_DESCRIPTION = 160;

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Sat, Nov 22 · 11:00 AM – 2:00 PM". All-day events are dates at UTC
 *  midnight (CLAUDE.md, timezone convention), so they are read in UTC and
 *  carry no clock. Everything else is read in the SCHOOL's zone. */
export function whenLine(
  e: Pick<PublicCalendarEventDTO, "start" | "end" | "allDay">,
  timeZone: string,
  locale: string,
): string {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: e.allDay ? "UTC" : timeZone,
  }).format(new Date(e.start));
  if (e.allDay) return day;
  return `${day} · ${formatClockRange(e.start, e.end, locale, timeZone)}`;
}

function clip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_DESCRIPTION) return flat;
  return `${flat.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
}

export interface EventCard {
  title: string;
  description: string;
}

/** Title is the event's; the description leads with when and where — the two
 *  things someone glancing at a group chat is asking — then the event's own
 *  words, clipped. */
export function eventCard(
  e: PublicCalendarEventDTO,
  timeZone: string,
  locale = "en",
): EventCard {
  const parts = [whenLine(e, timeZone, locale)];
  if (e.location?.trim()) parts.push(e.location.trim());
  const head = parts.join(" · ");
  const body = e.description ? clip(e.description) : "";
  return { title: e.title.trim(), description: body ? `${head}\n${body}` : head };
}

/** The tags that replace/extend the SPA shell's head. `noindex` stays: the
 *  SPA's own tag is left in place and this adds none that contradicts it. */
export function cardTags(card: EventCard, url: string, imageUrl: string): string {
  const t = escapeAttr(card.title);
  const d = escapeAttr(card.description);
  return [
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Eisenhower PTO Calendar" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:image" content="${escapeAttr(imageUrl)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join("\n    ");
}

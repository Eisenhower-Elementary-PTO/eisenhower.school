// The landing page itself, rendered per request in one of four languages.
//
// The hero is the design: the word "welcome" stacked in every language this
// community reads, with the current one in ink under an orange rule and the
// other three as links that reload the page in that language. It is the
// greeting and the language picker at once, which is the honest shape for a
// school whose families read English, Spanish, Chinese and Somali — a globe
// icon in a corner asks a Somali-speaking parent to hunt for their own
// language, and this hands it to them at 4rem.
//
// All copy comes from the shared dictionaries (CLAUDE.md invariant 6). The
// greeting stack is the one place that reads ACROSS dictionaries rather than
// within one, since it shows all four at once by design.

import {
  DEFAULT_TIME_ZONE,
  resolveTimeZone,
  LOCALES,
  dictionaries,
  eventPath,
  interpolate,
  localeNames,
  SOURCE_URL,
  type Locale,
  type PublicCalendarEventDTO,
  type Strings,
  formatClockRange,
} from "@sd/shared";
import {
  BUS_EMAIL,
  DISTRICT_PHONES,
  RESOURCES,
  SCHOOL_HOURS,
  SCHOOL_LABEL,
  SCHOOL_PHONES,
  hrefOf,
  type PhoneRow,
  type Resource,
} from "./district.js";
import type { Env } from "./env.js";
import { upcomingEvents } from "./events.js";
import {
  PIN,
  alternatesFor,
  appHref,
  document,
  emphasize,
  escapeHtml,
  hostOf,
  langHref,
  linkSlot,
  siteFooter,
  siteHeader,
} from "./shell.js";

interface Tile {
  title: string;
  href: string;
  host: string;
  body: string;
  /** Pre-escaped: carries a `<b>` around the sub-feature's name. */
  more: string;
  membersOnly: boolean;
}

/** Async only because of the upcoming-events block, which is the one thing on
 *  this page that isn't a pure function of the URL and the Accept-Language
 *  header. Everything else renders whether or not that read succeeds. */
export async function renderHome(
  env: Env,
  locale: Locale,
  explicit: boolean,
): Promise<string> {
  const events = await upcomingEvents(env);
  const s: Strings = dictionaries[locale];
  const t = (key: keyof Strings, vars?: Record<string, string>): string =>
    interpolate(s[key], vars);

  const school = env.SCHOOL_NAME;
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const languages = LOCALES.map((l) => localeNames[l].native).join(" · ");
  const city = `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`;

  const title = t("landingTitle", { school });
  const description = t("landingDescription", { school, city, languages });

  // The signature element. Fixed order (never "current language first"), so the
  // stack is a stable object a returning visitor recognizes rather than a list
  // that reshuffles under them.
  const greeting = LOCALES.map((l, i) => {
    const word = escapeHtml(dictionaries[l].landingWelcome);
    const inner =
      l === locale
        ? `<strong lang="${l}" aria-current="true">${word}</strong>`
        : `<a lang="${l}" href="${langHref(l)}" hreflang="${l}" aria-label="${escapeHtml(
            interpolate(dictionaries[l].landingReadIn, {
              language: localeNames[l].native,
            }),
          )}">${word}</a>`;
    return `<li style="--i:${i}">${inner}</li>`;
  }).join("");

  const tiles: Tile[] = [
    // FIRST, and deliberately. A stranger who lands on this domain is most often
    // asking "what is this?" before "let me look someone up" — and unlike the
    // three below, this one needs no account, no subscription and nothing of
    // them at all. It is also the tile that answers the question the school
    // office gets asked most: how do I give money to the PTO.
    {
      title: t("ptoTitle"),
      href: appHref(env.PTO_URL, "/", locale),
      host: hostOf(env.PTO_URL),
      body: t("landingPtoBody"),
      more: escapeHtml(t("landingPtoMore")),
      membersOnly: false,
    },
    // The Resource Center, by name. It lives on the PTO's site, but the family
    // that needs it — and the one ready to give to it — should not have to find
    // it through the PTO tile; /resource-center was built to be the URL on a
    // flyer, and this is the same hand-off from the front door. Title and body
    // are the Center's own strings, so this tile can never drift from its page.
    {
      title: t("ptoHowResourceTitle"),
      href: appHref(env.PTO_URL, "/resource-center", locale),
      host: hostOf(env.PTO_URL),
      body: t("ptoHowResourceLead"),
      more: escapeHtml(t("landingFrcMore")),
      membersOnly: false,
    },
    {
      title: t("navDir"),
      href: appHref(env.DIRECTORY_URL, "/", locale),
      host: hostOf(env.DIRECTORY_URL),
      body: t("landingDirBody"),
      more: emphasize(s.landingDirMore, s.neighbors),
      membersOnly: true,
    },
    {
      title: t("calendarTitle"),
      href: appHref(env.CALENDAR_URL, "/", locale),
      host: hostOf(env.CALENDAR_URL),
      body: t("landingCalBody"),
      more: emphasize(s.landingCalMore, s.volunteersTitle),
      membersOnly: false,
    },
    {
      title: t("landingNewsTitle"),
      href: appHref(env.NEWSLETTER_URL, "/", locale),
      host: hostOf(env.NEWSLETTER_URL),
      body: t("landingNewsBody"),
      more: escapeHtml(t("landingNewsMore")),
      membersOnly: false,
    },
    // Open to all — browsing and saying "that's mine" need no account — but
    // not indexed: the item pages are a school's lost property, not something
    // for a search engine (invariant 33).
    {
      title: t("navLostFound"),
      href: appHref(env.LOSTFOUND_URL, "/", locale),
      host: hostOf(env.LOSTFOUND_URL),
      body: t("landingLfBody"),
      more: escapeHtml(t("landingLfMore")),
      membersOnly: false,
    },
    // The store's tile is deliberately ABSENT while the shop is unannounced.
    //
    // The code ships and store.eisenhower.school is live, but nothing on this
    // site points at it yet, and this grid is the one place that would — it is
    // the front door's answer to "what's here". The vanity redirect at /store
    // (index.ts) still resolves, since typing a path is not the same as being
    // sent down it.
    //
    // To announce the shop, restore the tile:
    //
    //     {
    //       // The second indexed surface in the project, and the only one
    //       // anybody can buy from — so "open to all" here is literal.
    //       title: t("storeTitle"),
    //       href: appHref(env.STORE_URL, "/", locale),
    //       host: hostOf(env.STORE_URL),
    //       body: t("landingStoreBody"),
    //       more: escapeHtml(t("landingStoreMore")),
    //       membersOnly: false,
    //     },
    //
    // Its four dictionary strings (storeTitle, landingStoreBody,
    // landingStoreMore) are already translated and waiting.
  ];

  const tileHtml = tiles
    .map(
      (tile) => `
        <a class="card tile" href="${escapeHtml(tile.href)}">
          <div class="tile-top">
            <h2>${escapeHtml(tile.title)}</h2>
            <span class="tag ${tile.membersOnly ? "tag-members" : "tag-open"}">${escapeHtml(
              tile.membersOnly ? t("landingMembersOnly") : t("landingOpenToAll"),
            )}</span>
          </div>
          <div class="host">${escapeHtml(tile.host)}</div>
          <p>${escapeHtml(tile.body)}</p>
          <div class="more">${tile.more}</div>
          <div class="go">${escapeHtml(
            t("landingOpen", { name: tile.title }),
          )} <span aria-hidden="true">&#8594;</span></div>
        </a>`,
    )
    .join("");

  // The hero card carries the only link to /faq. A page nothing links to is a
  // page nobody reads, and this is where somebody hesitating over the sign-up
  // button is actually standing. Deliberately a quiet link rather than a third
  // button: the two acts above are what that card is for.
  const body = `
    ${siteHeader(env, locale, s)}

    <main>
      <section class="hero">
        <div class="wrap hero-in">
          <div>
            <p class="eyebrow place">${PIN}${escapeHtml(city)}</p>
            <ul class="greet">${greeting}</ul>
          </div>
          <div class="card hero-card">
            <p class="lead">${escapeHtml(t("landingLead", { school }))}</p>
            <div class="acts">
              <a class="btn btn-primary" href="${escapeHtml(
                appHref(env.DIRECTORY_URL, "/sign-in", locale),
              )}">${escapeHtml(t("landingCreateAccount"))}</a>
              <a class="btn btn-quiet" href="${escapeHtml(
                appHref(env.CALENDAR_URL, "/", locale),
              )}">${escapeHtml(t("landingSeeCalendar"))}</a>
            </div>
            <p class="note">${escapeHtml(t("landingNoPassword"))}</p>
            <a class="fq-link" href="${escapeHtml(langHref(locale, "/faq"))}">${escapeHtml(
              t("faqNav"),
            )} <span aria-hidden="true">&#8594;</span></a>
          </div>
        </div>
      </section>

      <section class="sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("landingWhatsHere"))}</p>
          <div class="grid">${tileHtml}</div>
        </div>
      </section>

      ${renderEvents(env, locale, events)}
      ${renderHelp(env, locale)}

      <section class="join">
        <div class="wrap join-in">
          <div>
            <p class="eyebrow"><a href="${escapeHtml(appHref(env.PTO_URL, "/", locale))}">${escapeHtml(school)}</a></p>
            <h2>${escapeHtml(t("landingJoinTitle"))}</h2>
            <p>${escapeHtml(t("landingJoinBody", { school }))}</p>
          </div>
          <div class="join-act">
            <a class="btn btn-light" href="${escapeHtml(
              appHref(env.DIRECTORY_URL, "/sign-in", locale),
            )}">${escapeHtml(t("landingCreateAccount"))}</a>
            <p class="note">${escapeHtml(t("landingNoPassword"))}</p>
          </div>
        </div>
      </section>
    </main>

    ${siteFooter(env, locale, s)}`;

  return document({
    lang: locale,
    title,
    description,
    canonical: `${origin}${explicit ? langHref(locale) : "/"}`,
    head: `${alternatesFor(origin, "/")}\n    ${jsonLd(env, description)}`,
    body,
  });
}

/** The next few things on the calendar.
 *
 *  Read live rather than transcribed, which is the whole point: a date copied
 *  onto this page is wrong the moment the school moves it, and this page has no
 *  editor. `upcomingEvents` degrades to an empty list on any failure and an
 *  empty list hides the block, so the front door never depends on the API being
 *  up — see `events.ts`.
 *
 *  Each row links to the event's own page on the calendar site, minted by the
 *  shared `eventPath` in the SCHOOL's timezone: this Worker has no reader
 *  timezone to use, and the lookup on the other side searches ±1 day, so the
 *  two ends can disagree about the boundary without breaking the link. */
function renderEvents(env: Env, locale: Locale, events: PublicCalendarEventDTO[]): string {
  if (events.length === 0) return "";
  const s = dictionaries[locale];
  const calendar = env.CALENDAR_URL.replace(/\/$/, "");
  const tz = resolveTimeZone(env.SCHOOL_TIMEZONE);

  const rows = events
    .map((e) => {
      const href = `${calendar}${eventPath(e, tz)}?lang=${locale}`;
      const detail = e.location
        ? `<span class="ev-note">${escapeHtml(e.location)}</span>`
        : "";
      return `
            <li>
              <a class="ev" href="${escapeHtml(href)}">
                <span class="ev-when">
                  <time class="ev-date" datetime="${escapeHtml(e.start)}">${escapeHtml(
                    eventDay(locale, e, tz),
                  )}</time>
                  <span class="ev-time">${escapeHtml(eventTime(locale, s, e, tz))}</span>
                </span>
                <span class="ev-what">
                  <span class="ev-name">${escapeHtml(e.title)}</span>
                  ${detail}
                </span>
              </a>
            </li>`;
    })
    .join("");

  return `
      <section class="ev-sect">
        <div class="wrap ev-in">
          <div>
            <p class="eyebrow">${escapeHtml(s.calendarTitle)}</p>
            <h2>${escapeHtml(s.upcomingEvents)}</h2>
            <a class="ev-all" href="${escapeHtml(
              appHref(env.CALENDAR_URL, "/", locale),
            )}">${escapeHtml(s.seeAll)} <span aria-hidden="true">&#8594;</span></a>
          </div>
          <ol class="ev-list">${rows}</ol>
        </div>
      </section>`;
}

/** "Tue, Oct 6" in the school's timezone — the day the calendar itself files
 *  the event under, not the day it falls on wherever the reader happens to be. */
function eventDay(locale: Locale, e: PublicCalendarEventDTO, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: e.allDay ? "UTC" : tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(e.start));
}

/** The clock time, or the words "all day". An all-day event is stored at UTC
 *  midnight (see `eventDateSegment`), so rendering a time for it would be a
 *  lie in either direction. */
function eventTime(locale: Locale, s: Strings, e: PublicCalendarEventDTO, tz: string): string {
  if (e.allDay) return s.allDay;
  return formatClockRange(e.start, e.end, locale, tz);
}

/** Everything the district publishes that a family actually reaches for: the
 *  numbers to call and the pages to open.
 *
 *  Unlike the events above, none of it expires, so it is transcribed rather
 *  than fetched (`district.ts`). Three columns, because that is genuinely three
 *  different questions — who at this school, who at the district, and where to
 *  read the rest — plus every other school office folded behind a `<details>`
 *  for the families with an older sibling across town. */
function renderHelp(env: Env, locale: Locale): string {
  const s = dictionaries[locale];

  const ours = [
    `<div class="row">
                  <dt>${escapeHtml(s.landingFactHours)}</dt>
                  <dd class="hours">${escapeHtml(schoolHours(locale))}</dd>
                </div>`,
    ...SCHOOL_PHONES.map((p) => phoneRow(s, p)),
  ].join("");

  const district = DISTRICT_PHONES.map((p) => phoneRow(s, p)).join("");

  // The printed URL is a link too, not decoration — it is the half of the row
  // someone reads out over the phone or copies onto a fridge, and a URL that
  // looks like a link and isn't one is just a broken one. It goes out
  // `aria-hidden`/`tabindex="-1"` so a screen reader and the tab key get ONE
  // link per row rather than two to the same page; the name above it is that
  // link, and it says what the page is.
  const resources = RESOURCES.map(
    (r) => `
                <li>
                  <a class="res-name" href="${escapeHtml(r.href)}">${escapeHtml(
                    s[r.key],
                  )}</a>
                  <p class="res-note">${resourceNote(s, r)}</p>
                  <a class="res-url" href="${escapeHtml(
                    r.href,
                  )}" aria-hidden="true" tabindex="-1">${escapeHtml(r.label)}</a>
                </li>`,
  ).join("");

  return `
      <section class="help">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(s.landingHelpEyebrow)}</p>
          <h2>${escapeHtml(s.landingHelpTitle)}</h2>

          <div class="help-grid">
            <div class="col">
              <h3>${escapeHtml(SCHOOL_LABEL)}</h3>
              <dl class="rows">${ours}</dl>
            </div>
            <div class="col">
              <h3>${escapeHtml(s.landingContactsDistrict)}</h3>
              <dl class="rows tight">${district}</dl>
            </div>
            <div class="col">
              <h3>${escapeHtml(s.landingResourcesTitle)}</h3>
              <ul class="res">${resources}</ul>
            </div>
          </div>
        </div>
      </section>`;
}

function phoneRow(s: Strings, p: PhoneRow): string {
  const note = p.noteKey ? `<p class="rownote">${escapeHtml(s[p.noteKey])}</p>` : "";
  return `
                <div class="row">
                  <dt>${escapeHtml(s[p.key])}</dt>
                  <dd><a href="${escapeHtml(hrefOf(p))}">${escapeHtml(p.phone)}</a></dd>
                  ${note}
                </div>`;
}

/** One resource's line of detail. The bus one names an address the reader may
 *  want to write to, so its `{email}` slot becomes a real `mailto:`. */
function resourceNote(s: Strings, r: Resource): string {
  const note = s[r.noteKey];
  return note.includes("{email}")
    ? linkSlot(note, "email", BUS_EMAIL, `mailto:${BUS_EMAIL}`)
    : escapeHtml(note);
}

/** The bell times — "7:40 AM – 2:10 PM", 12-hour in every language, like every
 *  other clock time in this project (`CLOCK`). The reader's language still
 *  names the day period; only the cycle is pinned. */
function schoolHours(locale: Locale): string {
  return formatClockRange(
    new Date(SCHOOL_HOURS.start).toISOString(),
    new Date(SCHOOL_HOURS.end).toISOString(),
    locale,
    DEFAULT_TIME_ZONE,
  );
}

/** Structured data naming the organization and where it is.
 *
 *  This is the only page in the project that asks to be indexed, so it is also
 *  the only place a search engine can learn that any of this is in Hopkins —
 *  which is what a parent typing "Eisenhower Hopkins" is looking for. The
 *  region goes out as a CODE here rather than the spelled-out name in the
 *  visible stamp, because that is what schema.org's `addressRegion` wants in
 *  the US.
 *
 *  Serialized with JSON.stringify and then escaped for `</script`, which is the
 *  one sequence that can end the block early; every value in it is
 *  configuration, but configuration is exactly what the escaping test feeds a
 *  `<script>` tag through. */
function jsonLd(env: Env, description: string): string {
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: env.SCHOOL_NAME,
    description,
    url: `${origin}/`,
    inLanguage: [...LOCALES],
    address: {
      "@type": "PostalAddress",
      addressLocality: env.SCHOOL_CITY,
      addressRegion: env.SCHOOL_REGION_CODE,
      addressCountry: "US",
    },
    areaServed: {
      "@type": "Place",
      name: `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`,
    },
    email: env.FEEDBACK_EMAIL,
    sameAs: [env.SCHOOL_SITE_URL],
  };
  const json = JSON.stringify(data).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">${json}</script>`;
}

export function renderNotFound(env: Env, locale: Locale): string {
  const s = dictionaries[locale];
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  return document({
    lang: locale,
    title: interpolate(s.landingTitle, { school: env.SCHOOL_NAME }),
    description: "",
    canonical: `${origin}/`,
    head: '<meta name="robots" content="noindex" />',
    body: `
    <main class="wrap gone">
      <h1>404</h1>
      <p>${escapeHtml(interpolate(s.landingLead, { school: env.SCHOOL_NAME }))}</p>
      <a class="btn btn-primary" href="${langHref(locale)}">${escapeHtml(s.landingWelcome)}</a>
    </main>`,
  });
}

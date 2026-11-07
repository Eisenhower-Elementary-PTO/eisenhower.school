import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES, SOURCE_URL, dictionaries, localeNames, type PublicCalendarEventDTO } from "@sd/shared";
import worker from "../src/index.js";
import { DISTRICT_PHONES, RESOURCES } from "../src/district.js";
import type { Env } from "../src/env.js";
import { localeFromAcceptLanguage, localeFromCookie } from "../src/locale.js";
import { escapeHtml } from "../src/shell.js";

const env: Env = {
  SCHOOL_NAME: "Eisenhower PTO",
  SITE_ORIGIN: "https://eisenhower.school",
  DIRECTORY_URL: "https://directory.eisenhower.school",
  CALENDAR_URL: "https://calendar.eisenhower.school",
  NEWSLETTER_URL: "https://newsletter.eisenhower.school",
  STORE_URL: "https://store.eisenhower.school",
  PTO_URL: "https://pto.eisenhower.school",
  LOSTFOUND_URL: "https://lostandfound.eisenhower.school",
  SCHOOL_SITE_URL: "https://eisenhower.hopkinsschools.org/",
  FEEDBACK_EMAIL: "EisenhowerPTO@hopkinsschools.org",
  SCHOOL_CITY: "Hopkins",
  SCHOOL_REGION: "Minnesota",
  SCHOOL_REGION_CODE: "MN",
  API_URL: "https://api-directory.eisenhower.school",
};

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://eisenhower.school${path}`, { headers }), env);
}

async function body(path: string, headers?: Record<string, string>): Promise<string> {
  return await (await get(path, headers)).text();
}

/** Two events off the calendar: one timed, one all-day, which is the whole
 *  matrix the row renderer has to handle. */
const EVENTS: PublicCalendarEventDTO[] = [
  {
    id: "01J0000000000000000000000A",
    kind: "managed",
    title: "Fall Carnival",
    location: "Eisenhower gym",
    description: null,
    meetingUrl: null,
    start: "2026-10-06T23:00:00.000Z", // 6:00 p.m. in Hopkins
    end: "2026-10-07T01:00:00.000Z",
    allDay: false,
    sourceIds: ["cal"],
    source: { name: "School", color: "#0068A8" },
    volunteerSlug: null,
  },
  {
    id: "01J0000000000000000000000B",
    kind: "imported",
    title: "No school — teacher workshop",
    location: null,
    description: null,
    meetingUrl: null,
    start: "2026-10-19T00:00:00.000Z",
    end: null,
    allDay: true,
    sourceIds: ["cal"],
    source: { name: "District", color: "#FAAB1C" },
    volunteerSlug: null,
  },
];

/** Stand in for the calendar API. `null` means the read fails, which is the
 *  case the page has to survive without losing anything else. */
function stubCalendar(events: PublicCalendarEventDTO[] | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/calendar-public/events")) throw new Error(`unexpected fetch: ${url}`);
      if (events === null) throw new Error("network");
      return new Response(JSON.stringify({ events }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

// Every page render reads the calendar, so give every test a working one by
// default; the tests that care override it.
beforeEach(() => stubCalendar(EVENTS));
afterEach(() => vi.unstubAllGlobals());

describe("Accept-Language", () => {
  it("picks the highest-weighted supported language, not the first listed", () => {
    // Header order would answer Somali; the q-weights say English.
    expect(localeFromAcceptLanguage("so;q=0.8, en;q=0.9")).toBe("en");
  });

  it("matches on the primary subtag", () => {
    expect(localeFromAcceptLanguage("es-MX,es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("zh-Hans-CN")).toBe("zh");
  });

  it("ignores languages we do not have", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("survives a malformed q without throwing", () => {
    expect(localeFromAcceptLanguage("so;q=banana, en")).toBe("en");
  });

  it("drops a q=0 rejection", () => {
    expect(localeFromAcceptLanguage("en;q=0, so;q=0.5")).toBe("so");
  });

  it("reads sd_lang out of a cookie header, ignoring its neighbours", () => {
    expect(localeFromCookie("sd_lang=so")).toBe("so");
    expect(localeFromCookie("other=1; sd_lang=zh; more=2")).toBe("zh");
    expect(localeFromCookie("sd_lang_other=so")).toBeNull();
    expect(localeFromCookie("sd_lang=fr")).toBeNull();
    expect(localeFromCookie("")).toBeNull();
    expect(localeFromCookie(null)).toBeNull();
  });
});

describe("the landing page", () => {
  it("greets in every language we have, whichever one is being read", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      for (const other of LOCALES) {
        expect(html).toContain(dictionaries[other].landingWelcome);
      }
    }
  });

  it("renders in the language asked for, and says so in <html lang>", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain('<html lang="so">');
    expect(html).toContain(dictionaries.so.landingCreateAccount);
    expect(html).not.toContain(dictionaries.en.landingCreateAccount);
  });

  it("falls back to Accept-Language, then to English", async () => {
    expect(await body("/", { "accept-language": "es-MX,es;q=0.9" })).toContain('<html lang="es">');
    expect(await body("/", { "accept-language": "fr" })).toContain('<html lang="en">');
    expect(await body("/")).toContain('<html lang="en">');
  });

  it("lets ?lang beat the browser's preference", async () => {
    const html = await body("/?lang=zh", { "accept-language": "en-US" });
    expect(html).toContain('<html lang="zh">');
  });

  // A choice, once made, must not be quietly undone by detection. This is the
  // server-side half of the same rule each SPA applies with localStorage.
  it("remembers an explicit choice in a cookie, and never a detected one", async () => {
    const chosen = await get("/?lang=so", { "accept-language": "en-US" });
    const cookie = chosen.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sd_lang=so");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");

    const detected = await get("/", { "accept-language": "es-MX,es;q=0.9" });
    expect(await detected.text()).toContain('<html lang="es">');
    expect(detected.headers.get("set-cookie")).toBeNull();
  });

  it("lets the remembered choice beat the browser's preference on a later visit", async () => {
    const html = await body("/", { cookie: "sd_lang=so", "accept-language": "en-US" });
    expect(html).toContain('<html lang="so">');
  });

  it("still lets a fresh ?lang beat the remembered one", async () => {
    const res = await get("/?lang=zh", { cookie: "sd_lang=so" });
    expect(await res.text()).toContain('<html lang="zh">');
    expect(res.headers.get("set-cookie")).toContain("sd_lang=zh");
  });

  it("ignores a cookie that isn't one of ours and falls back to detection", async () => {
    const html = await body("/", { cookie: "sd_lang=klingon", "accept-language": "es" });
    expect(html).toContain('<html lang="es">');
  });

  // A cookie in the mix means a shared cache must not keep a copy: it would
  // hand the next reader the previous one's language.
  it("varies on both signals and keeps the page out of shared caches", async () => {
    const res = await get("/");
    expect(res.headers.get("vary")).toBe("Accept-Language, Cookie");
    expect(res.headers.get("cache-control")).toContain("private");
  });

  // The cookie is remembered here, but the SPAs save the choice their own way,
  // so what travels outward is still the query string.
  it("carries the remembered language onto a shortcut redirect", async () => {
    const res = await get("/calendar", { cookie: "sd_lang=so" });
    expect(res.headers.get("location")).toBe("https://calendar.eisenhower.school/?lang=so");
  });

  it("marks the current language as current and the others as links", async () => {
    const html = await body("/?lang=es");
    expect(html).toContain(`<strong lang="es" aria-current="true">${dictionaries.es.landingWelcome}`);
    expect(html).toContain('<a lang="so" href="/?lang=so"');
    // The stack never links to the language you are already reading.
    expect(html).not.toContain('<a lang="es"');
  });

  it("labels each language link in that language", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain(
      dictionaries.so.landingReadIn.replace("{language}", localeNames.so.native),
    );
  });

  it("hands the Resource Center to a family straight from the front door", async () => {
    // Its own tile, open to all, linking the page built to be handed out — in
    // every language, with the choice carried across the hop.
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain(
        `href="https://pto.eisenhower.school/resource-center?lang=${locale}"`,
      );
      expect(html).toContain(escapeHtml(dictionaries[locale].ptoHowResourceTitle));
      expect(html).toContain(escapeHtml(dictionaries[locale].ptoHowResourceLead));
      expect(html).toContain(escapeHtml(dictionaries[locale].landingFrcMore));
    }
  });

  it("carries the reader's language into every app link", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain("https://directory.eisenhower.school/sign-in?lang=so");
    expect(html).toContain("https://calendar.eisenhower.school/?lang=so");
    expect(html).toContain("https://newsletter.eisenhower.school/?lang=so");
  });

  it("keeps a way out to the school's own site, which this domain used to be", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain("https://eisenhower.hopkinsschools.org/");
      expect(html).toContain(dictionaries[locale].landingSchoolSiteLink);
    }
  });

  it("says where the school is, in every language", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      // The place name is configuration and stays in Latin script. It used to
      // be said a second time in the footer as well; the footer was cut to
      // three items, and the two places a SEARCH ENGINE reads it — the
      // description and the Place structured data below — are what actually
      // carried that signal, so nothing was lost with the line.
      expect(html).toContain("Hopkins, Minnesota");
    }
  });

  it("carries the same three-item footer in every language", async () => {
    // The one credit line, identical in all five apps and all four SSR public
    // surfaces: who this is, where feedback goes, where the source is.
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain(`https://pto.eisenhower.school/?lang=${locale}`);
      expect(html).toContain("mailto:EisenhowerPTO@hopkinsschools.org");
      // "GitHub" is a proper noun and reads the same in all four languages,
      // which is why it is no longer a dictionary string at all.
      expect(html).toContain(`<a href="${SOURCE_URL}">GitHub</a>`);
    }
  });

  it("links the PTO name in the join band to the PTO site, in every language", async () => {
    // Every reference to the PTO on the page reaches the PTO's own page: the
    // "What's here" tile and footer already did; this is the join band's eyebrow.
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain(
        `<p class="eyebrow"><a href="https://pto.eisenhower.school/?lang=${locale}">Eisenhower PTO</a></p>`,
      );
    }
  });

  it("puts the location in the description a search engine reads", async () => {
    const html = await body("/?lang=en");
    expect(html).toMatch(/<meta name="description" content="[^"]*Hopkins, Minnesota/);
  });

  it("publishes the address as structured data, with the region as a code", async () => {
    const html = await body("/");
    const json = html.match(
      /<script type="application\/ld\+json">(.*?)<\/script>/s,
    )?.[1];
    expect(json).toBeTruthy();
    const data = JSON.parse(json!);
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Hopkins",
      // "MN", not "Minnesota" — schema.org wants the subdivision code here even
      // though the visible stamp spells the state out.
      addressRegion: "MN",
      addressCountry: "US",
    });
    expect(data.name).toBe("Eisenhower PTO");
    expect(data.url).toBe("https://eisenhower.school/");
  });

  it("asks to be indexed — unlike every members-only app in this repo", async () => {
    const html = await body("/");
    expect(html).not.toContain("noindex");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/" />');
    for (const locale of LOCALES) {
      expect(html).toContain(`hreflang="${locale}" href="https://eisenhower.school/?lang=${locale}"`);
    }
    expect(html).toContain('hreflang="x-default"');
  });

  it("canonicalizes an explicitly-chosen language to its own URL", async () => {
    const html = await body("/?lang=zh");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/?lang=zh" />');
  });

  it("leaves no placeholder uninterpolated", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      // Any `{word}` that survived is a template we forgot to fill. `--i:0` and
      // CSS braces are excluded by requiring a bare word inside the braces.
      expect(html).not.toMatch(
        /\{(school|email|name|feature|language|languages|city|year|district)\}/,
      );
    }
  });

  it("emphasizes the sub-feature wherever the translator put it in the sentence", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain(`<b>${dictionaries.so.neighbors}</b>`);
    expect(html).toContain(`<b>${dictionaries.so.volunteersTitle}</b>`);
    expect(html).not.toContain("\u0000");
  });
});

describe("upcoming events", () => {
  it("shows the next few off the calendar, linking each to its own page", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain("Fall Carnival");
    expect(html).toContain("Eisenhower gym");
    // Content identity minted in the SCHOOL's timezone: 23:00 UTC is the 6th
    // in Hopkins, not the 7th.
    expect(html).toContain(
      'href="https://calendar.eisenhower.school/e/2026-10-06/fall-carnival?lang=en"',
    );
    expect(html).toContain(dictionaries.en.upcomingEvents);
  });

  it("gives an all-day event the words rather than a midnight clock time", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain(escapeHtml(dictionaries.en.allDay));
    expect(html).toContain("Mon, Oct 19");
    expect(html).not.toContain("12:00 AM");
    // A timed one still gets its range.
    expect(html).toMatch(/6:00\s*[–-]\s*8:00\s*PM/);
  });

  it("reads the ANONYMOUS calendar route, never the members-only twin", async () => {
    await body("/");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/calendar-public/events");
    expect(String(url)).not.toMatch(/\/calendar\/events/);
  });

  it("renders the whole page anyway when the calendar is unreachable", async () => {
    stubCalendar(null);
    const html = await body("/?lang=en");
    expect(html).not.toContain(dictionaries.en.upcomingEvents);
    expect(html).not.toContain("Fall Carnival");
    // Everything that does not depend on that read is still here.
    expect(html).toContain(dictionaries.en.landingCreateAccount);
    expect(html).toContain(dictionaries.en.landingHelpTitle);
  });

  it("hides the block when the calendar has nothing coming up", async () => {
    stubCalendar([]);
    const html = await body("/?lang=en");
    expect(html).not.toContain(dictionaries.en.upcomingEvents);
  });
});

describe("who to call, and where to look", () => {
  it("carries every district number, as a dialable link", async () => {
    const html = await body("/?lang=en");
    for (const row of DISTRICT_PHONES) {
      expect(html).toContain(escapeHtml(dictionaries.en[row.key]));
      expect(html).toContain(`>${row.phone}</a>`);
      expect(html).toContain(`href="tel:+1${row.phone.replace(/-/g, "")}"`);
    }
    // Eisenhower's own two, which are the reason this block exists.
    expect(html).toContain('href="tel:+19529884300"'); // school office
    expect(html).toContain('href="tel:+19529885391"'); // interpreters
  });

  it("links every page the mailing points families at, with why", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      for (const r of RESOURCES) {
        expect(html).toContain(`href="${r.href}"`);
        expect(html).toContain(escapeHtml(r.label));
        expect(html).toContain(escapeHtml(dictionaries[locale][r.key]));
      }
    }
  });

  it("makes the printed URL clickable, without doubling up the link for AT", async () => {
    const html = await body("/?lang=en");
    for (const r of RESOURCES) {
      // The visible URL is a real link to the same page as the name above it…
      expect(html).toContain(
        `<a class="res-url" href="${r.href}" aria-hidden="true" tabindex="-1">${r.label}</a>`,
      );
    }
    // …but a screen reader and the tab key still get one link per row.
    const rows = html.split('class="res-name"').length - 1;
    expect(rows).toBe(RESOURCES.length);
    expect(html.split('class="res-url"').length - 1).toBe(RESOURCES.length);
    expect(html.match(/class="res-url"[^>]*aria-hidden="true"/g)).toHaveLength(RESOURCES.length);
  });

  it("turns the bus address into a mailto wherever the translator put it", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain(
        '<a href="mailto:SchoolBus@HopkinsSchools.org">SchoolBus@HopkinsSchools.org</a>',
      );
      // The slot is filled, not left behind, in every language.
      expect(html).not.toContain("{email}");
    }
  });

  it("states the school hours on a 12-hour clock in every language", async () => {
    // `CLOCK` in @sd/shared pins the hour cycle for the whole project: an
    // American elementary school says "2:10 PM", and a parent whose phone is
    // set to another locale — or to the 24-hour option on this one — is not
    // reading about a different school day. The LANGUAGE still names the day
    // period, which is why this asserts the digits rather than the words.
    expect(await body("/?lang=en")).toMatch(/7:40\s*AM\s*[–-]\s*2:10\s*PM/);
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain("7:40");
      expect(html).toContain("2:10");
      // The failure this rule exists to prevent, in any language that would
      // otherwise default to it.
      expect(html).not.toContain("14:10");
    }
  });

  it("carries no attribution line and no other-schools fold", async () => {
    // Both were removed on purpose: the block is the school's own contacts, not
    // a reprint of the mailing, and the district is already linked from the
    // header and from every resource row.
    const html = await body("/?lang=en");
    expect(html).not.toContain("ISD 270");
    expect(html).not.toContain("Published by");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    // What replaced neither of them: the three columns are still all there.
    expect(html).toContain(dictionaries.en.landingContactsDistrict);
    expect(html).toContain(dictionaries.en.landingResourcesTitle);
    expect(html).toContain("Eisenhower Elementary");
  });
});

describe("routing", () => {
  it("301s www to the apex, preserving path and query", async () => {
    const res = await worker.fetch(new Request("https://www.eisenhower.school/?lang=zh"), env);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://eisenhower.school/?lang=zh");
  });

  it("hands the vanity paths to the app that owns them", async () => {
    expect((await get("/calendar")).headers.get("location")).toBe(
      "https://calendar.eisenhower.school/?lang=en",
    );
    expect((await get("/subscribe")).headers.get("location")).toBe(
      "https://newsletter.eisenhower.school/subscribe?lang=en",
    );
    expect((await get("/sign-in?lang=es")).headers.get("location")).toBe(
      "https://directory.eisenhower.school/sign-in?lang=es",
    );
  });

  it("404s an unknown path in the reader's language rather than redirecting", async () => {
    const res = await get("/nope", { "accept-language": "so" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('<html lang="so">');
    expect(html).toContain("noindex");
  });

  it("serves a robots.txt that allows the page and names the sitemap", async () => {
    const res = await get("/robots.txt");
    const txt = await res.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("https://eisenhower.school/sitemap.xml");
  });

  it("lists every language in the sitemap, with escaped ampersands", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    for (const locale of LOCALES) expect(xml).toContain(`/?lang=${locale}`);
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it("refuses a write", async () => {
    const res = await worker.fetch(
      new Request("https://eisenhower.school/", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("escaping", () => {
  it("escapes values that come from configuration", async () => {
    const hostile: Env = { ...env, SCHOOL_NAME: '<script>alert(1)</script>' };
    const html = await (
      await worker.fetch(new Request("https://eisenhower.school/"), hostile)
    ).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("cannot be used to close the JSON-LD block early", async () => {
    const hostile: Env = { ...env, SCHOOL_CITY: "</script><script>alert(1)</script>" };
    const html = await (
      await worker.fetch(new Request("https://eisenhower.school/"), hostile)
    ).text();
    expect(html).not.toContain("</script><script>alert(1)");
    // One ld+json block, and it still parses.
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(JSON.parse(json!).address.addressLocality).toBe(
      "</script><script>alert(1)</script>",
    );
  });
});

// ── /faq ────────────────────────────────────────────────────────────────────
//
// The page that explains the site. Its own properties, plus the two it must
// NOT break: it is a separate document from `/` with its own canonical set,
// and its language picker has to keep the reader on `/faq`.

describe("/faq", () => {
  it("renders, and says what it is", async () => {
    const res = await get("/faq");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(escapeHtml(dictionaries.en.faqTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.faqGetInTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.faqPrivacyTitle));
  });

  it("makes no subrequest at all", async () => {
    // The landing page reads the calendar; this one reads nothing, so an API
    // outage cannot touch it. `stubCalendar` throws on any unexpected fetch and
    // the beforeEach hands every test a working calendar — so the assertion
    // that matters is the CALL COUNT, not that the render succeeded.
    const spy = vi.fn(async () => {
      throw new Error("the FAQ must not fetch anything");
    });
    vi.stubGlobal("fetch", spy);
    const res = await get("/faq");
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("exists in every language, with no English left in the others", async () => {
    for (const l of LOCALES) {
      const html = await body(`/faq?lang=${l}`);
      expect(html).toContain(`<html lang="${l}">`);
      expect(html).toContain(escapeHtml(dictionaries[l].faqTitle));
      expect(html).toContain(escapeHtml(dictionaries[l].faqNoPublicLead));
      if (l !== "en") {
        // The one sentence most likely to be left untranslated, because it is
        // the one a developer writes last.
        expect(html).not.toContain(escapeHtml(dictionaries.en.faqNoPublicLead));
      }
    }
  });

  it("keeps you on /faq when you switch language", async () => {
    const html = await body("/faq");
    for (const l of LOCALES) {
      if (l === "en") continue;
      // The picker's links, and the hreflang set, must both point at THIS path.
      expect(html).toContain(`href="/faq?lang=${l}"`);
      expect(html).toContain(`hreflang="${l}" href="https://eisenhower.school/faq?lang=${l}"`);
    }
    // A picker that sent the reader back to the front door would still contain
    // the language codes, so assert the wrong destination is absent too.
    expect(html).not.toContain('<ul class="langbar"><li><a lang="es" hreflang="es" href="/?lang=es"');
  });

  it("names every language in its own language, never the reader's", async () => {
    const html = await body("/faq?lang=so");
    for (const l of LOCALES) {
      expect(html).toContain(escapeHtml(localeNames[l].native));
    }
    // "Somali" is what English calls it; a Somali reader is looking for
    // "Soomaali". The English exonym must not appear as a picker label.
    expect(html).not.toContain(">Somali<");
  });

  it("is its own indexed document, not a copy of the landing page's", async () => {
    const html = await body("/faq");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/faq" />');
    expect(html).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://eisenhower.school/faq" />',
    );
    expect(html).not.toContain('name="robots"');
  });

  it("carries the explicit choice into the canonical, like the landing page", async () => {
    const html = await body("/faq?lang=es");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/faq?lang=es" />');
  });

  it("remembers a chosen language but never a detected one", async () => {
    const chosen = await get("/faq?lang=so");
    expect(chosen.headers.get("set-cookie")).toContain("sd_lang=so");
    // Detection must not promote itself into a preference.
    const detected = await get("/faq", { "accept-language": "so" });
    expect(detected.headers.get("set-cookie")).toBeNull();
    expect(await detected.text()).toContain('<html lang="so">');
  });

  it("is in the sitemap, once per language", async () => {
    const xml = await body("/sitemap.xml");
    expect(xml).toContain("<loc>https://eisenhower.school/faq</loc>");
    for (const l of LOCALES) {
      expect(xml).toContain(`<loc>https://eisenhower.school/faq?lang=${l}</loc>`);
    }
    // The landing page's entries must survive the change.
    expect(xml).toContain("<loc>https://eisenhower.school/</loc>");
  });

  it("shows all three visibility states and never invents a fourth", async () => {
    const html = await body("/faq");
    for (const chip of ["visMembers", "visPrivate", "visShared"] as const) {
      expect(html).toContain(escapeHtml(dictionaries.en[chip]));
    }
    // The directory has no public visibility anywhere in the UI, and this page
    // is where a parent would most readily believe otherwise.
    expect(html).not.toContain("chip-public");
    expect(html.toLowerCase()).not.toContain(">public<");
  });

  it("trails no member-private surface onto an indexed page", async () => {
    // The fourth surface here that asks to be indexed. It may name hosts and
    // dictionary copy and nothing else — in particular no /admin route and no
    // API origin, which is where a member's data actually lives.
    const html = await body("/faq");
    expect(html).not.toContain("api-directory.eisenhower.school");
    expect(html).not.toContain("/admin");
  });

  it("still 404s an unknown path", async () => {
    expect((await get("/faqs")).status).toBe(404);
    expect((await get("/faq/extra")).status).toBe(404);
  });
});

describe("the front door links to /faq", () => {
  it("offers it from the hero, in the reader's language", async () => {
    const html = await body("/?lang=es");
    expect(html).toContain('href="/faq?lang=es"');
    expect(html).toContain(escapeHtml(dictionaries.es.faqNav));
  });
});

// ── /faq/print — the handout ────────────────────────────────────────────────
//
// One sheet per language from one print run. The properties that matter are
// that all four are there, that each is its own page, and that a sheet is
// standalone — somebody holding the English one has to be able to find the
// Somali one, which on paper means an address rather than a link.

describe("/faq/print", () => {
  it("puts every language in one document", async () => {
    const html = await body("/faq/print");
    for (const l of LOCALES) {
      expect(html).toContain(`<article class="pr-sheet" lang="${l}">`);
      expect(html).toContain(
        escapeHtml(dictionaries[l].faqPrintTitle.replace("{school}", "Eisenhower PTO")),
      );
    }
    expect(html.match(/class="pr-sheet"/g)).toHaveLength(LOCALES.length);
  });

  it("names the site itself, not the page, and says it once", async () => {
    // A sheet handed to somebody has to name the THING before anything else,
    // where the screen page can assume you arrived from the site. So the print
    // heading is the site's name and the brand eyebrow that used to sit above
    // it is gone — it was saying "Eisenhower PTO" directly above a heading that
    // now says "Eisenhower PTO Website".
    const html = await body("/faq/print?lang=en");
    expect(html).toContain("<h1>Eisenhower PTO Website</h1>");
    expect(html).not.toContain("pr-brand");
    // The screen page keeps its own heading; this changed the sheet only.
    expect(html).not.toContain(escapeHtml(dictionaries.en.faqTitle));
    expect(await body("/faq")).toContain(`<h1>${escapeHtml(dictionaries.en.faqTitle)}</h1>`);
  });

  it("puts the same name in the document title, which printers stamp on the page", async () => {
    // Browsers print <title> into the margin by default. Leaving it as the
    // screen page's heading would put two different names for one sheet on one
    // piece of paper.
    const html = await body("/faq/print?lang=es");
    expect(html).toContain("<title>Sitio web de Eisenhower PTO</title>");
  });

  it("narrows to one language when asked", async () => {
    const html = await body("/faq/print?lang=so");
    expect(html.match(/class="pr-sheet"/g)).toHaveLength(1);
    expect(html).toContain('<article class="pr-sheet" lang="so">');
    expect(html).toContain("Websaydka Eisenhower PTO");
    expect(html).not.toContain(escapeHtml(dictionaries.en.faqNoPublicLead));
  });

  it("breaks each sheet onto its own page, and does not strand a trailing blank", async () => {
    const html = await body("/faq/print");
    expect(html).toContain("break-after:page");
    // Without this the last sheet ejects a blank page on most printers.
    expect(html).toContain(".pr-sheet:last-child{break-after:auto");
  });

  it("gives every sheet the address of the others, since paper has no links", async () => {
    const html = await body("/faq/print");
    for (const l of LOCALES) {
      // Named in its own language, and reachable — a parent handed the wrong
      // sheet needs to be able to type their way to the right one.
      expect(html).toContain(escapeHtml(localeNames[l].native));
      expect(html).toContain(`eisenhower.school/faq?lang=${l}`);
    }
    // And an address to write to, on every sheet.
    expect(html.match(/EisenhowerPTO@hopkinsschools\.org/g)?.length).toBeGreaterThanOrEqual(LOCALES.length);
  });

  it("is not indexed — two copies of one text compete with each other", async () => {
    const html = await body("/faq/print");
    expect(html).toContain('<meta name="robots" content="noindex" />');
    const xml = await body("/sitemap.xml");
    expect(xml).not.toContain("/faq/print");
  });

  it("ships no script, keeping this hostname free of client JavaScript", async () => {
    // The newsletter's /print twin auto-fires the dialog; this one deliberately
    // does not, because that would be the first byte of JS this Worker serves.
    const html = await body("/faq/print");
    expect(html).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("window.print");
  });

  it("makes no subrequest either", async () => {
    const spy = vi.fn(async () => {
      throw new Error("the handout must not fetch anything");
    });
    vi.stubGlobal("fetch", spy);
    expect((await get("/faq/print")).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the print stylesheet", () => {
  it("restates the light palette, so a dark-themed reader still prints on paper", async () => {
    // Printing IS the export (invariant 16), so it cannot depend on the OS
    // theme. Order is precedence: the print block must come BELOW the dark one.
    const html = await body("/faq");
    const dark = html.indexOf("@media(prefers-color-scheme:dark)");
    const print = html.indexOf("@media print");
    expect(dark).toBeGreaterThan(-1);
    expect(print).toBeGreaterThan(dark);
    expect(html.slice(print)).toContain("--ink:#000");
  });

  it("drops the navigation, which does not survive a printer", async () => {
    const html = await body("/faq");
    const print = html.slice(html.indexOf("@media print"));
    expect(print).toContain(".hd,.ft,.join,.langbar,.fq-link");
  });

  it("writes the language picker's addresses out, since paper has no links", async () => {
    const html = await body("/faq");
    for (const l of LOCALES) {
      if (l === "en") continue;
      expect(html).toContain(`data-url="eisenhower.school/faq?lang=${l}"`);
    }
  });
});

describe("the printed sheet's type scale", () => {
  // Pagination cannot be asserted from source — it needs a real printer, and
  // the method is written above these rules in styles.ts. What a test CAN do is
  // notice that the measured numbers changed, so a casual bump gets a failure
  // that names the re-measurement rather than a stack of two-page handouts
  // nobody discovers until they are being handed out.
  it("holds the sizes that were measured to fit one page", async () => {
    const print = (await body("/faq/print")).match(/@media print\{[\s\S]*$/)?.[0] ?? "";
    expect(print).toContain("font-size:9pt;line-height:1.36");
    expect(print).toContain(".pr-sheet h1{font-size:16pt");
    expect(print).toContain(".fq-places p{font-size:8.2pt");
    expect(print).toContain(".fq-step-b{font-size:8.2pt");
    expect(print).toContain(".fq-notes p{font-size:8pt");
  });

  it("keeps each sheet on its own page and ejects no trailing blank", async () => {
    const html = await body("/faq/print");
    expect(html).toContain(".pr-sheet{");
    expect(html).toContain("break-after:page");
    expect(html).toContain(".pr-sheet:last-child{break-after:auto");
  });
});

describe("/privacy", () => {
  it("renders, and answers the questions it exists for", async () => {
    const res = await get("/privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(escapeHtml(dictionaries.en.privacyTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.privacyHoldTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.privacyDefaultTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.privacyWhoTitle));
    expect(html).toContain(escapeHtml(dictionaries.en.privacyDeleteTitle));
  });

  it("carries the transportation commitment, in every language", async () => {
    // The promise a family was actually given. It is the reason this page was
    // written, and it is the sentence that must not quietly disappear in a
    // later edit — in any of the four languages, since a commitment that holds
    // only in English is not one.
    for (const l of LOCALES) {
      const html = await body(`/privacy?lang=${l}`);
      expect(html).toContain(escapeHtml(dictionaries[l].privacyBusTitle));
      expect(html).toContain(escapeHtml(dictionaries[l].privacyBusBody));
    }
  });

  it("names every third party that data actually reaches", async () => {
    // The bar for this list is "data reaches them", not "we have a contract".
    // A service added to the code and not to this page is the failure worth
    // catching, so the test names them rather than counting.
    const html = await body("/privacy");
    for (const who of ["Cloudflare", "Cloudflare Email", "OpenStreetMap", "Stripe", "Printful", "Slack"]) {
      expect(html).toContain(who);
    }
    // Resend is retired entirely (fallback 2026-10-25; removed 2026-11-05) —
    // no mail reaches it, so it must NOT be presented as a party that sees
    // anything. Re-adopting any mail vendor means naming it here and in all
    // four dictionaries first.
    expect(html).not.toContain("Resend");
  });

  it("makes no subrequest at all", async () => {
    // A privacy notice that could be emptied by the API having a bad afternoon
    // would be worse than not having one — /faq's property, same reasoning.
    const spy = vi.fn(async () => {
      throw new Error("the privacy notice must not fetch anything");
    });
    vi.stubGlobal("fetch", spy);
    const res = await get("/privacy");
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("exists in every language, and each is its own document", async () => {
    for (const l of LOCALES) {
      const html = await body(`/privacy?lang=${l}`);
      expect(html).toContain(`<html lang="${l}">`);
      expect(html).toContain(escapeHtml(dictionaries[l].privacyTitle));
    }
  });

  it("is in the sitemap — a page nobody is told about is a page nobody reads", async () => {
    const xml = await body("/sitemap.xml");
    expect(xml).toContain("/privacy");
    for (const l of LOCALES) expect(xml).toContain(`/privacy?lang=${l}`);
  });

  it("is reachable from every page on this host", async () => {
    // The footer, so a family who lands anywhere can find it without knowing
    // the URL. A notice nobody can navigate to is a notice in name only.
    for (const path of ["/", "/faq", "/privacy"]) {
      expect(await body(path)).toContain('href="/privacy');
    }
  });

  it("asks nobody to agree to anything", async () => {
    // No banner, no checkbox, no "by continuing you accept". A parent's real
    // control here is the per-field visibility setting and the delete button.
    const html = (await body("/privacy")).toLowerCase();
    for (const theatre of ["i agree", "accept cookies", "by continuing"]) {
      expect(html).not.toContain(theatre);
    }
  });
});

describe("/privacy names the visit count", () => {
  it("in every language, as the only measurement", async () => {
    // Cloudflare Web Analytics is injected at the EDGE, zone-wide, into every
    // HTML page on every hostname — nothing in this repo adds it, so no test
    // here can see it. This is the half that can be pinned: a notice that
    // says "no analytics" while the edge runs a beacon is a false statement.
    for (const l of LOCALES) {
      const html = await body(`/privacy?lang=${l}`);
      expect(html).toContain(escapeHtml(dictionaries[l].privacyServiceHosting));
      expect(dictionaries[l].privacyServiceHosting).toMatch(/cookie/i);
    }
  });
});

// eisenhower.school/privacy — the formal notice.
//
// It exists because a parent asked the right question and deserved an answer
// they could read without an account, and because "we take privacy seriously"
// is not an answer. Every claim on this page is one the code can be checked
// against, which is the only kind worth publishing: private-by-default is
// `contact_item.visibility`, the absent public level is the absent fourth
// chip, the approval step is invariant 32, and the list of services is the set
// of hostnames this project actually fetches.
//
// Three properties it shares with `/faq`, for the same reasons:
//
//  - It makes NO subrequest, so it is a pure function of the URL,
//    `Accept-Language` and the `sd_lang` cookie. A privacy notice that could be
//    emptied by the API having a bad afternoon would be worse than none.
//  - Every word comes from the shared dictionaries (invariant 6), so it exists
//    in all four languages the day `LOCALES` does — and this is the page where
//    that matters most, since the families least likely to read English are the
//    ones with least other recourse if the answer is wrong.
//  - It is an INDEXED surface (the fifth), so nothing member-private may appear
//    on it and `INDEXED_PATHS` in index.ts is what puts it in the sitemap.
//
// One thing it does NOT do: ask to be agreed to. There is no banner, no
// checkbox and no "by continuing you accept". Consent theatre on a school
// directory would be a lie about who holds the power here — a parent's real
// control is the per-field visibility setting and the delete button, both of
// which this page points at.
//
// `privacyBusBody` is a promise made in public, in four languages, to families
// who asked — transportation data is the thing the concern that prompted this
// page named outright. What depends on it is the trust of every family who
// reads it: if a future version of this project ever wants that data, this page
// changes first and the change is visible to everyone, which is the whole point
// of writing a commitment down rather than merely intending it.

import { LOCALES, dictionaries, interpolate, type Locale, type Strings } from "@sd/shared";
import type { Env } from "./env.js";
import {
  alternatesFor,
  document,
  escapeHtml,
  langBar,
  langHref,
  siteFooter,
  siteHeader,
} from "./shell.js";

/** The path, exported so the router, the sitemap and the page's own `?lang=`
 *  links can never disagree about where this lives. */
export const PRIVACY_PATH = "/privacy";

/**
 * The date the notice last changed, as an ISO day.
 *
 * Hand-maintained and deliberately not `new Date()`: a notice that claims to
 * have been updated today, every day, tells a reader nothing and is the exact
 * shape of a dark pattern. Bump it when the WORDS change, not when the Worker
 * redeploys.
 */
const LAST_UPDATED = "2026-11-11";

function updatedLabel(locale: Locale): string {
  // The day is formatted in the reader's locale but fixed in the school's
  // sense of when it changed — there is no per-reader timezone here and a
  // notice does not change meaning overnight, so the plain ISO day is parsed
  // as a date and rendered by name.
  const d = new Date(`${LAST_UPDATED}T12:00:00Z`);
  try {
    return d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return LAST_UPDATED;
  }
}

export function renderPrivacy(env: Env, locale: Locale, explicit: boolean): string {
  const s: Strings = dictionaries[locale];
  const t = (key: keyof Strings, vars?: Record<string, string>) =>
    vars ? interpolate(s[key], vars) : s[key];
  const school = env.SCHOOL_NAME;
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");

  /** The one list of things we hold. Written as bullets rather than a
   *  paragraph because a reader scanning for "does it have my address?" should
   *  find the line, not the sentence it is buried in. */
  const held = [s.privacyHoldName, s.privacyHoldContact, s.privacyHoldPhoto, s.privacyHoldChild]
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  /** Third parties, each with what it actually sees. The bar for appearing
   *  here is "data reaches them", not "we have a contract with them". */
  const services = [
    s.privacyServiceHosting,
    s.privacyServiceEmail,
    s.privacyServiceMaps,
    s.privacyServiceStore,
    s.privacyServiceTranslate,
    s.privacyServiceAdmin,
    // Workers AI is Cloudflare too, but it is named on its own line: "a model
    // looks at photos" is a different act from "stores the database", and a
    // reader deciding whether to trust the lost & found should find it.
    s.privacyServiceAi,
    s.privacyServiceFonts,
  ]
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  /** A titled block. The bus commitment gets the same shape as everything else
   *  on purpose — singling it out with a box would read as a concession rather
   *  than a statement of what the system does. */
  const block = (title: string, body: string) => `
        <div class="pv-block">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(body)}</p>
        </div>`;

  const body = `
    ${siteHeader(env, locale, s)}

    <main>
      <section class="fq-hero">
        <div class="wrap">
          <h1>${escapeHtml(t("privacyTitle"))}</h1>
          <p class="fq-lead">${escapeHtml(t("privacyLead", { school }))}</p>
          <p class="pv-updated">${escapeHtml(t("privacyUpdated", { date: updatedLabel(locale) }))}</p>
          ${langBar(locale, PRIVACY_PATH, origin)}
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap pv-body">
          <div class="pv-block">
            <h2>${escapeHtml(t("privacyHoldTitle"))}</h2>
            <p>${escapeHtml(t("privacyHoldBody"))}</p>
            <ul class="pv-list">${held}</ul>
            <p>${escapeHtml(t("privacyHoldAddress"))}</p>
          </div>

          ${block(s.privacyDefaultTitle, s.privacyDefaultBody)}
          ${block(s.privacyChildrenTitle, s.privacyChildrenBody)}
          ${block(s.privacyBusTitle, s.privacyBusBody)}
          ${block(s.privacyWhoTitle, s.privacyWhoBody)}
          ${block(s.privacyDeleteTitle, s.privacyDeleteBody)}
          ${block(s.privacyLostFoundTitle, s.privacyLostFoundBody)}

          <div class="pv-block">
            <h2>${escapeHtml(t("privacyServicesTitle"))}</h2>
            <p>${escapeHtml(t("privacyServicesBody"))}</p>
            <ul class="pv-list">${services}</ul>
          </div>

          ${block(s.privacyNeverTitle, s.privacyNeverBody)}

          <div class="pv-block">
            <h2>${escapeHtml(t("privacyContactTitle"))}</h2>
            <p>
              ${escapeHtml(t("privacyContactBody"))}
              <a href="mailto:${escapeHtml(env.FEEDBACK_EMAIL)}">${escapeHtml(env.FEEDBACK_EMAIL)}</a>
            </p>
          </div>
        </div>
      </section>
    </main>

    ${siteFooter(env, locale, s)}`;

  return document({
    lang: locale,
    title: `${t("privacyTitle")} — ${school}`,
    description: t("privacyDescription", { school }),
    // An explicit `?lang=` is its own document with its own canonical, exactly
    // as on the landing page and `/faq` — that is what makes the hreflang set
    // coherent rather than four URLs claiming to be the same page.
    canonical: `${origin}${explicit ? langHref(locale, PRIVACY_PATH) : PRIVACY_PATH}`,
    head: alternatesFor(origin, PRIVACY_PATH),
    body,
  });
}

/** Every locale's notice renders — the check worth having on a page whose job
 *  is to be readable by the families least served by an English-only answer. */
export function everyLocaleRenders(env: Env): boolean {
  return LOCALES.every((l) => renderPrivacy(env, l, false).includes("<h1>"));
}

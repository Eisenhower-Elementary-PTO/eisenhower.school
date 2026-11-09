// How a returned lost & found item's claimant hears about it — the ONE message
// the lost & found ever sends a family.
//
// Shared on purpose: the API's notification email (apps/api/src/lib/email.ts)
// and the staff dashboard's prefilled text-message / copy-message links
// (apps/lostandfound) both render THIS builder, so the automatic and the
// manual way of saying "it's on its way" can't drift apart.
//
// Two rules the builder enforces by construction:
//
//  - It names the ITEM and the school, never a child. The claim row holds the
//    child's name and room, and the temptation is to say "sent home with Milo"
//    — but the contact address was typed free-hand on a public form, and a
//    typo must not deliver a child's name and placement to a stranger. The
//    item title is already public (it is the browse page's text).
//
//  - The claim's own language picks the dictionary. The claim form is
//    translated; a family that asked in Somali gets the answer in Somali.
//    Chrome-vs-content (invariant 6) doesn't apply: every string here is ours.

import { dictionaries, interpolate } from "./i18n.js";
import type { Locale } from "./types.js";
import { LOCALES } from "./types.js";

/** How the item physically went home — the one question staff answer. */
export const LF_RETURN_METHODS = ["classroom", "office", "family"] as const;
export type LfReturnMethod = (typeof LF_RETURN_METHODS)[number];

export function isLfReturnMethod(v: unknown): v is LfReturnMethod {
  return typeof v === "string" && (LF_RETURN_METHODS as readonly string[]).includes(v);
}

/** A stored claim `lang` back as a Locale — forgiving on read, like
 *  parseClaimNotifyEmails: a legacy or hand-edited value falls back to
 *  English rather than throwing on the notify path. */
export function lfClaimLocale(v: unknown): Locale {
  return LOCALES.find((l) => l === v) ?? "en";
}

export interface LfReturnMessage {
  subject: string;
  /** Plain text, two short paragraphs. The email's text part and the SMS body
   *  alike; the email's HTML part is built from the same lines. */
  body: string;
}

const BODY_KEY = {
  classroom: "lfReturnBodyClassroom",
  office: "lfReturnBodyOffice",
  family: "lfReturnBodyFamily",
} as const;

export function lostFoundReturnMessage(locale: Locale, method: LfReturnMethod, itemTitle: string): LfReturnMessage {
  // `brand` is the school's name in every dictionary — not env.SCHOOL_NAME,
  // which names the PTO and would misname the school's own front office. It
  // also keeps this builder callable from the browser, where no env exists.
  const d = dictionaries[locale];
  const vars = { item: itemTitle.trim() || d.lfDescribing, school: d.brand };
  return {
    subject: interpolate(d.lfReturnSubject, vars),
    body: `${interpolate(d[BODY_KEY[method]], vars)}\n\n${interpolate(d.lfReturnClosing, vars)}`,
  };
}

/** Email-shaped, the one rule for "may the system mail this contact" — the
 *  server's guard on the notify route and the dashboard's choice of button
 *  ask the same question. Same shape the dashboard's contact link renders as
 *  a mailto:. */
export function lfContactIsEmail(contact: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());
}

/** The digits of a phone-shaped contact, for an `sms:`/`tel:` link — or null
 *  when the contact isn't plainly a phone number. */
export function lfContactPhone(contact: string): string | null {
  const c = contact.trim();
  if (!/^[\d\s()+.-]{7,}$/.test(c)) return null;
  return c.replace(/[^\d+]/g, "");
}

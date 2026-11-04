// Small text helpers shared across the API and web client.

import type { GroupKind } from "./types.js";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

function codePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** Convert (untrusted) HTML to readable plain text. Block/line-break tags become
 *  newlines, list items get bullets, all other tags are stripped, and HTML
 *  entities are decoded. Used to display ICS DESCRIPTION fields that contain
 *  HTML markup — we render the result as text (never as HTML), so feed content
 *  can't inject markup. Plain text passes through essentially unchanged. */
export function htmlToText(input: string): string {
  return input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Group names ─────────────────────────────────────────────────────────────

/** The separator this instance's four-part classroom names are built with.
 *
 *  Only the middle dot counts. An EN dash is inside "Ruiz–Lee", so splitting on
 *  dashes would cut a family down the middle of its surname, and a comma is
 *  punctuation a teacher may simply have typed. An EM dash is the other
 *  convention in use here ("Room 12 — Ms. Okonkwo") and is deliberately still
 *  not a separator: every name of that shape is already two segments, so the
 *  rule below would return it unchanged anyway, and admitting a third dash
 *  character buys nothing for the risk of confusing it with the first two.
 *  A name with no `·` has no structure this can read and comes back untouched,
 *  which is what leaves CSS to do the clipping in that case. */
const NAME_SEP = "·";

/** Which segment names the year. Word-bounded rather than whole-segment for
 *  the two spelled-out forms, so `Kindergarten AM` is still recognised as one;
 *  a bare `K` has no boundary to find, hence the anchored alternative. */
const GRADE_RE = /^k$|\bkindergarten\b|\bgrade\b/i;

/** How the year is ABBREVIATED, first match winning.
 *
 *  `Grade 2 · …` and `Kindergarten · …` are longer than they need to be on a
 *  subline that already competes with a person's name, and `Gr 2` and `K` are
 *  how the school's own paperwork writes them.
 *
 *  Note what this costs, because it is a real step past eliding: `Gr` and `K`
 *  are not words the school typed, only prefixes of ones it did. Invariant 6
 *  is still satisfied — nothing here is RESTATED in another language, and the
 *  abbreviation is of English into the same English — but it is the one place
 *  the label is not purely the school's own characters. Both entries were
 *  asked for by name; a THIRD wants the same deliberation rather than being
 *  waved through on the strength of these two.
 *
 *  A bare `K` matches neither pattern and passes through unchanged, which is
 *  the right outcome: it is already the abbreviation. */
const YEAR_ABBREV: readonly (readonly [RegExp, string])[] = [
  [/\bkindergarten\b/i, "K"],
  [/\bgrade\b/i, "Gr"],
];

function abbreviateYear(segment: string): string {
  for (const [re, short] of YEAR_ABBREV) {
    if (re.test(segment)) return segment.replace(re, short);
  }
  return segment;
}

/** Which segment names the room. It must carry a DIGIT, so a programme called
 *  "Room to Grow" is not mistaken for one and the segment beside it read as a
 *  teacher. */
const ROOM_RE = /^(rm\.?|room)\b[^0-9]*[0-9]/i;

/** A classroom's name, reduced to the year and the teacher's surname.
 *
 *  This instance's rooms are named by the district's roster export and run four
 *  segments — `Grade 2 · Juntos · Pam Shrestha · Rm 322` — which is forty
 *  characters of subline under a person's name that has to stay the widest
 *  thing on the row. CSS ellipsis alone answers that badly, because it clips
 *  from the END: every child in a grade would truncate to the same
 *  `Grade 2 · Juntos · Pam Sh…`, which is worse than useless on a list whose
 *  whole job is telling two children apart.
 *
 *  So the label is `Gr 2 - Shrestha`, or `K - Ortiz`: the year, and the name a
 *  parent actually uses for a room. Two rooms in one grade differ in their teacher,
 *  which is exactly the pair a reader is trying to distinguish.
 *
 *  **It reads its segments by SHAPE, not by position**, and that is the part to
 *  understand before changing it. The order is not stable across this project's
 *  own data: production rooms run grade-programme-teacher-room, while the demo
 *  seed's `Ms. Ruiz · Grade 4` puts the teacher FIRST. So the grade is whichever
 *  segment says "grade" (or names kindergarten), the room is whichever carries
 *  `Rm`/`Room` AND a digit, and the teacher is the segment BEFORE the room —
 *  falling back, where there is no room, to the last segment that is not the
 *  grade. That is what lets one rule read both shapes. It also means a
 *  programme name (`Juntos`, `XinXing`) is never mistaken for a teacher: it is
 *  identified by being adjacent to the room, not by being left over.
 *
 *  The surname is the last whitespace-separated word of that segment, so
 *  `Pam Shrestha` and `Ms. Ruiz` both reduce correctly. A teacher whose surname
 *  is itself two words (`Van Dyke`) reduces to the last of them; that is the
 *  known cost of a rule with no list of names to consult, and it stays wrong in
 *  a legible way rather than guessing.
 *
 *  That a person is written "First Last" is also what tells a teacher from a
 *  PROGRAMME: a one-word segment beside the room is `Juntos`, not somebody, so
 *  `Grade 2 · Juntos · Rm 322` — a room with no teacher recorded — comes back
 *  whole rather than labelled "Grade 2 - Juntos". The cost is a bare surname
 *  with no forename, which this refuses to read; the district's export has
 *  never written one, and refusing is the safe direction.
 *
 *  **Anything it cannot read comes back byte for byte**: fewer than two
 *  segments, no grade segment, no teacher distinct from the grade. A name with
 *  no `·` has no structure to read at all, which is what leaves CSS to clip
 *  `Room 12 — Ms. Okonkwo`. Silence beats a confident mislabel, because a row
 *  showing the WRONG room is worse than one showing a long right one.
 *
 *  It splits on the middle dot alone. An EN dash is inside "Ruiz–Lee", so
 *  splitting on dashes would cut a family down the middle of its surname, and a
 *  comma is punctuation a teacher may simply have typed.
 *
 *  It is **eliding, not translating**: invariant 6 forbids restating
 *  member-entered content in another language, and every character this returns
 *  is still the school's own. Nothing is lost either — the full name stays on
 *  `ClassroomRefDTO.name`, and a caller that shortens is expected to carry the
 *  original as a `title`.
 *
 *  Deliberately NOT applied to a household or a generic group; `groupLabel` is
 *  the kind test. The rule reads "grade" and "teacher" and only a classroom has
 *  those — `Grade 4 · Chess Club · Eisenhower` would come back as
 *  `Grade 4 - Eisenhower`, dropping the one segment that names the thing.
 *
 *  **This is a rendering step and must stay one.** Do not normalise a name on
 *  write with it: `resolveGroup` in `lib/bulkImport.ts` matches an existing
 *  group by exact, case-sensitive `WHERE name = ?`, so a roster import re-run
 *  against shortened names would fail to recognise the rooms it made last time
 *  and mint a duplicate of every one. `grp.name` stays the district's string;
 *  only the label changes. */
export function shortClassroomName(name: string): string {
  const parts = name.split(NAME_SEP).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return name;

  const grade = parts.find((p) => GRADE_RE.test(p));
  if (!grade) return name;

  // The teacher sits beside the room where there is one, because that is the
  // only anchor both name shapes share. Without a room, the teacher is the last
  // segment that is not the grade — which is the seed's `Ms. Ruiz · Grade 4`.
  const roomIdx = parts.findIndex((p) => ROOM_RE.test(p));
  const teacher = roomIdx > 0
    ? parts[roomIdx - 1]
    : [...parts].reverse().find((p) => p !== grade);
  // A person here is written "First Last", so a one-word segment is a
  // PROGRAMME, not a teacher: `Grade 2 · Juntos · Rm 322` names no teacher at
  // all, and without this it would be labelled "Grade 2 - Juntos" — a
  // programme presented as a person. Refusing turns a mislabel into no label,
  // which is the trade the whole rule is built on.
  if (!teacher || teacher === grade || !/\s/.test(teacher)) return name;

  const surname = teacher.split(/\s+/).filter(Boolean).pop();
  return surname ? `${abbreviateYear(grade)} - ${surname}` : name;
}

/** The one-line label for a group, whatever its kind.
 *
 *  `shortClassroomName` is deliberately named for the one kind it understands,
 *  so every caller that renders a mixed list of groups had to remember both the
 *  rule and the `kind` test that guards it. This is that test, written once: a
 *  classroom is elided, a household and a generic group come back untouched.
 *  It generalises the DISPATCH, not the rule — the segment-reading stays where
 *  its own doc comment explains what a segment means.
 *
 *  Every caller pairs it with `title={group.name}`, because the label is the
 *  only thing elided and the row must still carry the school's own string. Two
 *  consequences follow from that pairing and are the reason it is not optional.
 *  The full name stays in the DOM, so nothing is hidden from a reader who looks,
 *  from a hover, or from anything that reads the page. And `GET /groups` matches
 *  on the whole name — a search for a teacher finds rooms whose LABEL no longer
 *  shows them — which is invariant 18 read the safe way round (a row renders
 *  more than the label shows, never less) only because the `title` is there to
 *  show what matched. A group name is not private in the first place: any member
 *  may search every one of them, which is why this is a legibility trade and not
 *  a disclosure one.
 *
 *  A caller whose name WRAPS rather than clips — the pickers in the sheets, a
 *  profile's group card — uses this too, but must not gain an ellipsis on the
 *  way: wrapping loses nothing, and trading two readable lines for one cut-off
 *  one is the exact bug this exists to fix. Elide the label, leave the layout. */
export function groupLabel(name: string, kind: GroupKind): string {
  return kind === "classroom" ? shortClassroomName(name) : name;
}

// ── Newsletter slugs ────────────────────────────────────────────────────────

/** Title → URL segment. ASCII-folded, lowercase, hyphenated, length-capped.
 *  Non-Latin titles can reduce to nothing; callers fall back to the date alone,
 *  which is still a valid, readable slug. */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    // Strip combining marks so "Año" → "Ano" rather than losing the letter.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The public URL segment for an issue: a date the reader can parse plus the
 *  title. Deliberately human-readable and therefore enumerable — issues are
 *  public by design, and nothing member-private may go in one. */
export function issueSlug(title: string, nowIso: string): string {
  const date = nowIso.slice(0, 10);
  const tail = slugifyTitle(title);
  return tail ? `${date}-${tail}` : date;
}

/** The public URL segment for a volunteer sheet: the event's title followed by
 *  the occurrence's date, e.g. "fall-carnival-2026-10-17". Title-first rather
 *  than date-first (the inverse of `issueSlug`) because this link is pasted into
 *  a message asking people to sign up, where the event name is what identifies
 *  it — an archived newsletter is identified by when it went out.
 *
 *  Enumerable by design, on the same terms as an issue slug: the page it
 *  addresses publishes counts, never volunteer names. */
export function volunteerSheetSlug(title: string, occurrenceStartIso: string): string {
  const date = occurrenceStartIso.slice(0, 10);
  const head = slugifyTitle(title);
  return head ? `${head}-${date}` : date;
}

// ── Money ───────────────────────────────────────────────────────────────────

/** Integer cents → "$24.00".
 *
 *  Every amount in the store is integer cents (migration 0022), and three
 *  surfaces render one: the confirmation email, the server-rendered storefront,
 *  and the cart. They live in three packages that cannot import each other, but
 *  they can all import this — so a receipt, a price tag and a total can't
 *  disagree about rounding. */
export function formatMoney(cents: number, currency = "usd"): string {
  const amount = (cents / 100).toFixed(2);
  return currency.toLowerCase() === "usd" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

/** Where this instance's source lives.
 *
 *  Every footer in the project links here — the four SPAs, the front door, the
 *  storefront and the newsletter archive — so it is one constant rather than six
 *  copies of a URL that would drift the day somebody forks this. It is safe to
 *  print because the repository is deliberately PUBLIC: nothing member-private
 *  has ever lived in it (secrets are wrangler secrets, and the seed data is
 *  invented), which is the property to re-check before pointing this at a
 *  different repo. */
export const SOURCE_URL = "https://github.com/Eisenhower-Elementary-PTO/eisenhower.school";

/** The PTO's own site — who the PTO is, the year, and how to donate.
 *
 *  Here beside SOURCE_URL and for the same reason: every footer in the project
 *  links to it, so it is one constant rather than six copies of a URL that would
 *  drift. Unlike the sibling app origins in each app's `lib/api.ts`, this one is
 *  not build-time configurable — it is the public face of the organisation that
 *  runs this instance, in the same category as the source repository, and the
 *  footer credit line is the one place every app says whose site this is. */
export const PTO_URL = "https://pto.eisenhower.school";

// Reading the directory is granted, not conferred by signing up (migration
// 0029, invariant 32). This file is the whole of that decision: what a complete
// application looks like, what state an account is in, and the guard the gated
// routes call.
//
// WHY AN APPLICATION AND NOT AN ALLOWLIST. An allowlist judges an email
// address, which asserts nothing and can be checked against nothing short of
// the district's own family roster — and asking for that roster would put
// education records in this system, which today holds none. An application
// judges what the applicant TYPED: their name, their child's name, and the room
// that child is in, chosen from the classroom groups this instance already
// carries under the district's own names. A reviewer checks that in seconds.
//
// WHAT APPROVAL IS NOT. It is not proof of anything. A determined person can
// type a plausible room. What it removes is the ANONYMOUS population: every
// reader of the directory has told us a child's name and a teacher, and that is
// attribution. Rate limiting is the other half and is a separate mechanism.

import type { AccessClaimStatusDTO, DirectoryAccessState } from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import { personListableSql } from "./privacy.js";
import { postToSlack } from "./slack.js";
import { nowIso } from "./time.js";

/** The dates the state is derived from. Never stored as a word: `approved` and
 *  `declined` are both dates, and a stored label could disagree with them. */
export interface AccessRow {
  access_submitted_at: string | null;
  access_approved_at: string | null;
  access_declined_at: string | null;
}

/**
 * Approval wins over a decline, so re-approving a declined account is a plain
 * UPDATE of `access_approved_at` rather than a two-column dance — and a
 * reviewer who declined by mistake fixes it with the button they already have.
 */
export function accessStateOf(row: AccessRow, isSystemAdmin = false): DirectoryAccessState {
  if (isSystemAdmin || row.access_approved_at) return "approved";
  if (row.access_declined_at) return "declined";
  if (row.access_submitted_at) return "pending";
  return "incomplete";
}

/**
 * Is there a claim here worth reviewing?
 *
 * Three questions, each one a sentence the form can point at when the button is
 * disabled. They are deliberately about SHAPE rather than truth — nothing here
 * can tell whether the child is real, and pretending otherwise would be the
 * allowlist's mistake in a new place. What they guarantee is that a reviewer is
 * given something to look at.
 *
 * `studentPlaced` accepts a `self_asserted = 1` membership, which is the only
 * kind a parent can create for their own child (invariant 27) — the whole point
 * is that they tell us the room and somebody then decides whether to believe
 * it. Approval is what promotes that row to trusted.
 *
 * TWO ROUTES, because the school is not only parents. The first version asked
 * every applicant for a child, which a teacher, the office or the nurse cannot
 * produce — so they met a form with two conditions they could never satisfy and
 * a button that never enabled. They were not locked out (an admin can approve
 * from the "Never asked" tab) but they had no way to ASK, and nothing told
 * anyone they were waiting. A gate with no door for a whole category of the
 * people it serves is a bug, not a policy.
 *
 * So a Person the applicant controls holding `teacher` or `staff` is the other
 * way to a complete claim. Anyone can assert that — both are in
 * `ASSIGNABLE_CAPABILITIES` and `POST /me/persons` asks nobody, the same thing
 * invariant 27 says about `student` — and that is fine for the same reason it
 * is fine there: this decides what a reviewer is SHOWN, not what anyone may
 * read. "I teach in Rm 110" is exactly as checkable by a human who has the
 * staff list as "my child is in Rm 110", and both still wait for that human.
 *
 * Staff are deliberately NOT asked for a classroom. A teacher has a room; the
 * office, the nurse and the custodian do not, and requiring one would rebuild
 * the dead end a segment further along. The free-text note is where a staff
 * applicant says which room or which job, and the admin queue shows it.
 *
 * Reads `person` only through `control`, so which Persons exist to this caller
 * was already settled by the join: the applicant's own. It spends none of
 * test/personListable.test.ts's exemption budget.
 */
export async function accessClaimStatus(env: Env, userId: string): Promise<AccessClaimStatusDTO> {
  // Composed rather than exempted, and not the ceremony it looks like: the
  // caller is by definition NOT a system admin here (an admin is approved and
  // never sees this form), so the predicate is the real two-branch one rather
  // than the literal "1" invariant 22 warns reads like a guard. For the
  // applicant's own family the control disjunct is what admits every row —
  // including an unlisted child of their own, who must still make the
  // application complete.
  const listable = personListableSql(userId, false, "p");
  // ALL-ANONYMOUS binds, deliberately. An earlier version used `?1` for the
  // three `user_id` terms and let `personListableSql` contribute an anonymous
  // `?`; SQLite numbers a bare `?` as one past the highest index so far, so it
  // worked only because both values happened to be `userId`. The day that
  // helper emits a second bind, or a different one, every position after it
  // shifts and this silently counts the wrong rows — and a fake D1 that
  // ignores binds cannot see it. One style per statement, like the rest of the
  // API.
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM control c
          JOIN person p ON p.id = c.person_id
         WHERE c.user_id = ?
           AND ${listable.sql}
           AND trim(coalesce(p.first_name,'')) <> ''
           AND trim(coalesce(p.last_name,'')) <> '') AS named,
       (SELECT COUNT(*) FROM control c
          JOIN capability_grant g ON g.person_id = c.person_id AND g.capability = 'student'
         WHERE c.user_id = ?) AS students,
       (SELECT COUNT(*) FROM control c
          JOIN capability_grant g ON g.person_id = c.person_id AND g.capability = 'student'
          JOIN membership m ON m.person_id = c.person_id
          JOIN grp gr ON gr.id = m.group_id AND gr.kind = 'classroom'
         WHERE c.user_id = ?) AS placed,
       (SELECT COUNT(*) FROM control c
          JOIN capability_grant g ON g.person_id = c.person_id
         WHERE c.user_id = ? AND g.capability IN ('teacher','staff')) AS staff,
       ${hasContactInfoSql()} AS contact`,
  )
    .bind(userId, ...listable.binds, userId, userId, userId, userId, userId)
    .first<{ named: number; students: number; placed: number; staff: number; contact: number }>();

  const selfNamed = (row?.named ?? 0) > 0;
  const hasStudent = (row?.students ?? 0) > 0;
  const studentPlaced = (row?.placed ?? 0) > 0;
  const isStaff = (row?.staff ?? 0) > 0;
  const contact = (row?.contact ?? 0) > 0;
  return {
    selfNamed,
    hasStudent,
    studentPlaced,
    isStaff,
    hasContactInfo: contact,
    // Either route, a name on both — and something for the directory to hold:
    // the read gate (`hasContactInfo`, above) requires contact info after
    // approval, so the form requires it before, or a family would clear the
    // review and still meet a locked directory with no warning.
    complete: selfNamed && contact && (isStaff || (hasStudent && studentPlaced)),
  };
}

/**
 * Has this account's FAMILY contributed at least one piece of contact
 * information? Reading the directory is reciprocal: approval says who you are,
 * this says you brought something to it — a member who shares nothing does not
 * get to browse what everyone else shared. Both are required before
 * `AuthContext.isApproved` resolves true (system admins excepted — theirs is a
 * duty, not browsing).
 *
 * Family-level, deliberately: an item on ANY Person the account controls
 * counts, and so does one on a household the family belongs to (reached
 * through a controlled Person's membership) — a second parent whose partner
 * already entered the home phone has provided it in every sense that matters,
 * and telling them otherwise would demand a duplicate row. Visibility is NOT
 * consulted: what the directory asks for is that the information exists here
 * at all, and requiring `service` would make the privacy-first default
 * (invariant 3) fail a gate it has no reason to fail.
 *
 * One spelling of the predicate, emitted as a fragment so the session
 * middleware can fold it into a statement it already makes. `userRef` is how
 * the statement names the account — the default anonymous `?` contributes TWO
 * binds, both the user id, in the order the fragment is spliced.
 * Reads `contact_item`, `control`, `membership`, `grp` — never `person`, so it
 * spends none of test/personListable.test.ts's exemption budget.
 *
 * The household branch carries `self_asserted = 0`, the clause invariant 31
 * says every membership-derived privilege read must carry and a second copy
 * forgets. It cannot be violated today — only classrooms self-assert, and
 * classrooms are not households — but this read CONFERS something (it opens
 * the gate), and the day another membership kind becomes self-assertable, a
 * self-placed row must not let an account satisfy reciprocity off another
 * family's household phone number.
 */
export function hasContactInfoSql(userRef = "?"): string {
  return `EXISTS (
    SELECT 1 FROM contact_item ci
     WHERE (ci.owner_kind = 'person'
            AND ci.owner_id IN (SELECT person_id FROM control WHERE user_id = ${userRef}))
        OR (ci.owner_kind = 'group'
            AND ci.owner_id IN (SELECT m.group_id FROM membership m
                                  JOIN control c2 ON c2.person_id = m.person_id
                                  JOIN grp g ON g.id = m.group_id AND g.kind = 'household'
                                 WHERE c2.user_id = ${userRef}
                                   AND m.self_asserted = 0)))`;
}

/** The fragment above as a one-row read, for the places that are not already
 *  mid-statement (`GET /me`, which has to report the state to the client). */
export async function hasContactInfo(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT ${hasContactInfoSql()} AS has_contact`)
    .bind(userId, userId)
    .first<{ has_contact: number }>();
  return (row?.has_contact ?? 0) > 0;
}

/** One account's access row. Its own read because `GET /me` needs the two
 *  dates the session join deliberately doesn't carry — the session wants a
 *  boolean, this wants to explain itself. */
export async function accessRowOf(env: Env, userId: string): Promise<AccessRow> {
  const row = await env.DB.prepare(
    "SELECT access_submitted_at, access_approved_at, access_declined_at FROM user WHERE id = ?",
  )
    .bind(userId)
    .first<AccessRow>();
  return (
    row ?? { access_submitted_at: null, access_approved_at: null, access_declined_at: null }
  );
}

/** Thrown by `requireApproved`, turned into a 403 by the app's onError. The
 *  body names the gate so a client can route to the application screen rather
 *  than showing a generic failure — it discloses nothing, since the caller is
 *  authenticated and is being told about their own account. */
export class DirectoryAccessError extends Error {
  constructor() {
    super("directory_access_required");
  }
}

/**
 * The guard for a route that serves one family's data to another.
 *
 * `auth.isApproved` is the COMBINED gate the session middleware resolves:
 * admin approval AND at least one piece of contact information contributed
 * (`hasContactInfoSql`), system admins excepted. A member who later deletes
 * their last contact item re-closes the directory on their next request; the
 * client learns which half is missing from `GET /me`, not from this 403.
 *
 * Deliberately a function called at the top of a handler rather than a
 * middleware mounted on a path: the routes needing it are not a path prefix —
 * `GET /groups/:id` must still serve a household the caller belongs to, and
 * `GET /persons/:id` must still serve their own children — so a prefix mount
 * would either lock a pending member out of their own family or, worse, look
 * like it covered routes it never ran on.
 */
export function requireApproved(auth: AuthContext): void {
  if (!auth.isApproved) throw new DirectoryAccessError();
}

// ── Rate limiting the same reads ────────────────────────────────────────────
//
// The gate above decides WHETHER an account may read other families; this
// bounds HOW FAST. They are complements and both are needed: approval removes
// the anonymous population, and this is what stops an approved member — or a
// stolen session — from paging the whole roster with a script. Neither is a
// substitute for the other, which is why they sit in one file and are called
// together.
//
// Per USER, not per IP. The thing being limited is an authenticated member
// enumerating people, and a family behind one NAT address (or a school's own
// network) must not throttle itself because a neighbour is browsing.

/** Reads of other families one account may make in a UTC day.
 *
 *  The per-minute binding allows about 86,000 a day, which slows a scripted
 *  crawl without stopping it. A parent looking people up makes a few dozen of
 *  these requests on a busy day — a directory page is one read, a profile is
 *  one read — so 500 is far above real use and far below a whole school. */
export const DAILY_READ_LIMIT = 500;

/** Thrown by `enforceReadRate`, turned into a 429 by the app's onError.
 *  `retryAfter` is seconds: 60 for the per-minute window, the time to the next
 *  UTC midnight for the daily one, so a client that honours it waits the right
 *  amount either way. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfter: number = 60) {
    super("rate_limited");
  }
}

/** Which limit refused a read. Named in the log and the alert because the two
 *  mean different things: tripping the minute window can be one impatient
 *  person, reaching 500 in a day is not. */
export type ReadLimit = "minute" | "daily";

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Bound one account's rate of reading OTHER families, per minute and per day.
 *
 * ONE switch for both: an absent `READ_LIMIT` binding means the whole budget is
 * off, the contract an absent `SLACK_WEBHOOK_URL` has — so tests and local dev
 * need no limiter, write no counter rows, and behave exactly as before.
 *
 * A system admin is NOT exempt. The temptation is to wave them through, and
 * the reason not to is that an admin session is the most valuable one to steal:
 * the account that can read every family is the one where an unbounded read
 * rate costs the most. Nothing an admin legitimately does on these routes comes
 * near either limit — the bulk operations (backup, import) are single requests
 * on other paths.
 *
 * Every budgeted request is COUNTED, including ones the minute window then
 * refuses. A script retrying against a 429 therefore spends its day, which is
 * the point; a person does not retry fast enough for it to matter.
 *
 * Failures are LOUD but never fatal. The limiter or D1 having a bad minute must
 * not take the directory down, so a throw here admits the request and says so
 * in the log — same direction as an unbound binding, for the same reason.
 */
export async function enforceReadRate(env: Env, auth: AuthContext, now: Date = new Date()): Promise<void> {
  const limiter = env.READ_LIMIT;
  if (!limiter) return;
  const day = utcDay(now);

  // Keyed on the effective user. During masquerade that is the TARGET, which
  // is right: the budget belongs to whoever's data is being walked, and an
  // admin who masquerades to scrape spends the budget they are borrowing.
  let reads = 0;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO read_budget (user_id, day, reads) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET reads = reads + 1
       RETURNING reads`,
    )
      .bind(auth.userId, day)
      .first<{ reads: number }>();
    reads = row?.reads ?? 0;
  } catch (err) {
    console.error(`[ratelimit] daily counter unavailable, allowing: ${String(err)}`);
  }
  if (reads > DAILY_READ_LIMIT) {
    await refuse(env, auth, day, "daily", reads, secondsToUtcMidnight(now));
  }

  let allowed = true;
  try {
    ({ success: allowed } = await limiter.limit({ key: auth.userId }));
  } catch (err) {
    console.error(`[ratelimit] limiter unavailable, allowing: ${String(err)}`);
    return;
  }
  if (!allowed) await refuse(env, auth, day, "minute", reads, 60);
}

/**
 * Log, alert once per account per day, and throw.
 *
 * Loud, and it names the account: this is a member reading other families
 * faster or further than a person does, which is the shape the access gate
 * exists to make attributable. It is deliberately not an audit row —
 * `audit_log` is for mutations (invariant 5) and a refused GET changed nothing.
 *
 * It IS a Slack line, unlike the sign-in cap in routes/auth.ts, because the two
 * refusals mean different things. A sign-in cap trips on somebody else's
 * address being typed; this trips on a signed-in, approved member walking the
 * roster, and a copy that has left the building cannot be recalled — the only
 * useful moment to hear about it is while it is happening. The alert carries
 * the account's email (the identifier `auth.registered` and the admin lines
 * already put in the channel), which limit, and a count. Nothing about who was
 * READ: the channel is a third party (invariant 22), and the question it
 * answers is "who is scraping", not "whom".
 *
 * Posted inline rather than in `waitUntil`, because it happens at most once per
 * account per day and `postToSlack` never throws.
 */
async function refuse(
  env: Env,
  auth: AuthContext,
  day: string,
  which: ReadLimit,
  reads: number,
  retryAfter: number,
): Promise<never> {
  console.warn(`[ratelimit] ${which} read budget exhausted user=${auth.userId} reads_today=${reads}`);
  try {
    const claim = await env.DB.prepare(
      `UPDATE read_budget SET alerted_at = ?
        WHERE user_id = ? AND day = ? AND alerted_at IS NULL`,
    )
      .bind(nowIso(), auth.userId, day)
      .run();
    if ((claim.meta?.changes ?? 0) > 0) {
      await postToSlack(env, { text: readLimitSlackLine(auth, which, reads) });
    }
  } catch (err) {
    console.error(`[ratelimit] alert failed: ${String(err)}`);
  }
  throw new RateLimitedError(retryAfter);
}

/** The alert's wording, exported so the test can pin what it may say. */
export function readLimitSlackLine(auth: Pick<AuthContext, "email" | "isMasquerading">, which: ReadLimit, reads: number): string {
  const what =
    which === "daily"
      ? `reached the daily limit of ${DAILY_READ_LIMIT} directory reads`
      : `hit the per-minute directory read limit (${reads} reads today)`;
  const masq = auth.isMasquerading ? " while an admin was masquerading as them" : "";
  return `:rotating_light: *${escSlack(auth.email)}* ${what}${masq} — possible scraping. Further reads are refused until the limit resets.`;
}

/** Slack mrkdwn treats `&`, `<` and `>` as syntax; an email is escaped so it
 *  cannot forge a link. Same rule as `esc` in lib/slackNotify.ts. */
function escSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

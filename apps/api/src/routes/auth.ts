// Authentication: email-only magic links (FR-1..FR-7). The Worker branches on
// account state but responds identically, preventing account enumeration.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthStartBody } from "@sd/shared";
import type { Env, HonoEnv } from "../env.js";
import type { AuditDraft } from "../lib/audit.js";
import { ulid } from "../lib/ids.js";
import { randomToken, randomSessionId, sha256 } from "../lib/crypto.js";
import { isoPlus, isExpired, nowIso, MAGIC_LINK_TTL, SESSION_TTL } from "../lib/time.js";
import { magicLinkEmail, sendEmail } from "../lib/email.js";
import { notifyNewUser } from "../lib/notify.js";
import {
  findUserByEmail,
  isRegistrationOpen,
  normalizeEmail,
  isBootstrapAdmin,
  resolveReturnTo,
} from "../lib/db.js";
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../lib/cookies.js";
import { getCookie } from "hono/cookie";

export const auth = new Hono<HonoEnv>();

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL / 1000);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Magic links one address may be sent per rolling day. A member who mistypes,
 *  loses the mail, or clicks "resend" a few times stays well under it. */
const SIGNIN_EMAILS_PER_DAY = 5;

/** Magic links the whole instance may send per rolling day. `/auth/start` is
 *  anonymous, so without a ceiling anyone can point a loop at it and mail a
 *  member — or the whole roster — arbitrarily many sign-in links, on our send
 *  quota. Sized for a school: a genuine sign-in wave (a newsletter going out,
 *  back-to-school night) is dozens, not hundreds. */
const SIGNIN_EMAILS_PER_DAY_TOTAL = 300;

/** POST /auth/start — issue a magic link, or silently no-op. Always 200. */
auth.post("/start", async (c) => {
  const body = await c.req.json<AuthStartBody>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email || !email.includes("@")) {
    // Even malformed input gets the neutral response shape (after a soft check).
    return c.json({ ok: true });
  }

  const user = await findUserByEmail(c.env, email);
  const regOpen = await isRegistrationOpen(c.env);
  // Bootstrap admins can sign in even when registration is closed (and on a
  // bare system with no users yet), so the instance is never locked out.
  const bootstrap = isBootstrapAdmin(c.env, email);

  // Both budgets in one round trip, counted the way the newsletter's confirm cap
  // counts (invariant 14): an `auth_token` row is written ONLY on the path that
  // also sends, so these are SEND counts. A suppressed attempt leaves no row, so
  // replaying the form can neither reset the budget nor grow the table. The
  // response below is identical either way, so the cap is no more an existence
  // oracle than the rest of this route is (invariant 4).
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN email = ? THEN 1 ELSE 0 END) AS mine
       FROM auth_token
      WHERE kind = 'signin' AND created_at > ?`,
  )
    .bind(email, since)
    .first<{ total: number; mine: number | null }>();
  const overTotal = (counts?.total ?? 0) >= SIGNIN_EMAILS_PER_DAY_TOTAL;
  const overPerAddress = (counts?.mine ?? 0) >= SIGNIN_EMAILS_PER_DAY;
  if (overTotal) {
    // Loud, and deliberately not per-address: this one means the sign-in form is
    // being driven by something that isn't a family.
    console.error(
      `[auth] DAILY SIGN-IN CAP REACHED (${SIGNIN_EMAILS_PER_DAY_TOTAL}/day) — ` +
        `magic links suppressed instance-wide until the window slides`,
    );
  } else if (overPerAddress) {
    console.warn("[auth] magic link suppressed; daily cap reached for one address");
  }

  if ((user || regOpen || bootstrap) && !overTotal && !overPerAddress) {
    const token = randomToken();
    const tokenHash = await sha256(token);
    // Which app started this sign-in, so the callback returns the member there
    // instead of always APP_URL. Anything not allow-listed collapses to APP_URL.
    const returnTo = resolveReturnTo(c.env, body?.returnTo);
    await c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, reg_open_at_issue, expires_at, created_at, return_to)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
      .bind(
        ulid(),
        email,
        "signin",
        tokenHash,
        regOpen ? 1 : 0,
        isoPlus(MAGIC_LINK_TTL),
        nowIso(),
        returnTo,
      )
      .run();

    const apiOrigin = new URL(c.req.url).origin;
    const link = `${apiOrigin}/auth/callback?t=${token}`;
    const msg = magicLinkEmail(c.env, link);
    msg.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env, msg));
  }

  // Identical response whether or not anything was sent.
  return c.json({ ok: true });
});

/**
 * GET /auth/callback?t=… — the link in the email. READ-ONLY, on purpose.
 *
 * Mail scanners and "safe links" rewriters (Outlook, Proofpoint, Mimecast)
 * follow every GET in a message before the recipient ever sees it. A GET that
 * consumed the token would hand the single use to the scanner and leave the
 * member staring at "this link has expired" — every time, on those tenants.
 * Invariant 14 states exactly this reasoning for the newsletter's confirm link;
 * the sign-in door has the same shape and now takes the same shape of answer.
 *
 * So this renders a page whose form POSTs the token back. A real browser
 * auto-submits it on load, which is invisible to the member; a scanner executes
 * no script and issues no POST, so it reads a page and consumes nothing. With
 * JavaScript off there's a button, which is also the accessible path.
 *
 * The token is still VALIDATED here — that's a read — so a dead link redirects
 * straight to the sign-in screen instead of offering a button that can't work.
 */
auth.get("/callback", async (c) => {
  const token = c.req.query("t");
  const fail = (origin: string = c.env.APP_URL) => c.redirect(`${origin}/sign-in?error=link`, 302);
  if (!token) return fail();

  const row = await c.env.DB.prepare(
    "SELECT expires_at, consumed_at, return_to FROM auth_token WHERE token_hash = ?",
  )
    .bind(await sha256(token))
    .first<{ expires_at: string; consumed_at: string | null; return_to: string | null }>();
  const origin = resolveReturnTo(c.env, row?.return_to);
  if (!row || row.consumed_at || isExpired(row.expires_at)) return fail(origin);

  return c.html(signInHandoffPage(token, c.env.SCHOOL_NAME), 200, {
    // Holding the token IS the authorization, so no shared cache may keep this.
    "cache-control": "no-store",
    // `same-origin`, NOT `no-referrer`: under `no-referrer` the Fetch spec
    // serializes the Origin header of this page's own form POST to "null",
    // which the POST handler's cross-site check below then refuses — i.e. the
    // stricter policy breaks every browser sign-in. `same-origin` still keeps
    // this token-bearing URL out of any cross-origin Referer (the page's only
    // navigation is the POST back to this same origin).
    "referrer-policy": "same-origin",
  });
});

/**
 * POST /auth/callback — consume the token, create the session, redirect.
 *
 * Everything that used to sit behind the GET. Same-origin form post from the
 * page above, so the Lax session cookie set here rides back to the SPA normally.
 */
auth.post("/callback", async (c) => {
  // Before the token is loaded there's nothing to tell us which app started the
  // sign-in, so a failure before that falls back to APP_URL as it always has.
  const fail = (origin: string = c.env.APP_URL) => c.redirect(`${origin}/sign-in?error=link`, 302);

  // The only intended poster is the handoff page below, which is same-origin,
  // so a cross-site Origin is a forged post — refused before the token is even
  // read, which also leaves it unconsumed for the member's own click. Without
  // this, any page could auto-submit a fresh magic link for the ATTACKER'S
  // address and silently swap the victim's session for the attacker's (login
  // CSRF): SameSite=Lax stops a cross-site request from SENDING the session
  // cookie, not this response from SETTING one. An absent Origin is allowed —
  // non-browser clients and the no-JS button may omit it, and the attack needs
  // a browser, which always names an origin (or "null", from a sandboxed
  // frame, which also fails the comparison) on a cross-site form POST.
  const postOrigin = c.req.header("origin");
  if (postOrigin && postOrigin !== new URL(c.req.url).origin) return fail();

  const form = await c.req.parseBody().catch(() => null);
  const token = typeof form?.t === "string" ? form.t : c.req.query("t");
  if (!token) return fail();

  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT id, email, kind, person_id, invited_by, group_id, reg_open_at_issue, expires_at, consumed_at, return_to
     FROM auth_token WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string;
      kind: string;
      person_id: string | null;
      invited_by: string | null;
      group_id: string | null;
      reg_open_at_issue: number;
      expires_at: string;
      consumed_at: string | null;
      return_to: string | null;
    }>();

  // Re-validate rather than trusting the stored value: ALLOWED_ORIGINS may have
  // changed since the link was issued, and this is the value we actually redirect to.
  const appOrigin = resolveReturnTo(c.env, row?.return_to);
  if (!row || row.consumed_at || isExpired(row.expires_at)) return fail(appOrigin);

  // Single-use, enforced INSIDE the statement. The read above is a fast path, not
  // the guard: D1 has no transaction around a read-then-write, so two clicks
  // landing together would both pass it and both mint a session. Same reasoning
  // as the overfill guard in lib/volunteers.ts and the last-admin guard in
  // routes/admin.ts — whoever's UPDATE reports a changed row owns the token.
  const claimed = await c.env.DB.prepare(
    "UPDATE auth_token SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
  )
    .bind(nowIso(), row.id)
    .run();
  if (!claimed.meta.changes) return fail(appOrigin);

  // Find or create the user. Bootstrap-admin emails always create + are granted
  // system_admin, even when registration is closed (initial-setup path).
  const bootstrap = isBootstrapAdmin(c.env, row.email);
  let user = await findUserByEmail(c.env, row.email);

  // A disabled account gets no session. Without this the link "works": the
  // account is found, a session is minted, the browser lands in the app — and
  // then every request 401s, because the session lookup filters on disabled_at.
  // It also stops a session created while disabled from springing to life if
  // the account is later re-enabled. Same failure page as an expired link, so
  // the response says nothing about whether the address exists (invariant 4).
  if (user) {
    const state = await c.env.DB.prepare("SELECT disabled_at FROM user WHERE id = ?")
      .bind(user.id)
      .first<{ disabled_at: string | null }>();
    if (state?.disabled_at) return fail(appOrigin);
  }

  if (!user) {
    // signin tokens only create a user if registration was open at issue time.
    // invite tokens always create the user (they bypass the toggle).
    if (row.kind === "signin" && row.reg_open_at_issue !== 1 && !bootstrap) return fail(appOrigin);
    const userId = ulid();
    const joinedAt = nowIso();
    const via = row.kind === "invite" ? "invite" : "signup";
    await c.env.DB.prepare(
      `INSERT INTO user (id, email, email_verified_at, is_system_admin, created_at, joined_via) VALUES (?,?,?,?,?,?)`,
    )
      .bind(userId, row.email, joinedAt, bootstrap ? 1 : 0, joinedAt, via)
      .run();
    user = { id: userId, email: row.email, is_system_admin: bootstrap ? 1 : 0, locale: null };
    // Tell the admins someone joined (no-op unless notifications are "instant").
    c.executionCtx.waitUntil(
      notifyNewUser(c.env, { email: row.email, via, createdAt: joinedAt }),
    );
    // And record it. Pushed here, at the INSERT, rather than beside the
    // `auth.signin` below: the account existing is the fact worth keeping, and
    // it must survive even if something later in this handler throws (invariant
    // 5's reasoning, and the same ordering test/volunteerSignupAudit.test.ts
    // pins for a claimed spot). `via` distinguishes an open-registration signup
    // from an invited one; the email is the only identity a brand-new row has.
    c.var.audit.push({
      action: "auth.registered",
      entityKind: "user",
      entityId: userId,
      detail: { via, bootstrap },
      notify: { email: row.email, via },
    });
    if (bootstrap) {
      c.var.audit.push({ action: "admin.action", entityKind: "user", entityId: userId, detail: { op: "bootstrap_admin" } });
    }
  } else {
    await c.env.DB.prepare("UPDATE user SET email_verified_at = ? WHERE id = ?")
      .bind(nowIso(), user.id)
      .run();
    // Re-grant admin if this email is configured as a bootstrap admin.
    if (bootstrap && user.is_system_admin !== 1) {
      await c.env.DB.prepare("UPDATE user SET is_system_admin = 1 WHERE id = ?").bind(user.id).run();
      c.var.audit.push({ action: "admin.action", entityKind: "user", entityId: user.id, detail: { op: "bootstrap_admin" } });
    }
  }

  // Invite binding: grant control + close the invite.
  if (row.kind === "invite" && row.person_id) {
    await bindInvite(c, user.id, row.person_id, row.invited_by, row.email, row.group_id);
  }

  // Create the session.
  const sessionId = randomSessionId();
  await c.env.DB.prepare(
    `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      sessionId,
      user.id,
      nowIso(),
      nowIso(),
      isoPlus(SESSION_TTL),
      c.var.userAgent,
      c.var.ip,
    )
    .run();
  setSessionCookie(c, sessionId, SESSION_TTL_SECONDS);

  c.var.audit.push({ action: "auth.signin", entityKind: "user", entityId: user.id });

  return c.redirect(`${appOrigin}/`, 302);
});

/**
 * The one HTML page this API serves. Deliberately tiny and self-contained: no
 * bundle, no fonts, no third-party anything, because it exists for the
 * fraction of a second between the member's click and the redirect into the app.
 *
 * The form is the mechanism, not the decoration — see GET /auth/callback. It
 * auto-submits, so what a member actually sees is a flash of the school's name;
 * the button is what's left when scripting is off, and it is a real, focusable
 * control rather than a fallback nobody tested.
 *
 * The token is echoed into a hidden input, so it must be escaped: it is
 * URL-safe base64 and can't contain a quote, but this is the one place
 * attacker-supplied text meets markup, and "can't" is not a thing to rely on.
 */
function signInHandoffPage(token: string, school: string): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Signing you in…</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #F4F6F8; color: #1F2933; text-align: center; padding: 24px;
  }
  main { max-width: 22rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 .5rem; }
  p { color: #56636F; margin: 0 0 1.5rem; }
  button {
    font: inherit; font-weight: 600; cursor: pointer;
    background: #0068A8; color: #fff; border: 0;
    border-radius: 10px; padding: .75rem 1.5rem;
  }
  button:focus-visible { outline: 3px solid #FAAB1C; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #12181D; color: #E6EBEF; }
    p { color: #A3B1BD; }
  }
</style>
</head>
<body>
<main>
  <h1>Signing you in…</h1>
  <p>One moment while we open the ${esc(school)} Directory.</p>
  <form method="POST" action="/auth/callback">
    <input type="hidden" name="t" value="${esc(token)}">
    <button type="submit">Continue</button>
  </form>
</main>
<script>document.forms[0].submit();</script>
</body>
</html>`;
}

/**
 * Accept an invitation: grant control, close the invite.
 *
 * `groupId` is the household the invitation was ABOUT (migration 0021), and it
 * is what turns "you may co-manage this one Person" into "you are the other
 * parent here". Without it, the welcome wizard's own partner invite left the
 * second parent controlling only themselves: a member of the household but not
 * an admin of it, so GET /me/households returned nothing and their first "add a
 * child" founded a SECOND household with duplicate children in it.
 *
 * Three things it does, and the reason each is spelled the way it is:
 *
 *   Control of the inviter's household Persons is granted by an
 *   `INSERT … SELECT`, evaluated against what the INVITER controls right now
 *   rather than a list frozen at send time. A child added between sending the
 *   invitation and clicking it is a child the co-parent should get, and one the
 *   inviter has since lost control of is not.
 *
 *   The Persons come from `membership` joined to `control`, never from `person`.
 *   That is not incidental: the enumeration gate (invariant 21) would be the
 *   wrong predicate to apply here — the invitee is becoming a Controller, which
 *   is one of the two audiences the gate admits — and reading the table at all
 *   would spend one of the scan's few remaining exemptions to no purpose.
 *
 *   Household admin is granted only where a membership already exists, so this
 *   can never make someone an admin of a household they are not in. It carries
 *   the `household_admin` capability with it for the same reason POST /groups
 *   does: the badge and the authority are one fact.
 */
/** `bindInvite`, exposed for test/directoryAccess.test.ts — the vouching scope
 *  is the kind of rule a route test cannot reach, since getting here means
 *  minting and consuming a token first. */
export async function bindInviteForTest(
  env: Env,
  userId: string,
  personId: string,
  invitedBy: string | null,
  email: string,
  groupId: string | null,
): Promise<void> {
  const c = { env, var: { audit: [] as AuditDraft[] } } as unknown as Context<HonoEnv>;
  return bindInvite(c, userId, personId, invitedBy, email, groupId);
}

async function bindInvite(
  c: Context<HonoEnv>,
  userId: string,
  personId: string,
  invitedBy: string | null,
  email: string,
  groupId: string | null,
): Promise<void> {
  const exists = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM control WHERE user_id = ? AND person_id = ? LIMIT 1",
  )
    .bind(userId, personId)
    .first<{ ok: number }>();
  if (!exists) {
    await c.env.DB.prepare(
      "INSERT INTO control (user_id, person_id, granted_by, since) VALUES (?,?,?,?)",
    )
      .bind(userId, personId, invitedBy, nowIso())
      .run();
  }
  await c.env.DB.prepare(
    "UPDATE control_invite SET status = 'accepted' WHERE person_id = ? AND to_email = ? AND status = 'pending'",
  )
    .bind(personId, email)
    .run();

  // VOUCHING (migration 0029), and `groupId` is the whole of what makes it
  // safe. An invitation from a member who may already read the directory
  // carries that access to the invitee, so a second parent accepting a link
  // does not then wait in a queue to see the family they were just handed
  // control of. This is the one path to approval that is not an admin
  // decision.
  //
  // It is limited to the HOUSEHOLD invite — the opt-in path invariant 24
  // describes, where the inviter ticked a box to share their whole family —
  // and NOT to a bare co-controller invite, which carries no `group_id`.
  // That distinction is the point rather than a detail: invariant 24 exists
  // to stop "help me manage this one child" becoming "see my whole family",
  // and an unconditional vouch here would have made it "see the whole
  // school" — any approved member could hand a stranger the directory by
  // inviting them as a co-controller of one Person, with no review. The
  // narrower door is the one the reasoning actually supports.
  //
  // Enforced INSIDE the UPDATE (D1 has no read-then-write transaction) and it
  // only ever grants — a declined or pending inviter changes nothing, and an
  // invitee who is already approved is left alone.
  if (invitedBy && groupId) {
    const vouched = await c.env.DB.prepare(
      `UPDATE user
          SET access_approved_at = ?, access_submitted_at = COALESCE(access_submitted_at, ?),
              access_declined_at = NULL, access_decided_by = ?
        WHERE id = ? AND access_approved_at IS NULL
          AND EXISTS (SELECT 1 FROM user inviter
                       WHERE inviter.id = ? AND inviter.disabled_at IS NULL
                         AND (inviter.access_approved_at IS NOT NULL OR inviter.is_system_admin = 1))`,
    )
      .bind(nowIso(), nowIso(), invitedBy, userId, invitedBy)
      .run();
    if (vouched.meta.changes) {
      c.var.audit.push({
        action: "access.approved",
        entityKind: "user",
        entityId: userId,
        detail: { via: "household-invite", invitedBy, groupId },
      });
    }
  }
  // Pushed here, before the household widening below, for invariant 22's
  // ordering reason: the control that was just granted is a committed write and
  // must have a record even if the widening throws. What the widening learns is
  // merged into these same two objects afterwards, in place.
  const accepted: AuditDraft = {
    action: "invite.accepted",
    entityKind: "person",
    entityId: personId,
    detail: { groupId },
  };
  const granted: AuditDraft = {
    action: "control.granted",
    entityKind: "person",
    entityId: personId,
    detail: { userId },
    // No `self`, so this one SPEAKS: invariant 22 keeps control.granted quiet
    // for the 22-of-22 self-grants and lets through exactly this case — a
    // second parent gaining control by invitation, where who can see a family's
    // data actually changed.
    notify: { self: false },
  };
  c.var.audit.push(accepted);
  c.var.audit.push(granted);

  if (!groupId || !invitedBy) return;

  // How many Persons this actually hands over, read BEFORE the insert: after it
  // the `NOT EXISTS` is false for every row and the number is unrecoverable.
  // It is the one thing worth keeping about a grant of this size.
  const widened = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM membership m
      JOIN control inv ON inv.person_id = m.person_id AND inv.user_id = ?
      WHERE m.group_id = ?
        AND NOT EXISTS (SELECT 1 FROM control mine WHERE mine.person_id = m.person_id AND mine.user_id = ?)`,
  )
    .bind(invitedBy, groupId, userId)
    .first<{ n: number }>();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO control (user_id, person_id, granted_by, since)
       SELECT ?, m.person_id, ?, ?
         FROM membership m
         JOIN control inv ON inv.person_id = m.person_id AND inv.user_id = ?
        WHERE m.group_id = ?
       ON CONFLICT (user_id, person_id) DO NOTHING`,
    ).bind(userId, invitedBy, nowIso(), invitedBy, groupId),
    // The INVITEE'S OWN Person, by id — never "everyone this user controls".
    // The insert above has just made that set the whole household, so a
    // `person_id IN (SELECT … FROM control WHERE user_id = ?)` here would read
    // perfectly naturally and promote every CHILD in the family to household
    // admin. Order inside a batch is what makes the difference, and the safe
    // spelling is the one that doesn't depend on it.
    //
    // It also only promotes a membership that already EXISTS — never creates
    // one — so this can't make someone an admin of a household they're not in.
    c.env.DB.prepare(
      "UPDATE membership SET is_admin = 1 WHERE group_id = ? AND person_id = ?",
    ).bind(groupId, personId),
    // The badge and the authority are one fact, as POST /groups has it.
    c.env.DB.prepare(
      `INSERT INTO capability_grant (person_id, capability)
       SELECT ?, 'household_admin'
        WHERE EXISTS (SELECT 1 FROM membership WHERE group_id = ? AND person_id = ?)
       ON CONFLICT DO NOTHING`,
    ).bind(personId, groupId, personId),
  ]);

  // The same objects the array already holds. Deliberately NOT a third draft
  // keyed on the group: `control.granted`'s formatter resolves `entityId`
  // through `personLabel`, so a draft carrying a GROUP id there would render as
  // "A member" — the string that is supposed to mean "withheld", quietly
  // reused to mean "wrong table". Enriching the person-scoped draft says the
  // same thing truthfully.
  const personsGranted = widened?.n ?? 0;
  Object.assign(accepted.detail!, { personsGranted });
  Object.assign(granted.detail!, { viaInvite: true, householdId: groupId, personsGranted });
  Object.assign(granted.notify!, { personsGranted });
}

/** POST /auth/signout — revoke the current session. */
auth.post("/signout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await c.env.DB.prepare("UPDATE session SET revoked_at = ? WHERE id = ?")
      .bind(nowIso(), sid)
      .run();
    if (c.var.auth) {
      c.var.audit.push({ action: "auth.signout", entityKind: "user", entityId: c.var.auth.userId });
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

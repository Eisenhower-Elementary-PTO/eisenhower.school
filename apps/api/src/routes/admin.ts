// Admin: user listing + masquerade (FR-13, SDD §4.1). The broader admin console
// (CSV import, audit-log table, registration toggle UI) is M4.

import { Hono } from "hono";
import type { AccessRequestDTO, AuditEntryDTO, Capability, BulkImportOptions, BulkImportRow, CalendarSourceDTO, CalendarSourceInput } from "@sd/shared";
import { RESTORE_CONFIRM } from "@sd/shared";
import type { Env, HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { verifyAuditChain } from "../lib/audit.js";
import type { BackupDocument } from "../lib/backup.js";
import { countRows, exportBackup, planRestore, runRestore } from "../lib/backup.js";
import { runBulkImport } from "../lib/bulkImport.js";
import { refreshSource, refreshAllSources } from "../lib/calendar.js";
import { randomSessionId, randomToken, sha256 } from "../lib/crypto.js";
import { ulid } from "../lib/ids.js";
import { isoPlus, isExpired, nowIso, sleep, MAGIC_LINK_TTL, MASQUERADE_TTL, SESSION_TTL } from "../lib/time.js";
import { setSessionCookie, clearActivePersonCookie } from "../lib/cookies.js";
import { findUserByEmail, normalizeEmail } from "../lib/db.js";
import { computeUserDeletionImpact, userDeletionStmts } from "../lib/userAdmin.js";
import { accessStateOf } from "../lib/directoryAccess.js";
import {
  magicLinkEmail,
  directoryInviteEmail,
  sendEmail,
  sendEmailBatchResult,
  EMAIL_PACE_MS,
} from "../lib/email.js";
import type { QueuedInvite } from "../lib/bulkImport.js";

export const admin = new Hono<HonoEnv>();

/** Messages per batch-seam call: the unit of pacing and of withdrawal — a
 *  refused slice's casualties are withdrawn as soon as the slice settles, so
 *  the ~30s waitUntil kill can strand at most one slice. */
const INVITE_BATCH = 10;

/** Batch calls per invocation. This whole function runs in a request's
 *  waitUntil, which the runtime kills roughly 30 seconds after the response —
 *  and the pacing sleeps are what dominate that clock. Fifteen paced slices
 *  (~16s of sleep) mail 150 invites with margin. Anything past the cap is
 *  withdrawn UP FRONT (see below), while this function is certain to still be
 *  alive. */
const INVITE_BATCH_BUDGET = 15;

/** Email bulk-import sign-in links, sliced and paced.
 *
 *  The two ceilings that broke the October 2026 newsletter send apply here
 *  too (lib/newsletterSend.ts has the story): the channel's per-second meter,
 *  and the free plan's 50-subrequest cap of the time — which the old shape,
 *  one unpaced fetch per address, hit mid-list on any roster-sized import,
 *  with every failure swallowed by sendEmail. The batch seam answers both:
 *  each slice of INVITE_BATCH messages rides one paced, per-message-retried
 *  sendEmailBatchResult call, reported per message, so a refusal costs its
 *  own invite and never its nine neighbours.
 *
 *  Anything this function cannot mail is WITHDRAWN rather than stranded:
 *  unlike the newsletter there is no ledger to resume from (the raw token
 *  exists only here, in memory — it is hashed at rest), and
 *  `hasPendingInvite` would stop a re-run of the import from ever re-queueing
 *  an invite whose rows exist but whose mail never went. Deleting those rows
 *  makes re-running the import the retry mechanism. Ordering matters twice:
 *  the overflow beyond the batch budget is withdrawn BEFORE any mailing, and
 *  a refused slice's casualties are withdrawn as soon as that slice settles —
 *  both so that the ~30s kill can strand at most the slice in flight, never
 *  the whole tail of the list. The withdrawal itself runs after the audit
 *  flush and pushes no draft; its paper trail is the next import run's
 *  bulk.import row re-queueing what it removed. */
export async function sendBulkInvites(
  env: Env,
  origin: string,
  invites: QueuedInvite[],
  opts: { paceMs?: number } = {}, // test seam, like runFanOut's
): Promise<void> {
  const paceMs = opts.paceMs ?? EMAIL_PACE_MS;

  const mailable = invites.slice(0, INVITE_BATCH * INVITE_BATCH_BUDGET);
  const overflow = invites.slice(mailable.length);
  if (overflow.length > 0) {
    await withdrawUnmailedInvites(env, overflow, "beyond this run's send budget");
  }

  for (let i = 0; i < mailable.length; i += INVITE_BATCH) {
    if (i > 0 && paceMs > 0) await sleep(paceMs);
    const slice = mailable.slice(i, i + INVITE_BATCH);
    const msgs = slice.map((inv) => {
      const msg = directoryInviteEmail(env, `${origin}/auth/callback?t=${inv.token}`, inv.personName);
      msg.to = inv.email;
      return msg;
    });

    const batch = await sendEmailBatchResult(env, msgs, paceMs);

    // The channel reports per message (and already retried each transient
    // failure once), so a refusal is per-invite: withdraw exactly those.
    // Re-sending the slice would duplicate the accepted sends. No `results`
    // means the channel is off and the messages were logged (dev) — then
    // `ok` speaks for the slice as a whole.
    const stranded = batch.results
      ? slice.filter((_, j) => !(batch.results?.[j]?.ok ?? false))
      : batch.ok
        ? []
        : slice;
    if (stranded.length > 0) {
      await withdrawUnmailedInvites(env, stranded, "the mail channel refused it");
    }
  }
}

/** Delete the invite rows minted for mail that never went out, so the next
 *  import run re-queues and re-mails them (`hasPendingInvite` comes back false
 *  once these are gone). Safe because the recipient never saw the link: the
 *  message was never accepted, so the only copy of the token died with it.
 *  All the deletes go in chunked batches rather than one round trip per
 *  invite — this runs in the wall-clock-constrained waitUntil tail, where a
 *  long serial withdrawal could itself be cut off partway. */
async function withdrawUnmailedInvites(
  env: Env,
  invites: QueuedInvite[],
  why: string,
): Promise<void> {
  console.error(
    `[bulk-import] withdrawing ${invites.length} unmailed invite(s) (${why}); re-running the import re-queues and re-sends them.`,
  );
  const stmts: D1PreparedStatement[] = [];
  for (const inv of invites) {
    const tokenHash = await sha256(inv.token);
    stmts.push(
      env.DB.prepare("DELETE FROM control_invite WHERE token_hash = ? AND status = 'pending'").bind(tokenHash),
      env.DB.prepare("DELETE FROM auth_token WHERE token_hash = ? AND consumed_at IS NULL").bind(tokenHash),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100)).catch((err: unknown) => {
      console.error(`[bulk-import] invite withdrawal batch failed: ${String(err)}`);
    });
  }
}

/** GET /admin/users — directory of Users (system admins only).
 *
 *  Disabled accounts are INCLUDED, flagged. They used to be filtered out, which
 *  was fine while nothing could disable one — but an account you cannot see is
 *  an account you cannot re-enable, and disabling is meant to be reversible.
 *  Active first, so the working list stays at the top. */
admin.get("/users", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_system_admin, u.disabled_at,
            (SELECT COUNT(*) FROM control ctl WHERE ctl.user_id = u.id) AS person_count
     FROM user u
     ORDER BY (u.disabled_at IS NOT NULL), u.email`,
  ).all<{
    id: string;
    email: string;
    is_system_admin: number;
    disabled_at: string | null;
    person_count: number;
  }>();
  return c.json({
    users: rows.results.map((u) => ({
      id: u.id,
      email: u.email,
      isSystemAdmin: u.is_system_admin === 1,
      personCount: u.person_count,
      disabled: u.disabled_at !== null,
      disabledAt: u.disabled_at,
    })),
  });
});

/** POST /admin/users/:id/disabled { disabled } — take an account out of use, or
 *  put it back.
 *
 *  Deliberately reversible, and deliberately the ONLY destructive-feeling thing
 *  here: it touches the `user` row and nothing else. Their Persons, households,
 *  contact items and audit trail are all left exactly as they were, because
 *  "this person left the school" and "erase what they built" are different
 *  requests and only the second one is unrecoverable. Everything that matters
 *  already honours `disabled_at` — sessions (middleware/session.ts), the
 *  newsletter audience (lib/newsletter.ts) and masquerade (below) — so the
 *  account stops working the moment this lands.
 *
 *  Sessions are deleted rather than left to expire. The session lookup already
 *  refuses a disabled user, so this changes no security property; it makes
 *  "signed out everywhere" true rather than merely effective, and stops a
 *  re-enable from silently restoring a year-old cookie. */
admin.post("/users/:id/disabled", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  // Same rule as changing a role: acting *as* somebody must never become a way
  // to lock them out under their own name.
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const id = c.req.param("id");
  const body = await c.req.json<{ disabled?: boolean }>().catch(() => null);
  if (typeof body?.disabled !== "boolean") return c.json({ error: "invalid_body" }, 400);
  // No self-disable. It is the one move that can empty the admin set — and
  // since you cannot disable yourself, at least one admin always remains.
  if (id === auth.userId) return c.json({ error: "cannot_disable_self" }, 400);

  const target = await c.env.DB.prepare("SELECT id, email, disabled_at FROM user WHERE id = ?")
    .bind(id)
    .first<{ id: string; email: string; disabled_at: string | null }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const alreadyDisabled = target.disabled_at !== null;
  if (alreadyDisabled === body.disabled) {
    // Idempotent: a double click should not read as a failure.
    return c.json({ ok: true, disabled: alreadyDisabled, disabledAt: target.disabled_at });
  }

  const disabledAt = body.disabled ? nowIso() : null;

  // Never disable the last enabled admin. "You cannot disable yourself" is not
  // enough on its own: two admins can each disable the OTHER, and if both land
  // there is no admin left, no route that clears disabled_at without an admin
  // session, and no way back in — a bootstrap-admin email re-grants the role on
  // sign-in but never un-disables the row, so recovery means opening D1 by hand.
  //
  // The count lives INSIDE the UPDATE rather than in a preceding SELECT because
  // D1 gives no transaction across a read-then-write; SQLite serializes the two
  // writes, so whichever lands second sees the first and matches no rows. Same
  // guarded-write-plus-meta.changes shape as the volunteer overfill check.
  const update = body.disabled
    ? await c.env.DB.prepare(
        `UPDATE user SET disabled_at = ?
          WHERE id = ?
            AND (is_system_admin = 0
                 OR EXISTS (SELECT 1 FROM user other
                             WHERE other.is_system_admin = 1
                               AND other.disabled_at IS NULL
                               AND other.id <> ?))`,
      )
        .bind(disabledAt, id, id)
        .run()
    : await c.env.DB.prepare("UPDATE user SET disabled_at = NULL WHERE id = ?").bind(id).run();

  if (update.meta.changes === 0) {
    // The row exists (checked above), so the guard is what refused.
    return c.json(
      { error: "last_admin", message: "That's the only admin left. Make someone else an admin first." },
      409,
    );
  }

  if (body.disabled) {
    // `OR acting_admin_id` is the half that matters. A masquerade session's
    // user_id is the person being impersonated, NOT the admin doing it, so
    // matching on user_id alone would leave a disabled admin browsing as
    // somebody else until the masquerade aged out an hour later — the exact
    // access this is meant to cut off.
    await c.env.DB.prepare("DELETE FROM session WHERE user_id = ? OR acting_admin_id = ?")
      .bind(id, id)
      .run();
  }

  const op = body.disabled ? "user.disabled" : "user.enabled";
  c.var.audit.push({
    action: "admin.action",
    entityKind: "user",
    entityId: id,
    detail: { op, email: target.email },
    // Restated rather than shared with `detail`: two bags, so widening one can
    // never widen what leaves for Slack (invariant 22). The op itself is
    // hoisted because that is a computation, not a decision about disclosure.
    notify: { op, email: target.email },
  });

  return c.json({ ok: true, disabled: body.disabled, disabledAt });
});

/** GET /admin/users/:id/impact — what permanently deleting this User would
 *  remove. READ ONLY: it writes nothing and deletes nothing.
 *
 *  It exists because the obvious reading of "delete a user and everything they
 *  made" cannot be answered by this schema, and the plausible-looking guesses
 *  destroy other people's data:
 *
 *    `grp` has no creator column at all, so "groups they created" is not
 *    recorded anywhere. The nearest proxy is "groups a Person they control
 *    administers" — which for a teacher is a classroom full of other families'
 *    children. Those are never deletion candidates here.
 *
 *    `control` is many-to-many on purpose (SDD: two parents, one child), so
 *    "their people" splits in two. A Person somebody else also controls is not
 *    theirs to take; only a Person left with no controller at all is, because
 *    nobody could sign in and edit it afterwards.
 *
 *  An admin reads this before anything irreversible happens. */
admin.get("/users/:id/impact", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const impact = await computeUserDeletionImpact(c.env, c.req.param("id"));
  if (!impact) return c.json({ error: "not_found" }, 404);
  return c.json(impact);
});

/** DELETE /admin/users/:id — permanently delete an account and EXECUTE its
 *  impact report (invariant 17: the report is the contract for what a delete may
 *  touch, so the same helper computes it and the delete runs exactly it).
 *
 *  Irreversible, so it is guarded like nothing else here: system admin only,
 *  never while masquerading, never yourself, and — deliberately — only once the
 *  account is already DISABLED, so "take out of use" and "erase" can never be
 *  the same click. Because the last enabled admin can never be disabled
 *  (`/disabled` enforces it), a deletable account is never the last admin, so no
 *  separate last-admin guard is needed here. */
admin.delete("/users/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const id = c.req.param("id");
  if (id === auth.userId) return c.json({ error: "cannot_delete_self" }, 400);

  const target = await c.env.DB.prepare("SELECT id, email, disabled_at FROM user WHERE id = ?")
    .bind(id)
    .first<{ id: string; email: string; disabled_at: string | null }>();
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.disabled_at === null) {
    return c.json(
      { error: "not_disabled", message: "Disable the account first, then it can be deleted." },
      409,
    );
  }

  // Re-run the report rather than trust anything the client saw: a second
  // controller may have been added, or a claim made, since the modal loaded.
  const impact = await computeUserDeletionImpact(c.env, id);
  if (!impact) return c.json({ error: "not_found" }, 404);

  await c.env.DB.batch(userDeletionStmts(c.env, id, target.email, impact));

  // The counts go in `detail` because in a second nothing else will hold them.
  // `notify` stays the op + email only (invariant 22): the email is the account
  // identifier the disable/enable lines already carry, and no name is looked up.
  c.var.audit.push({
    action: "admin.action",
    entityKind: "user",
    entityId: id,
    detail: {
      op: "user.deleted",
      email: target.email,
      orphanedPersons: impact.orphanedPersons.length,
      emptiedHouseholds: impact.emptiedHouseholds.length,
      controlDropped: impact.sharedPersons.length,
      volunteerClaimsWithdrawn: impact.volunteerClaimsWithdrawn,
      boardCommentsDeleted: impact.boardCommentsDeleted,
      sharesWithdrawn: impact.sharesWithdrawn,
    },
    notify: { op: "user.deleted", email: target.email },
  });

  return c.json({ ok: true });
});

/** POST /admin/users { email, isSystemAdmin?, sendEmail? } — create a sign-in
 *  account. The account exists immediately (so they can sign in even when
 *  registration is closed). A sign-in link is emailed unless sendEmail is false;
 *  either way they can later request one themselves via "Email me a link". */
admin.post("/users", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ email: string; isSystemAdmin?: boolean; sendEmail?: boolean }>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email.includes("@")) return c.json({ error: "invalid_email" }, 400);
  if (await findUserByEmail(c.env, email)) return c.json({ error: "user_exists" }, 409);

  const id = ulid();
  // joined_via 'admin' keeps this out of new-member notifications — whoever is
  // creating the account doesn't need an email telling them it happened.
  await c.env.DB.prepare(
    "INSERT INTO user (id, email, is_system_admin, created_at, joined_via) VALUES (?,?,?,?, 'admin')",
  )
    .bind(id, email, body?.isSystemAdmin ? 1 : 0, nowIso())
    .run();

  const sendInvite = body?.sendEmail !== false;
  if (sendInvite) {
    const token = randomToken();
    const tokenHash = await sha256(token);
    await c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, reg_open_at_issue, expires_at, created_at)
       VALUES (?,?, 'signin', ?, 1, ?, ?)`,
    )
      .bind(ulid(), email, tokenHash, isoPlus(MAGIC_LINK_TTL), nowIso())
      .run();
    const link = `${new URL(c.req.url).origin}/auth/callback?t=${token}`;
    const msg = magicLinkEmail(c.env, link);
    msg.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env, msg));
  }

  c.var.audit.push({
    action: "admin.action",
    entityKind: "user",
    entityId: id,
    detail: { op: "user.create", emailSent: sendInvite },
    notify: { op: "user.create", email, emailSent: sendInvite },
  });
  return c.json({ user: { id, email, isSystemAdmin: !!body?.isSystemAdmin, personCount: 0 } }, 201);
});

/** PATCH /admin/users/:id { isSystemAdmin } — grant or revoke system admin. */
admin.patch("/users/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  // The one admin op a masquerade session never gets: acting *as* someone must
  // not become a route to handing out privileges under their name.
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const id = c.req.param("id");
  const body = await c.req.json<{ isSystemAdmin?: boolean }>().catch(() => null);
  if (typeof body?.isSystemAdmin !== "boolean") return c.json({ error: "invalid_body" }, 400);
  // No self-demotion: it's the only way to lock every admin out of the console,
  // and it keeps "remove admin" from ever emptying the admin set.
  if (id === auth.userId) return c.json({ error: "cannot_change_own_role" }, 400);

  const target = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_system_admin,
            (SELECT COUNT(*) FROM control ctl WHERE ctl.user_id = u.id) AS person_count
     FROM user u WHERE u.id = ? AND u.disabled_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; email: string; is_system_admin: number; person_count: number }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const next = body.isSystemAdmin;
  if ((target.is_system_admin === 1) !== next) {
    await c.env.DB.prepare("UPDATE user SET is_system_admin = ? WHERE id = ?").bind(next ? 1 : 0, id).run();
    const op = next ? "user.admin.granted" : "user.admin.revoked";
    c.var.audit.push({
      action: "admin.action",
      entityKind: "user",
      entityId: id,
      detail: { op, email: target.email },
      // Two bags on purpose — see the disable route above.
      notify: { op, email: target.email },
    });
  }
  return c.json({
    user: { id: target.id, email: target.email, isSystemAdmin: next, personCount: target.person_count },
  });
});

/** POST /admin/bulk-import { rows, dryRun, sendInvites, createAccounts,
 *  contactVisibility, emailAsContact } — CSV bulk import (FR-29/30).
 *
 *  Two ways to handle a row's email, and they are alternatives: by default it
 *  gets a pending invite (mailed only with `sendInvites`); with
 *  `createAccounts` it gets an account outright and no invite exists to mail —
 *  see `BulkImportOptions`. A staff roster wants the second: the school
 *  vouches for the addresses, and "Email me a link" then finds the account. */
admin.post("/bulk-import", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<{ rows: BulkImportRow[]; dryRun?: boolean; sendInvites?: boolean } & BulkImportOptions>()
    .catch(() => null);
  if (!body || !Array.isArray(body.rows)) return c.json({ error: "invalid_body" }, 400);

  const dryRun = body.dryRun !== false; // default to a safe dry-run
  const sendInvites = body.sendInvites === true; // opt-in: email new members a sign-in link
  const { result, invites } = await runBulkImport(c.env, body.rows, dryRun, {
    createAccounts: body.createAccounts === true,
    contactVisibility: body.contactVisibility === "service" ? "service" : "private",
    emailAsContact: body.emailAsContact === true,
  });
  if (!dryRun) {
    // "Attempted", not "sent": the mailing runs AFTER this row is flushed, in
    // waitUntil, and sendBulkInvites may withdraw invites it cannot deliver —
    // a withdrawn invite's absence is re-queued (and re-audited) by the next
    // import run, which is its paper trail.
    const emailsAttempted = sendInvites ? invites.length : 0;
    if (emailsAttempted > 0) {
      c.executionCtx.waitUntil(sendBulkInvites(c.env, new URL(c.req.url).origin, invites));
    }
    c.var.audit.push({
      action: "bulk.import",
      entityKind: "import",
      entityId: null,
      detail: {
        rows: result.rowsProcessed,
        personsCreated: result.personsCreated,
        groupsCreated: result.groupsCreated,
        invitesQueued: result.invitesQueued,
        accountsCreated: result.accountsCreated,
        emailsAttempted,
      },
      // Counts only — the same numbers, restated deliberately rather than
      // shared with `detail`, so widening one never widens the other.
      notify: {
        rows: result.rowsProcessed,
        personsCreated: result.personsCreated,
        groupsCreated: result.groupsCreated,
        invitesQueued: result.invitesQueued,
        accountsCreated: result.accountsCreated,
        emailsAttempted,
      },
    });
  }
  return c.json(result);
});

/**
 * GET /admin/audit/verify?limit= — re-derive the hash chain (invariant 5).
 *
 * The chain was written from the start and read by nothing, which made the
 * tamper evidence a claim rather than a check — and hid the fork that migration
 * 0016 fixes. This is that check. It walks the log, re-hashes every row and
 * reports the positions that don't reconcile: a `hash` break means a row's
 * contents were altered, a `link` break means its parent doesn't match, a `gap`
 * means a row was removed.
 *
 * Registered ABOVE `/audit` so Hono doesn't route "verify" into that handler's
 * query-string world. Cheap enough to run by hand after anything alarming; not
 * on a cron, because nobody reads a green cron.
 */
admin.get("/audit/verify", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const limit = Number.parseInt(c.req.query("limit") ?? "5000", 10) || 5000;
  return c.json(await verifyAuditChain(c.env, { limit }));
});

/**
 * GET /admin/audit/actions — every action the log actually holds, with counts.
 *
 * The filter used to be a hand-kept list in the SPA, which had fallen well
 * behind the `AuditAction` union — the newest actions were the unfilterable
 * ones. Reading the log's own vocabulary means a new action is filterable the
 * day it is first written. Registered above `/audit` for `/audit/verify`'s reason.
 */
admin.get("/audit/actions", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    "SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY action",
  ).all<{ action: string; n: number }>();
  return c.json({ actions: rows.results.map((r) => ({ action: r.action, count: r.n })) });
});

/** Escape LIKE's wildcards so a search for `50%` or `user_id` means itself. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * GET /admin/audit?action=&q=&limit=&before= — append-only audit log (FR-32).
 *
 * `q` is a case-insensitive substring match over every column the list
 * RENDERS — action, entity kind and id, actor and masquerade-target emails, ip
 * and `detail` — and nothing else (invariant 18's rule: a search may not match
 * on more than it shows). That is why `detail` is now on the DTO: the name a
 * `person.deleted` row keeps is the thing an admin most needs to search for,
 * and a match on text the row then hid would be a result nobody could explain.
 * `user_agent` and the hash columns are neither shown nor searched.
 */
admin.get("/audit", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const action = c.req.query("action");
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const before = c.req.query("before"); // id cursor; rows are ULID-ordered
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (action) { where.push("a.action = ?"); binds.push(action); }
  if (q) {
    const cols = ["a.action", "a.entity_kind", "a.entity_id", "actor.email", "masq.email", "a.ip", "a.detail_json"];
    where.push(`(${cols.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    const term = likeTerm(q);
    binds.push(...cols.map(() => term));
  }
  if (before) { where.push("a.id < ?"); binds.push(before); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_kind, a.entity_id, a.detail_json, a.ip, a.created_at,
            actor.email AS actor_email, masq.email AS masq_email
     FROM audit_log a
     LEFT JOIN user actor ON actor.id = a.actor_user_id
     LEFT JOIN user masq  ON masq.id  = a.masquerading_as
     ${whereSql}
     ORDER BY a.id DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<{
      id: string; action: string; entity_kind: string | null; entity_id: string | null;
      detail_json: string | null; ip: string | null; created_at: string;
      actor_email: string | null; masq_email: string | null;
    }>();

  const entries: AuditEntryDTO[] = rows.results.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email,
    masqueradingAsEmail: r.masq_email,
    entityKind: r.entity_kind,
    entityId: r.entity_id,
    detail: parseDetail(r.detail_json),
    ip: r.ip,
    createdAt: r.created_at,
  }));
  return c.json({ entries, nextBefore: entries.length === limit ? entries[entries.length - 1]?.id : null });
});

/** A row's detail as written; a blob that won't parse is shown raw rather than dropped. */
function parseDetail(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw: json };
  }
}

/** POST /admin/masquerade { userId } — start viewing as another User. */
admin.post("/masquerade", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  if (auth.isMasquerading) return c.json({ error: "already_masquerading" }, 409);

  const body = await c.req.json<{ userId: string }>().catch(() => null);
  if (!body?.userId) return c.json({ error: "invalid_body" }, 400);
  if (body.userId === auth.userId) return c.json({ error: "cannot_masquerade_self" }, 400);

  const target = await c.env.DB.prepare(
    // `email` is selected for the Slack notification below, which names who is
    // being impersonated — the audit row records it as `entityId` alone.
    "SELECT id, email FROM user WHERE id = ? AND disabled_at IS NULL",
  )
    .bind(body.userId)
    .first<{ id: string; email: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const sessionId = randomSessionId();
  await c.env.DB.prepare(
    `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip, acting_admin_id, parent_session_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(sessionId, target.id, nowIso(), nowIso(), isoPlus(MASQUERADE_TTL), c.var.userAgent, c.var.ip, auth.userId, auth.sessionId)
    .run();

  setSessionCookie(c, sessionId, Math.floor(MASQUERADE_TTL / 1000));
  clearActivePersonCookie(c); // resolve the target's own first Person

  c.var.audit.push({
    action: "masquerade.start",
    entityKind: "user",
    entityId: target.id,
    notify: { targetEmail: target.email },
  });
  return c.json({ ok: true });
});

/** POST /admin/masquerade/stop — return to the admin's own session. */
admin.post("/masquerade/stop", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isMasquerading) return c.json({ error: "not_masquerading" }, 400);

  const current = await c.env.DB.prepare(
    "SELECT parent_session_id FROM session WHERE id = ?",
  )
    .bind(auth.sessionId)
    .first<{ parent_session_id: string | null }>();

  // Revoke the masquerade session.
  await c.env.DB.prepare("UPDATE session SET revoked_at = ? WHERE id = ?")
    .bind(nowIso(), auth.sessionId)
    .run();

  // Restore the admin's original session if still valid; else mint a fresh one.
  let restoreId = current?.parent_session_id ?? null;
  if (restoreId) {
    const parent = await c.env.DB.prepare(
      "SELECT expires_at, revoked_at FROM session WHERE id = ?",
    )
      .bind(restoreId)
      .first<{ expires_at: string; revoked_at: string | null }>();
    if (!parent || parent.revoked_at || isExpired(parent.expires_at)) restoreId = null;
  }
  if (!restoreId) {
    restoreId = randomSessionId();
    await c.env.DB.prepare(
      `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(restoreId, auth.realUserId, nowIso(), nowIso(), isoPlus(SESSION_TTL), c.var.userAgent, c.var.ip)
      .run();
  }
  setSessionCookie(c, restoreId, Math.floor(SESSION_TTL / 1000));
  clearActivePersonCookie(c);

  c.var.audit.push({ action: "masquerade.stop", entityKind: "user", entityId: auth.userId });
  return c.json({ ok: true });
});


// ── Backup / restore (system admins) ─────────────────────────────────────────

/**
 * GET /admin/backup — the whole database as one JSON file.
 *
 * Deliberately NOT a projection, and `lib/backup.ts` opens with why: every
 * other outbound seam here narrows on purpose, and a backup that narrowed would
 * be a backup that silently lost a column. So the file is the directory —
 * coordinates, private contact items, addresses and all — and the controls are
 * elsewhere: system admin only, never while masquerading, audited, and
 * announced in Slack, because a complete copy of the school's data leaving the
 * building is exactly the kind of event invariant 22's channel exists for.
 *
 * The masquerade refusal is not decoration. `isSystemAdmin` is the EFFECTIVE
 * user's flag, so an admin acting as another admin passes the check above — and
 * taking a full copy of the directory under somebody else's name is the last
 * thing this route should allow.
 */
admin.get("/backup", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const doc = await exportBackup(c.env);
  const counts = countRows(doc);
  const totalRows = counts.reduce((n, t) => n + t.rows, 0);

  // Pushed before the response is built, like every other draft: the read has
  // already happened by here, so there is nothing left that could fail and
  // leave a copy of the directory taken with no row saying so.
  c.var.audit.push({
    action: "admin.action",
    entityKind: "backup",
    entityId: null,
    detail: { op: "backup.exported", tables: counts.length, rows: totalRows },
    // Counts only — the same numbers restated rather than shared with `detail`,
    // so widening one can never widen the other (invariant 22).
    notify: { op: "backup.exported", tables: counts.length, rows: totalRows },
  });

  const stamp = doc.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
  return new Response(JSON.stringify(doc), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="school-directory-backup-${stamp}.json"`,
      // Never a shared cache: this is the whole directory in one response.
      "cache-control": "private, no-store",
    },
  });
});

/**
 * POST /admin/restore { backup, dryRun?, confirm? } — replace the database with
 * a backup file.
 *
 * The most destructive thing in this codebase, so it is guarded like it:
 *
 *  · system admin only, and never while masquerading;
 *  · DRY RUN BY DEFAULT — `dryRun !== false`, the same safe default
 *    /admin/bulk-import takes, so a client that forgets the flag validates
 *    rather than destroys;
 *  · a real restore additionally needs `confirm: "RESTORE"` in the body, which
 *    no accidental replay of a dry-run request carries;
 *  · everything that can be checked is checked BEFORE the first DELETE, because
 *    a restore is not atomic across D1 batches (see `runRestore`);
 *  · and the plan is re-derived here rather than trusted from whatever the
 *    client saw in its dry run — the same reason DELETE /admin/users/:id
 *    re-runs its own impact report (invariant 17).
 *
 * What it will not do: empty a table the file never mentions, write any of the
 * four capability tables `EXCLUDED_TABLES` names, touch `audit_log`, or leave
 * an instance with no enabled system admin. Those are refusals in
 * `planRestore`, not conventions here.
 */
admin.post("/restore", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const body = await c.req
    .json<{ backup?: unknown; dryRun?: boolean; confirm?: string }>()
    .catch(() => null);
  if (!body || body.backup === undefined) return c.json({ error: "invalid_body" }, 400);

  const dryRun = body.dryRun !== false;
  const plan = await planRestore(c.env, body.backup, auth.realUserId);
  if (plan.errors.length) return c.json({ dryRun, ...plan, restored: false }, 422);

  if (dryRun) return c.json({ dryRun: true, ...plan, restored: false });

  // The one thing a dry run's own request body cannot be replayed into.
  if (body.confirm !== RESTORE_CONFIRM) {
    return c.json(
      { error: "confirm_required", message: `Send confirm: "${RESTORE_CONFIRM}" to actually restore.` },
      400,
    );
  }

  // Pushed BEFORE the write, which is the one place this file departs from
  // invariant 22's "push the moment the write commits". A restore that dies
  // half-way has still destroyed data, and the row that says an admin started
  // one is the only thing that would explain the state afterwards. Nothing is
  // lost by being early: `audit_log` is the one table a restore never touches,
  // so this row survives the operation it describes.
  c.var.audit.push({
    action: "admin.action",
    entityKind: "backup",
    entityId: null,
    detail: {
      op: "backup.restored",
      tables: plan.tables.filter((t) => !t.skipped).length,
      rows: plan.totalRows,
      generatedAt: (body.backup as { generatedAt?: string }).generatedAt ?? null,
    },
    notify: {
      op: "backup.restored",
      tables: plan.tables.filter((t) => !t.skipped).length,
      rows: plan.totalRows,
    },
  });

  const written = await runRestore(c.env, body.backup as BackupDocument);
  return c.json({ dryRun: false, ...plan, restored: true, rowsWritten: written });
});

// ── Calendar sources (system admins) ─────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface SourceRow {
  id: string;
  url: string;
  name: string;
  color: string;
  enabled: number;
  last_fetched_at: string | null;
  last_status: string | null;
  last_error: string | null;
  event_count: number;
}

function toSourceDTO(r: SourceRow): CalendarSourceDTO {
  return {
    id: r.id,
    url: r.url,
    name: r.name,
    color: r.color,
    enabled: r.enabled === 1,
    lastFetchedAt: r.last_fetched_at,
    lastStatus: (r.last_status as CalendarSourceDTO["lastStatus"]) ?? null,
    lastError: r.last_error,
    eventCount: r.event_count,
  };
}

async function loadSource(env: Env, id: string): Promise<CalendarSourceDTO | null> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.url, s.name, s.color, s.enabled, s.last_fetched_at, s.last_status, s.last_error,
            (SELECT COUNT(*) FROM calendar_event e WHERE e.source_id = s.id) AS event_count
     FROM calendar_source s WHERE s.id = ?`,
  )
    .bind(id)
    .first<SourceRow>();
  return row ? toSourceDTO(row) : null;
}

/** GET /admin/calendar-sources — list ICS feeds with status + event counts. */
admin.get("/calendar-sources", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.name, s.color, s.enabled, s.last_fetched_at, s.last_status, s.last_error,
            (SELECT COUNT(*) FROM calendar_event e WHERE e.source_id = s.id) AS event_count
     FROM calendar_source s ORDER BY s.name COLLATE NOCASE`,
  ).all<SourceRow>();
  return c.json({ sources: rows.results.map(toSourceDTO) });
});

/** POST /admin/calendar-sources { url, name, color? } — add a feed and fetch it
 *  immediately so events show without waiting for the next cron run. */
admin.post("/calendar-sources", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<CalendarSourceInput>().catch(() => null);
  const url = body?.url?.trim();
  const name = body?.name?.trim();
  if (!url || !/^https?:\/\//i.test(url) || !name) return c.json({ error: "invalid_body" }, 400);
  const color = body?.color && HEX_COLOR.test(body.color) ? body.color : "#0068A8";

  const id = ulid();
  await c.env.DB.prepare(
    "INSERT INTO calendar_source (id, url, name, color, enabled, created_at) VALUES (?,?,?,?,1,?)",
  )
    .bind(id, url, name, color, nowIso())
    .run();

  await refreshSource(c.env, { id, url }); // immediate first fetch
  c.var.audit.push({ action: "calendar.source.created", entityKind: "calendar_source", entityId: id, detail: { url } });
  return c.json({ source: await loadSource(c.env, id) }, 201);
});

/** PATCH /admin/calendar-sources/:id { url?, name?, color?, enabled? }. */
admin.patch("/calendar-sources/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, url, enabled FROM calendar_source WHERE id = ?")
    .bind(id)
    .first<{ id: string; url: string; enabled: number }>();
  if (!existing) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<CalendarSourceInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  let nextUrl = existing.url;
  if (typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim())) {
    nextUrl = body.url.trim();
    sets.push("url = ?");
    binds.push(nextUrl);
  }
  if (typeof body.name === "string" && body.name.trim()) {
    sets.push("name = ?");
    binds.push(body.name.trim());
  }
  if (typeof body.color === "string" && HEX_COLOR.test(body.color)) {
    sets.push("color = ?");
    binds.push(body.color);
  }
  let enablingNow = false;
  if (typeof body.enabled === "boolean") {
    sets.push("enabled = ?");
    binds.push(body.enabled ? 1 : 0);
    enablingNow = body.enabled && existing.enabled !== 1;
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);
  binds.push(id);
  await c.env.DB.prepare(`UPDATE calendar_source SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  // Re-fetch when the URL changed or the feed was just (re-)enabled.
  if (nextUrl !== existing.url || enablingNow) await refreshSource(c.env, { id, url: nextUrl });
  // Clear events if disabled.
  if (body.enabled === false) await c.env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(id).run();

  c.var.audit.push({ action: "calendar.source.updated", entityKind: "calendar_source", entityId: id });
  return c.json({ source: await loadSource(c.env, id) });
});

/** DELETE /admin/calendar-sources/:id — remove a feed and its events. */
admin.delete("/calendar-sources/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  // Read the name BEFORE the delete. The Slack notification (invariant 22) has
  // to name the feed, and this is the one curated action whose row is already
  // gone by the time the audit middleware flushes — a lookup there would find
  // nothing. The URL is deliberately not read: it may be a secret subscribe
  // link (invariant 12), and nothing outbound has any use for it.
  const existing = await c.env.DB.prepare("SELECT name FROM calendar_source WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM calendar_source WHERE id = ?").bind(id),
  ]);
  if (!res[1]?.meta.changes) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "calendar.source.deleted",
    entityKind: "calendar_source",
    entityId: id,
    notify: { name: existing?.name ?? null },
  });
  return c.json({ ok: true });
});

/** POST /admin/calendar-sources/refresh — fetch all enabled feeds now. */
admin.post("/calendar-sources/refresh", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const result = await refreshAllSources(c.env);
  c.var.audit.push({ action: "calendar.refreshed", entityKind: "calendar_source", entityId: null, detail: result });
  return c.json({ ok: true, ...result });
});

// ── Directory access queue (migration 0029, invariant 32) ───────────────────
//
// Reading the directory is granted here. The queue's whole job is to put in
// front of a reviewer the thing an email address could never give them: the
// applicant's own name, the children they entered, and the ROOMS those
// children are claimed to be in — matched against classroom groups this
// instance already holds under the district's own names, so a room that does
// not exist is visible as a room that does not exist.

/** One applicant's claim, read live from the Person rows they created.
 *
 *  Not copied onto the request at submit time on purpose: a family who fixes a
 *  typo before anyone looks should be reviewed on what is true now, and a
 *  second copy of the claim is a second thing to keep in step.
 *
 *  UNLISTED-EXEMPT: system-admin only (every caller below checks), and the join
 *  to `control` already restricts every row to the applicant's own family.
 *  `personListableSql` would admit exactly the same rows — an admin
 *  short-circuits it to "1" — so composing it here would be ceremony that reads
 *  like a guard. */
async function accessClaimsFor(env: Env, userIds: string[]) {
  const out = new Map<
    string,
    { name: string | null; students: AccessRequestDTO["students"]; roles: Capability[] }
  >();
  if (!userIds.length) return out;

  // D1 caps a statement at 100 bound parameters, which `lib/backup.ts` already
  // knows (`IN_CHUNK`). The queue's own LIMIT is 200 accounts, and the person
  // read below fans out to every Person those accounts control — on this
  // instance the `decided` tab is ~66 users and ~150 Persons — so an unchunked
  // `IN` does not degrade, it throws `too many SQL variables` and 500s the
  // whole screen.
  const CHUNK = 100;
  const chunks = <T,>(xs: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
    return out;
  };

  interface PersonRow {
    user_id: string;
    id: string;
    first_name: string;
    last_name: string | null;
    is_student: number;
  }
  /** The applicant's OWN roles, so a teacher does not read to a reviewer as a
   *  parent who forgot to enter their children. Read per user rather than per
   *  person: the question is "what does this applicant claim to be". */
  const roles = new Map<string, Capability[]>();
  for (const batch of chunks(userIds)) {
    const ph = batch.map(() => "?").join(",");
    const roleRows = await env.DB.prepare(
      `SELECT ctl.user_id, g.capability
         FROM control ctl JOIN capability_grant g ON g.person_id = ctl.person_id
        WHERE ctl.user_id IN (${ph}) AND g.capability IN ('teacher','staff','parent')`,
    )
      .bind(...batch)
      .all<{ user_id: string; capability: Capability }>();
    for (const r of roleRows.results) {
      const have = roles.get(r.user_id) ?? [];
      if (!have.includes(r.capability)) roles.set(r.user_id, [...have, r.capability]);
    }
  }
  const people: PersonRow[] = [];
  for (const batch of chunks(userIds)) {
    const ph = batch.map(() => "?").join(",");
    // UNLISTED-EXEMPT: system-admin only (every caller checks), and the join to
    // `control` restricts each row to one applicant's own family. An admin
    // short-circuits `personListableSql` to the literal "1", so composing it
    // here would read as a guard while gating nothing — invariant 22's warning
    // about exactly that shape.
    const rows = await env.DB.prepare(
      `SELECT ctl.user_id, p.id, p.first_name, p.last_name,
              EXISTS (SELECT 1 FROM capability_grant g
                       WHERE g.person_id = p.id AND g.capability = 'student') AS is_student
         FROM control ctl JOIN person p ON p.id = ctl.person_id
        WHERE ctl.user_id IN (${ph})
        ORDER BY ctl.since ASC`,
    )
      .bind(...batch)
      .all<PersonRow>();
    people.push(...rows.results);
  }

  const personIds = people.map((r) => r.id);
  const rooms = new Map<string, string[]>();
  for (const batch of chunks(personIds)) {
    const rph = batch.map(() => "?").join(",");
    const roomRows = await env.DB.prepare(
      `SELECT m.person_id, g.name
         FROM membership m JOIN grp g ON g.id = m.group_id
        WHERE m.person_id IN (${rph}) AND g.kind = 'classroom'
        ORDER BY g.name COLLATE NOCASE`,
    )
      .bind(...batch)
      .all<{ person_id: string; name: string }>();
    for (const r of roomRows.results) {
      rooms.set(r.person_id, [...(rooms.get(r.person_id) ?? []), r.name]);
    }
  }

  for (const r of people) {
    const entry = out.get(r.user_id) ?? { name: null, students: [], roles: roles.get(r.user_id) ?? [] };
    const full = [r.first_name, r.last_name].filter(Boolean).join(" ");
    if (r.is_student) {
      entry.students.push({ id: r.id, name: full, classrooms: rooms.get(r.id) ?? [] });
    } else if (!entry.name) {
      // The first non-student they entered is the applicant — `ORDER BY since`,
      // and the wizard's first step creates them before anything else.
      entry.name = full;
    }
    out.set(r.user_id, entry);
  }
  return out;
}

/** `accessClaimsFor`, exposed for test/directoryAccess.test.ts: the chunking is
 *  invisible from the route, which returns the same shape either way — right up
 *  until D1 refuses the statement. */
export const accessClaimsForTest = accessClaimsFor;

/** GET /admin/access-requests?state=pending|decided|never — the queue.
 *
 *  Three lists rather than one, because they are three different jobs.
 *  `pending` is the work. `decided` is the record. `never` is the population
 *  this gate exists to catch — accounts that signed up, entered nobody and
 *  stopped — and it is deliberately reachable, because on this instance that
 *  was ten accounts on the day the gate shipped. */
admin.get("/access-requests", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const state = c.req.query("state") ?? "pending";

  const where =
    state === "decided"
      ? "(u.access_declined_at IS NOT NULL OR (u.access_approved_at IS NOT NULL AND u.access_submitted_at IS NOT NULL))"
      : state === "never"
        // `access_declined_at IS NULL` matters: an account declined straight
        // from this tab has no submitted date, so without it the same row
        // would appear here AND under `decided`, labelled two ways.
        ? "u.access_submitted_at IS NULL AND u.access_approved_at IS NULL AND u.access_declined_at IS NULL"
        : "u.access_submitted_at IS NOT NULL AND u.access_approved_at IS NULL AND u.access_declined_at IS NULL";

  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.access_submitted_at, u.access_approved_at,
            u.access_declined_at, u.access_note, d.email AS decided_by_email
       FROM user u LEFT JOIN user d ON d.id = u.access_decided_by
      WHERE ${where} AND u.disabled_at IS NULL AND u.is_system_admin = 0
      ORDER BY COALESCE(u.access_submitted_at, u.created_at) ASC
      LIMIT 200`,
  ).all<{
    id: string;
    email: string;
    created_at: string;
    access_submitted_at: string | null;
    access_approved_at: string | null;
    access_declined_at: string | null;
    access_note: string | null;
    decided_by_email: string | null;
  }>();

  const claims = await accessClaimsFor(c.env, rows.results.map((r) => r.id));
  const requests: AccessRequestDTO[] = rows.results.map((r) => {
    const claim = claims.get(r.id);
    return {
      userId: r.id,
      email: r.email,
      submittedAt: r.access_submitted_at,
      createdAt: r.created_at,
      state: accessStateOf(r),
      applicantName: claim?.name ?? null,
      students: claim?.students ?? [],
      roles: claim?.roles ?? [],
      note: r.access_note,
      decidedAt: r.access_approved_at ?? r.access_declined_at,
      decidedBy: r.decided_by_email,
    };
  });
  return c.json({ requests });
});

/**
 * POST /admin/access-requests/:userId { approve, note? } — decide.
 *
 * Approving does TWO things, and the second is the one to understand:
 * it promotes the applicant's classroom placements from `self_asserted = 1`
 * to `0`. A parent placing their own child writes the weak kind by
 * construction (invariant 27) — the row says where they claim the child is,
 * and nothing had yet judged it. Approval IS that judgement, so the row
 * becomes the trusted kind, and the placement starts counting for
 * `rosterAccess` and for `viewerIsDirectMember` like any roster an
 * authority wrote. That is also what makes classroom-scoped visibility
 * possible later without a second pass over this data.
 *
 * Both effects ride ONE `batch()`, which is the transaction D1 gives: an
 * account approved with its placements left weak would read as verified
 * while every roster still treated it as hearsay.
 *
 * Declining sets a date and nothing else. The account keeps the calendar, the
 * newsletter and its own family; only other families are withheld. It is
 * reversible by approving, and the applicant may ask again — which is the
 * point, since the common decline is "we could not find your child in that
 * room", and the answer to that is a corrected room.
 */
admin.post("/access-requests/:userId", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  // A masquerading admin is acting as somebody else; granting directory access
  // to the whole school is not something to do while wearing another face.
  if (auth.isMasquerading) return c.json({ error: "not_while_masquerading" }, 403);

  const userId = c.req.param("userId");
  const body = await c.req.json<{ approve?: boolean; note?: string }>().catch(() => null);
  if (typeof body?.approve !== "boolean") return c.json({ error: "invalid_body" }, 400);

  const target = await c.env.DB.prepare(
    `SELECT id, email, access_submitted_at, access_approved_at, access_declined_at
       FROM user WHERE id = ? AND disabled_at IS NULL`,
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      access_submitted_at: string | null;
      access_approved_at: string | null;
      access_declined_at: string | null;
    }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const before = accessStateOf(target);
  const after = body.approve ? "approved" : "declined";
  // A decision that changes nothing writes nothing and pushes no draft: an
  // append-only log (invariant 5) must not be paddable by a double click.
  if (before === after) return c.json({ ok: true, state: before, promoted: 0 });

  const now = nowIso();
  const stmts = [
    c.env.DB.prepare(
      // `access_submitted_at` is stamped when it is missing, because an admin
      // may decide an account that never ASKED — the "Never asked" tab is for
      // exactly those, and this route is how one of them gets let in. Without
      // it the row would carry an approval and no submission, which matches
      // none of the three filters above: the account would vanish from every
      // tab the moment it was decided, taking any way to reverse the decision
      // with it. COALESCE rather than an overwrite, so a real application
      // keeps the date the family actually asked on.
      `UPDATE user
          SET access_approved_at = ?, access_declined_at = ?, access_decided_by = ?,
              access_submitted_at = COALESCE(access_submitted_at, ?)
        WHERE id = ?`,
    ).bind(
      body.approve ? now : null,
      body.approve ? null : now,
      auth.userId,
      now,
      userId,
    ),
  ];

  let promoted = 0;
  if (body.approve) {
    const pending = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM membership m
         JOIN grp g ON g.id = m.group_id AND g.kind = 'classroom'
         JOIN control ctl ON ctl.person_id = m.person_id
        WHERE ctl.user_id = ? AND m.self_asserted = 1`,
    )
      .bind(userId)
      .first<{ n: number }>();
    promoted = pending?.n ?? 0;
    if (promoted) {
      // Re-derived inside the batch rather than naming the ids read a moment
      // ago, for invariant 27's reason: D1 has no read-then-write transaction,
      // and the count above is for the audit row, not the guard.
      stmts.push(
        c.env.DB.prepare(
          `UPDATE membership
              SET self_asserted = 0
            WHERE self_asserted = 1
              AND group_id IN (SELECT id FROM grp WHERE kind = 'classroom')
              AND person_id IN (SELECT person_id FROM control WHERE user_id = ?)`,
        ).bind(userId),
      );
    }
  }
  await c.env.DB.batch(stmts);

  c.var.audit.push({
    action: body.approve ? "access.approved" : "access.declined",
    entityKind: "user",
    entityId: userId,
    detail: { from: before, placementsPromoted: promoted },
  });
  return c.json({ ok: true, state: after, promoted });
});

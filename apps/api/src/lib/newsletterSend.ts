// Sending an issue: the state machine and the fan-out.
//
// Two properties this has to have, and how each is obtained:
//
//   Idempotency. A double-clicked Send must not mail everyone twice. The
//   transition into 'sending' is a compare-and-swap —
//   `UPDATE ... SET status='sending' WHERE id=? AND status='draft'` — and the
//   loser of the race sees `changes === 0` and is turned away. D1 is a single
//   writer per database, so this needs no external lock. Crucially the CAS runs
//   BEFORE the slow work (audience + event resolution), which is the only
//   ordering that actually closes the race.
//
//   Resumability. Every recipient gets a 'pending' newsletter_send row before
//   any mail is attempted. A fan-out cut short — a recycled Worker, a Resend
//   outage — therefore leaves a state that can be read and resumed rather than
//   one nobody can interpret. Since the October 2026 send (69 of 94 recipients
//   failed in one unpaced, unbounded blast), resuming is also the NORMAL path,
//   not only recovery: each run is budgeted under the per-invocation
//   subrequest cap and paced under Resend's per-second meter,
//   and `resumePendingSends` (riding the store's 15-minute cron) carries a
//   yielded or killed run forward. A run processes 'pending' rows only;
//   'failed' means Resend gave a verdict re-sending can't change, and only the
//   manual retry route (which resets failed -> pending) re-enters those.

import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { nowIso, sleep } from "./time.js";
import { randomToken } from "./crypto.js";
import { RESEND_PACE_MS, isTransientSendError, sendEmailResult } from "./email.js";
import {
  getNewsletterSettings,
  issueEmailArgs,
  resolveAudience,
  resolveEventsSnapshot,
} from "./newsletter.js";
import type { NewsletterNode } from "@sd/shared";

/** Parallel sends in flight within one burst. */
export const CONCURRENCY = 5;

/** Pause between bursts — one burst of CONCURRENCY per SEND_PACE_MS. The meter
 *  it answers to is documented at RESEND_PACE_MS (lib/email.ts); on an account
 *  metered slower than ours the 429s are handled anyway, because a 429'd row
 *  stays 'pending' and is re-attempted on a later pass. */
export const SEND_PACE_MS = RESEND_PACE_MS;

/** Resend attempts one invocation may make. Sized when the account ran on the
 *  Workers FREE plan, which caps SUBREQUESTS per invocation at 50 — the same
 *  October send hit it: attempt ~50 onward failed with "Too many subrequests"
 *  before any fetch was made. The account has since moved to PAID (cap 1000 —
 *  see the cron comment in src/index.ts), so this budget is now pure headroom;
 *  it stays small on purpose, because the resume cadence makes a larger burst
 *  buy nothing but blast radius. 40 leaves headroom
 *  for whatever shares the invocation (the resume path rides the 15-minute
 *  cron beside the store's order retry). The budget counts FETCHES only, and
 *  that rests on measurement rather than the docs: in the October run the D1
 *  writes RECORDING the "Too many subrequests" errors succeeded after the
 *  fetches were refused — 45 rows carry that error — so on this account D1
 *  calls do not drain the counter the fetches hit. If a run ever starts dying
 *  around recipient ~22 with ledger writes failing too, that assumption broke;
 *  halve this before anything else. A run that exhausts its budget leaves the
 *  issue in 'sending' with pending rows; `resumePendingSends` carries on from
 *  there on the next cron tick, so a full audience drains in a few ticks
 *  instead of failing in one. */
export const SEND_BUDGET = 40;

/** The budget for the pass a ROUTE starts. A request's waitUntil is killed
 *  roughly 30 seconds after the response, and this run deliberately sleeps
 *  between bursts — a full SEND_BUDGET pass can brush that wall, and a run
 *  killed between a successful Resend call and its ledger write leaves a
 *  delivered row 'pending', which the resumer would then MAIL AGAIN. So the
 *  inline pass stays small enough to finish with lots of margin (three sleeps
 *  plus twenty bounded fetches), and the cron passes — which run in a
 *  scheduled event with a 15-minute allowance — do the bulk of a large
 *  audience at the full budget. */
export const ROUTE_SEND_BUDGET = 20;

/** Recipient rows inserted per D1 batch. */
const INSERT_CHUNK = 100;

export interface IssueRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  subject: string;
  content_json: string;
  events_snapshot_json: string | null;
  status: string;
  recipient_total: number;
  sent_at: string | null;
  /** When the public page went up, or null (migration 0031). Set by
   *  POST …/publish and, if still null, by the send. */
  published_at: string | null;
  /** The last write to the DOCUMENT — create or PATCH — and the real user who
   *  made it (migration 0032). Not bumped by publish or send, unlike
   *  `updated_at`. */
  edited_at: string | null;
  edited_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** SHA-256 of the review link's token, or null when none is live. Never
   *  leaves the server — `detailOf` reports only whether it is set. Deliberately
   *  survives a send: the link is revocable with no expiry, so one already
   *  circulated keeps working and starts showing the sent issue. */
  preview_token_hash: string | null;
  preview_token_created_at: string | null;
  /** Start of the editing session the last `newsletter.issue.updated` audit row
   *  stands for (migration 0020). Audit bookkeeping, not issue state: only
   *  `claimEditSession` in routes/newsletter.ts reads or moves it, and it
   *  reaches no DTO. */
  audit_session_at: string | null;
}

export type StartSendOutcome =
  | { ok: true; recipientTotal: number }
  | { ok: false; reason: "not_found" | "not_draft" | "no_recipients" };

/** Claim the issue and stage the send. Fast enough to run inside the request:
 *  a handful of D1 reads plus one batched insert. The actual mailing happens in
 *  `runFanOut`, which the caller hands to waitUntil. */
export async function startSend(env: Env, issueId: string): Promise<StartSendOutcome> {
  const claim = await env.DB.prepare(
    "UPDATE newsletter_issue SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'draft'",
  )
    .bind(nowIso(), issueId)
    .run();

  if (claim.meta.changes === 0) {
    const exists = await env.DB.prepare("SELECT id FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<{ id: string }>();
    return { ok: false, reason: exists ? "not_draft" : "not_found" };
  }

  try {
    const issue = await env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<IssueRow>();
    if (!issue) return { ok: false, reason: "not_found" };

    const doc = JSON.parse(issue.content_json) as NewsletterNode;
    const startedAt = nowIso();

    // Freeze the events blocks against this instant. From here the archive page
    // and the email are reading the same list forever.
    const snapshot = await resolveEventsSnapshot(env, doc, startedAt);
    const audience = await resolveAudience(env);

    if (audience.length === 0) {
      // Nothing to send. Release the claim so the draft stays editable rather
      // than stranding it in 'sending' with no rows to drive it forward.
      await env.DB.prepare(
        "UPDATE newsletter_issue SET status = 'draft', updated_at = ? WHERE id = ?",
      )
        .bind(nowIso(), issueId)
        .run();
      return { ok: false, reason: "no_recipients" };
    }

    const inserts = audience.map((m) =>
      env.DB.prepare(
        `INSERT INTO newsletter_send
           (id, issue_id, email, user_id, subscriber_id, unsubscribe_token, status, created_at)
         VALUES (?,?,?,?,?,?, 'pending', ?)
         ON CONFLICT (issue_id, email) DO NOTHING`,
      ).bind(ulid(), issueId, m.email, m.userId, m.subscriberId, randomToken(), startedAt),
    );
    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      await env.DB.batch(inserts.slice(i, i + INSERT_CHUNK));
    }

    await env.DB.prepare(
      `UPDATE newsletter_issue
          SET events_snapshot_json = ?, recipient_total = ?, sent_at = ?, updated_at = ?,
              -- Sending publishes: the email's "view in browser" link is this
              -- page. COALESCE keeps the date of a page that went up earlier.
              published_at = COALESCE(published_at, ?)
        WHERE id = ?`,
    )
      .bind(JSON.stringify(snapshot), audience.length, startedAt, startedAt, startedAt, issueId)
      .run();

    return { ok: true, recipientTotal: audience.length };
  } catch (err) {
    // Staging blew up after the claim. Hand the issue back rather than leaving
    // it permanently 'sending' and un-editable.
    console.error(`[newsletter] staging failed for ${issueId}: ${String(err)}`);
    await env.DB.prepare(
      "UPDATE newsletter_issue SET status = 'draft', updated_at = ? WHERE id = ?",
    )
      .bind(nowIso(), issueId)
      .run()
      .catch(() => {});
    throw err;
  }
}

interface PendingRow {
  id: string;
  email: string;
  unsubscribe_token: string;
}

/** Write one recipient's outcome to the ledger, retrying once.
 *
 *  Worth the retry because of what losing this write costs: the email HAS been
 *  delivered, but the row still reads 'pending'/'failed', so the next
 *  "retry failed" mails that person a second copy. The send itself can't be
 *  taken back, so the ledger is the only thing standing between a transient D1
 *  blip and a duplicate newsletter. */
async function recordOutcome(
  env: Env,
  sendId: string,
  result: { ok: boolean; error?: string },
): Promise<void> {
  // Three outcomes, not two. A transient refusal — the per-second meter, a
  // Resend 5xx, a fetch that never got a verdict — leaves the row 'pending'
  // with the error recorded, so a later pass re-attempts it without anyone
  // pressing retry. Only a verdict on the REQUEST itself (a non-429 4xx)
  // is 'failed', which the automatic passes leave alone.
  const error = result.ok ? null : (result.error ?? "unknown");
  const status = result.ok ? "sent" : isTransientSendError(error ?? "") ? "pending" : "failed";
  const write = () =>
    env.DB.prepare("UPDATE newsletter_send SET status = ?, error = ?, sent_at = ? WHERE id = ?")
      .bind(status, error, result.ok ? nowIso() : null, sendId)
      .run();
  try {
    await write();
  } catch (first) {
    try {
      await write();
    } catch (second) {
      // Both attempts lost. Logged loudly because the consequence is a possible
      // duplicate on the next retry, not a silent no-op.
      console.error(
        `[newsletter] ledger write lost for ${sendId} (delivered=${result.ok}): ${String(first)} / ${String(second)}`,
      );
    }
  }
}

/** Test seam only: production callers pass nothing and get the real limits. */
export interface FanOutOptions {
  budget?: number;
  paceMs?: number;
}

/** Mail up to SEND_BUDGET 'pending' recipients, paced under Resend's meter,
 *  then close the issue out IF nothing is left pending. Never throws — it runs
 *  detached in waitUntil, where a rejection would just be logged by the runtime
 *  and lose the per-recipient detail this records instead.
 *
 *  One bounded run is deliberately allowed to finish with work remaining: it
 *  leaves the issue in 'sending' with a fresh heartbeat, and the 15-minute cron
 *  (`resumePendingSends`) picks the remainder up. That is slower than one big
 *  blast and is the point — the October 2026 send WAS one big blast, and 69 of
 *  94 recipients got nothing. Only 'failed' rows are outside its reach: those
 *  carry a verdict re-sending can't change, and only the manual retry route
 *  (which resets them to 'pending') puts them back in. */
export async function runFanOut(env: Env, issueId: string, opts: FanOutOptions = {}): Promise<void> {
  const budget = opts.budget ?? SEND_BUDGET;
  const paceMs = opts.paceMs ?? SEND_PACE_MS;
  try {
    const issue = await env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<IssueRow>();
    if (!issue) return;

    const settings = await getNewsletterSettings(env);
    const content = JSON.parse(issue.content_json) as NewsletterNode;
    const snapshot = issue.events_snapshot_json
      ? (JSON.parse(issue.events_snapshot_json) as Record<string, never>)
      : {};

    const pending = await env.DB.prepare(
      "SELECT id, email, unsubscribe_token FROM newsletter_send WHERE issue_id = ? AND status = 'pending' LIMIT ?",
    )
      .bind(issueId, budget)
      .all<PendingRow>();

    for (let i = 0; i < pending.results.length; i += CONCURRENCY) {
      // The pause goes BETWEEN bursts: Resend counts per second, so the shape
      // that matters is "never more than CONCURRENCY in any SEND_PACE_MS".
      if (i > 0 && paceMs > 0) await sleep(paceMs);
      const chunk = pending.results.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          // Built per recipient because the unsubscribe link is per recipient —
          // a shared link would let one reader unsubscribe another.
          const msg = issueEmailArgs({
            env,
            settings,
            issue: {
              slug: issue.slug,
              title: issue.title,
              subtitle: issue.subtitle,
              subject: issue.subject,
              content,
            },
            snapshot,
            unsubscribeToken: row.unsubscribe_token,
          });
          const result = await sendEmailResult(env, { ...msg, to: row.email });
          await recordOutcome(env, row.id, result);
        }),
      );

      // Heartbeat, so a legitimately long run isn't mistaken for an abandoned
      // one by retryFailed's staleness check below.
      await env.DB.prepare("UPDATE newsletter_issue SET updated_at = ? WHERE id = ?")
        .bind(nowIso(), issueId)
        .run()
        .catch(() => {});
    }

    // Close out only when nothing is left pending. This run was budgeted, and
    // a 429'd row re-enters 'pending', so rows may remain; leaving the issue in
    // 'sending' is what hands them to `resumePendingSends` — flipping to 'sent'
    // here would strand them, because the cron only continues a 'sending'
    // issue. 'sent' still means the run COMPLETED, not that every address
    // succeeded: 'failed' rows stay visible in the ledger and are retryable.
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM newsletter_send WHERE issue_id = ? AND status = 'pending'",
    )
      .bind(issueId)
      .first<{ n: number }>();
    if (!left || left.n === 0) {
      await env.DB.prepare(
        "UPDATE newsletter_issue SET status = 'sent', updated_at = ? WHERE id = ?",
      )
        .bind(nowIso(), issueId)
        .run();
    } else {
      // Fresh heartbeat so the cron's staleness window starts from the yield,
      // not from the last mid-run heartbeat.
      await env.DB.prepare("UPDATE newsletter_issue SET updated_at = ? WHERE id = ?")
        .bind(nowIso(), issueId)
        .run();
    }
  } catch (err) {
    console.error(`[newsletter] fan-out failed for ${issueId}: ${String(err)}`);
  }
}

/** How long an issue may sit in 'sending' before a retry assumes the run that
 *  claimed it is gone. Comfortably longer than any real fan-out, short enough
 *  that a stuck issue is recoverable the same day. */
const STALE_SENDING_MS = 15 * 60 * 1000;

/** Re-run delivery for anything that didn't land. Safe to call repeatedly.
 *
 *  Retries from 'sent' (the ordinary case — some addresses bounced) AND from a
 *  STALE 'sending'. The second case is the one that matters: `runFanOut` runs
 *  detached in waitUntil, so if the Worker is evicted partway through a large
 *  audience, nothing ever flips the issue to 'sent'. Without this it would be
 *  stranded in 'sending' forever — un-editable, un-deletable and un-retryable,
 *  with its remaining recipients never mailed. The staleness window is what
 *  keeps a retry from racing a fan-out that is still legitimately running. */
export async function retryFailed(env: Env, issueId: string): Promise<boolean> {
  const outstanding = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM newsletter_send WHERE issue_id = ? AND status != 'sent'",
  )
    .bind(issueId)
    .first<{ n: number }>();
  if (!outstanding || outstanding.n === 0) return false;

  const now = nowIso();
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE newsletter_issue SET status = 'sending', updated_at = ?
      WHERE id = ?
        AND (status = 'sent' OR (status = 'sending' AND updated_at < ?))`,
  )
    .bind(now, issueId, staleBefore)
    .run();
  if (claim.meta.changes === 0) return false;

  // Put the 'failed' rows back in reach. The fan-out scans only 'pending' —
  // a 'failed' row carries a verdict (a bad address, a rejected sender) that
  // the automatic passes deliberately leave alone, so an admin pressing Retry
  // is the one way back in. The error text is kept until the next attempt
  // overwrites it, so the ledger still says why the last one failed. Safe to
  // run after the claim and only after it: the claim is what guarantees no
  // other fan-out is mid-flight over these rows.
  await env.DB.prepare(
    "UPDATE newsletter_send SET status = 'pending' WHERE issue_id = ? AND status = 'failed'",
  )
    .bind(issueId)
    .run();
  return true;
}

/** How long the cron waits before taking over a quiet 'sending' issue. Shorter
 *  than the manual route's STALE_SENDING_MS because it can afford to be: the
 *  only thing a staleness window protects against is claiming a run that is
 *  still LIVE (two runs over one ledger mail duplicates, the one unrecoverable
 *  outcome this file has), and a live run heartbeats every burst — at most
 *  ~RESEND_TIMEOUT_MS + SEND_PACE_MS apart, since every Resend fetch is
 *  timeout-bounded (lib/email.ts). Five minutes is ~25x that worst gap, and it
 *  halves the drain time of a big audience versus waiting out the manual
 *  window: a yielded run becomes claimable before the NEXT tick rather than
 *  the one after. */
const RESUME_STALE_MS = 5 * 60 * 1000;

/** When the automatic passes stop believing a transient error. A recipient
 *  Resend persistently 5xx's — or an outage that outlives this — would
 *  otherwise hold the issue in 'sending' forever: un-editable, un-deletable,
 *  unpublish refused, re-attempted every tick with nothing telling anyone.
 *  A day of retries every 15 minutes is ~96 attempts; after that the rows are
 *  marked 'failed' (visible in the ledger, re-enterable by the manual retry)
 *  and the issue closes out. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Cron rider (the store's 15-minute schedule): continue a budgeted send.
 *
 *  Finds the oldest issue sitting in 'sending' whose heartbeat has gone quiet
 *  and runs one more bounded fan-out over it. Two kinds of issue match, and
 *  the same move is right for both: a run that YIELDED with budget spent, and
 *  a run that DIED mid-flight (a recycled Worker, the thing resumability was
 *  built for). One issue per tick, because each tick has the same subrequest
 *  budget the fan-out is bounded by — two issues in flight at once (already
 *  rare) drain alternately rather than concurrently.
 *
 *  The claim is a guarded UPDATE on the heartbeat (invariant 13's idiom), so
 *  an overlapping tick — or the manual retry route — loses the race and does
 *  nothing. */
export async function resumePendingSends(env: Env): Promise<void> {
  try {
    const staleBefore = new Date(Date.now() - RESUME_STALE_MS).toISOString();
    // No "has pending rows" filter on purpose: a run that died AFTER its last
    // send but BEFORE the close-out leaves 'sending' with nothing pending, and
    // handing that to runFanOut is exactly what flips it to 'sent'.
    const row = await env.DB.prepare(
      `SELECT id, sent_at FROM newsletter_issue
        WHERE status = 'sending' AND updated_at < ?
        ORDER BY updated_at ASC LIMIT 1`,
    )
      .bind(staleBefore)
      .first<{ id: string; sent_at: string | null }>();
    if (!row) return;

    const claim = await env.DB.prepare(
      "UPDATE newsletter_issue SET updated_at = ? WHERE id = ? AND status = 'sending' AND updated_at < ?",
    )
      .bind(nowIso(), row.id, staleBefore)
      .run();
    if (claim.meta.changes === 0) return;

    // Stop believing "transient" after a day of it. sent_at is when the send
    // began (startSend stamps it), so this bounds the whole automatic life of
    // one send; the rows keep their last error, the ledger shows 'failed', and
    // the manual retry route is the way back in — same as any other failure.
    const giveUpBefore = new Date(Date.now() - GIVE_UP_AFTER_MS).toISOString();
    if (row.sent_at && row.sent_at < giveUpBefore) {
      await env.DB.prepare(
        "UPDATE newsletter_send SET status = 'failed' WHERE issue_id = ? AND status = 'pending'",
      )
        .bind(row.id)
        .run();
      await env.DB.prepare(
        "UPDATE newsletter_issue SET status = 'sent', updated_at = ? WHERE id = ?",
      )
        .bind(nowIso(), row.id)
        .run();
      console.error(
        `[newsletter] gave up on issue ${row.id}: recipients still undeliverable 24h after the send began; rows marked failed for manual retry`,
      );
      return;
    }

    await runFanOut(env, row.id);
  } catch (err) {
    console.error(`[newsletter] resume failed: ${String(err)}`);
  }
}

export interface RecipientCounts {
  pending: number;
  sent: number;
  failed: number;
}

export async function recipientCounts(env: Env, issueId: string): Promise<RecipientCounts> {
  const rows = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM newsletter_send WHERE issue_id = ? GROUP BY status",
  )
    .bind(issueId)
    .all<{ status: string; n: number }>();
  const counts: RecipientCounts = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows.results) {
    if (r.status === "pending" || r.status === "sent" || r.status === "failed") {
      counts[r.status] = r.n;
    }
  }
  return counts;
}

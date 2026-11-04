// Email delivery. One channel once it is fully configured: the Cloudflare
// Email Sending binding (`EMAIL` + `BULK_EMAIL_FROM`, both halves set only in
// production) carries ALL outbound mail from the app's sending domain,
// sitemail.eisenhower.school. Resend (`RESEND_API_KEY`) survives as the
// fallback while the channel is half-configured — the transition contract —
// and with neither configured (local dev, vitest) the message is logged to
// the console so the magic link is still reachable.

import { escapeHtml } from "@sd/shared";
import type { Env } from "../env.js";

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Override the instance From header. Only the newsletter uses this, so an
   *  admin-configured sender identity doesn't change transactional mail. */
  from?: string;
  replyTo?: string;
  /** Extra message headers. The lost & found intake's confirmation marks
   *  itself auto-generated with these, so autoresponders don't answer it. */
  headers?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Send one message and report whether it was accepted.
 *
 *  `sendEmail` below keeps the never-throw, never-report contract that the auth
 *  paths depend on. This variant exists for the newsletter, which mails hundreds
 *  of recipients at once and has to record per-recipient outcomes — "we tried
 *  and Resend rejected it" and "we tried and it went through" are different
 *  facts there, and collapsing them would make a partial send unrecoverable. */
/** One Resend message as the API takes it — the single place the From fallback
 *  chain and the reply_to spelling live, shared by the single and batch sends
 *  so the two can't drift. */
function resendPayload(env: Env, msg: SendArgs) {
  return {
    from: msg.from ?? env.EMAIL_FROM ?? `${env.SCHOOL_NAME} Directory <onboarding@resend.dev>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
  };
}

/** A Workers fetch has no default timeout, so one hung Resend call would stall
 *  a whole paced run — and the fan-out's resume logic reasons about how long a
 *  live run can go quiet, which only works if a burst is BOUNDED. Ten seconds
 *  is an eternity for this API; a send that slow is one worth failing
 *  (`isTransientSendError` classes an abort as retryable). */
const RESEND_TIMEOUT_MS = 10_000;

/** POST one body to Resend and shape the outcome the way every caller — and
 *  `isTransientSendError` — expects: "NNN: body" for a verdict, the bare
 *  message for a failure that never got one. */
async function postResend(env: Env, path: string, body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend error ${res.status} on ${path}: ${text}`);
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed on ${path}: ${error}`);
    return { ok: false, error: error.slice(0, 200) };
  }
}

/** The Cloudflare binding's error codes worth re-trying: the service's own
 *  meters and transient failures. Everything else (validation, an unverified
 *  sender, a suppressed recipient) would earn the same answer forever. */
const CF_TRANSIENT_CODES = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_DELIVERY_FAILED",
  "E_INTERNAL_SERVER_ERROR",
]);

/** Whether a failed send is worth re-trying without a human. A 429, a 5xx and
 *  a no-verdict failure (a network error, a timeout, the subrequest cap) all
 *  pass — retrying is exactly what the per-second meter and the daily quota
 *  expect. A 4xx other than 429 is Resend judging the REQUEST (a malformed
 *  address, a rejected sender): re-sending the same thing would earn the same
 *  answer forever. Cloudflare-channel errors carry their `E_*` code instead of
 *  a status and are judged by `CF_TRANSIENT_CODES`. */
export function isTransientSendError(error: string): boolean {
  if (error.startsWith("E_")) return CF_TRANSIENT_CODES.has(error.split(":")[0]!);
  const m = /^(\d{3}):/.exec(error);
  if (!m) return true;
  const status = Number(m[1]);
  return status === 429 || status >= 500;
}

/** "Name <addr>" (or a bare address) → the binding's {name, email} shape. */
function parseAddress(s: string): { name: string; email: string } {
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(s);
  if (m) return { name: (m[1] ?? "").trim(), email: m[2]!.trim() };
  return { name: "", email: s.trim() };
}

function addressDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** Both halves of the Cloudflare channel configured — the binding carries ALL
 *  outbound mail. Keyed on BULK_EMAIL_FROM because its domain must be
 *  onboarded to Email Sending before the first send, and unsetting the var is
 *  the kill switch back to Resend. */
export function bindingChannelOn(env: Env): boolean {
  return Boolean(env.EMAIL && env.BULK_EMAIL_FROM);
}

/** Send one message through the Cloudflare Email Sending binding.
 *
 *  The From ADDRESS must be on the onboarded sending domain. An asked-for
 *  address already there sends as itself — transactional mail keeps its own
 *  identity (`EMAIL_FROM`, e.g. directory@sitemail…). Any other domain gets
 *  the `BULK_EMAIL_FROM` address instead; the display NAME keeps whatever the
 *  message asked for (the newsletter admin's configured sender), and the
 *  asked-for address survives as Reply-To — replies keep landing where they
 *  always did. Errors come back as "E_CODE: message", the shape
 *  `isTransientSendError` reads. */
async function sendViaBinding(env: Env, msg: SendArgs): Promise<SendResult> {
  const bulkFrom = parseAddress(env.BULK_EMAIL_FROM ?? "");
  const wanted = parseAddress(msg.from ?? env.EMAIL_FROM ?? "");
  const onDomain = wanted.email !== "" && addressDomain(wanted.email) === addressDomain(bulkFrom.email);
  const replyTo = msg.replyTo ?? (wanted.email && !onDomain ? wanted.email : undefined);
  try {
    await env.EMAIL!.send({
      from: { name: wanted.name || bulkFrom.name, email: onDomain ? wanted.email : bulkFrom.email },
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(replyTo ? { replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code || "E_UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    const error = `${code}: ${message.slice(0, 160)}`;
    console.error(`[email] cloudflare send failed: ${error}`);
    return { ok: false, error };
  }
}

export async function sendEmailResult(env: Env, msg: SendArgs): Promise<SendResult> {
  // ALL mail takes the Cloudflare channel when it is configured; both halves
  // absent-means-off, so vitest and a bare `wrangler dev` (where the binding
  // exists but the top-level vars set no BULK_EMAIL_FROM) fall through
  // unchanged — Resend with a key, else the console log below.
  if (bindingChannelOn(env)) return sendViaBinding(env, msg);
  if (!env.RESEND_API_KEY) {
    // Local/dev fallback — surface the content (incl. magic link) in logs.
    console.log(
      `\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`,
    );
    return { ok: true };
  }
  return postResend(env, "/emails", resendPayload(env, msg));
}

/** Pause between calls for anything that mails in bulk. Resend meters API
 *  requests PER SECOND (this account: 10/s; new accounts: 2/s), and the
 *  October 2026 newsletter send is the proof it matters: unpaced bursts of 5
 *  pushed 25 emails through in 2.3 seconds and the next 24 came back 429.
 *  One burst of at most a handful of calls per RESEND_PACE_MS stays under
 *  this account's meter with margin. */
export const RESEND_PACE_MS = 1100;

/** Resend's batch endpoint takes up to this many messages per call. */
export const BATCH_API_MAX = 100;

export interface BatchSendResult extends SendResult {
  /** Per-message outcomes, same order as the input. Present only when the
   *  Cloudflare channel sent the messages individually (the binding has no
   *  batch endpoint); `ok` is then true iff EVERY message was accepted, and a
   *  caller that sees this field must not retry the whole batch — the
   *  accepted messages are already in recipients' inboxes. Absent on the
   *  all-or-nothing Resend batch call. */
  results?: SendResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Send several messages in one call to this seam.
 *
 *  On the Cloudflare channel each message is its own `send()` (paced by
 *  `paceMs`, one transient retry apiece), reported per message in `results`.
 *
 *  On Resend it is ONE /emails/batch call — one subrequest, one unit against
 *  the per-second meter. That mattered on the Workers free plan, where an
 *  invocation gets 50 subrequests and mailing a roster-sized import one fetch
 *  per address dies mid-list the way the October 2026 newsletter send did.
 *  The trade: the batch is accepted or refused as a WHOLE (Resend documents
 *  no partial-success mode), so the caller learns no per-recipient outcomes
 *  and falls back to budgeted single sends when a batch is refused. */
export async function sendEmailBatchResult(env: Env, msgs: SendArgs[], paceMs = 0): Promise<BatchSendResult> {
  if (msgs.length === 0) return { ok: true };
  if (msgs.length > BATCH_API_MAX) {
    return { ok: false, error: `batch of ${msgs.length} exceeds the API limit of ${BATCH_API_MAX}` };
  }
  if (bindingChannelOn(env)) {
    const results: SendResult[] = [];
    for (const [i, msg] of msgs.entries()) {
      if (i > 0 && paceMs > 0) await sleep(paceMs);
      let r = await sendViaBinding(env, msg);
      if (!r.ok && isTransientSendError(r.error ?? "")) {
        if (paceMs > 0) await sleep(paceMs);
        r = await sendViaBinding(env, msg);
      }
      results.push(r);
    }
    const failed = results.filter((r) => !r.ok).length;
    return {
      ok: failed === 0,
      ...(failed > 0 ? { error: `${failed} of ${msgs.length} refused: ${results.find((r) => !r.ok)?.error}` } : {}),
      results,
    };
  }
  if (!env.RESEND_API_KEY) {
    for (const msg of msgs) {
      console.log(`\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    }
    return { ok: true };
  }
  return postResend(env, "/emails/batch", msgs.map((msg) => resendPayload(env, msg)));
}

export async function sendEmail(env: Env, msg: SendArgs): Promise<void> {
  // Deliberately discards the result: callers on the auth path must not learn
  // delivery state, since that would reveal whether an account exists.
  await sendEmailResult(env, msg);
}

/** Member-entered values (emails, names) land in admin notifications — escape
 *  them so a hostile local-part can't inject markup into an admin's inbox. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** How a user account came into being — shown verbatim in admin notifications. */
export type JoinedVia = "signup" | "invite";

const VIA_LABEL: Record<JoinedVia, string> = {
  signup: "signed up",
  invite: "accepted an invitation",
};

export interface NewUserSummary {
  email: string;
  via: JoinedVia;
  createdAt: string;
}

function fmtWhen(iso: string): string {
  // Admin tooling is English-only; UTC keeps the cron digest unambiguous.
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Sent the moment someone joins, to each admin whose own mode is "instant". */
export function newUserEmail(env: Env, u: NewUserSummary): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.APP_URL}/admin`;
  const what = VIA_LABEL[u.via];
  return {
    to: "",
    subject: `New sign-up: ${u.email}`,
    text: `${u.email} ${what} and joined the ${school} Directory.\n\n${fmtWhen(u.createdAt)}\n\nManage members: ${admin}\n\nYou're getting this because you turned on new-member emails for yourself. Turn them off in Admin → Notifications.`,
    html: `<p><strong>${esc(u.email)}</strong> ${what} and joined the <strong>${esc(school)} Directory</strong>.</p>
<p style="color:#56636f;font-size:13px">${fmtWhen(u.createdAt)}</p>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because you turned on new-member emails for yourself. Turn them off in Admin → Notifications.</p>`,
  };
}

/**
 * Somebody asked to read the directory (migration 0029).
 *
 * Deliberately thin. The applicant's address is here because it is how an
 * admin recognises the request and, for many families, who they are; the
 * child's name and the room they claim are NOT, because those are the claim
 * itself and belong on a screen behind a session rather than copied into
 * several inboxes. The link is the point of the message.
 */
export function accessRequestEmail(env: Env, req: { email: string }): SendArgs {
  const school = env.SCHOOL_NAME;
  const queue = `${env.APP_URL}/admin?tab=access`;
  return {
    to: "",
    subject: `Directory access requested: ${req.email}`,
    text: `${req.email} asked to read the ${school} Directory.

Review what they entered — their name, their child and the classroom they chose — and approve or decline:
${queue}

Until someone decides, they can use the calendar and the newsletter but cannot see any other family.`,
    html: `<p><strong>${esc(req.email)}</strong> asked to read the <strong>${esc(school)} Directory</strong>.</p>
<p>Review what they entered — their name, their child and the classroom they chose — and approve or decline:</p>
<p><a href="${queue}">Open the access queue</a></p>
<p style="color:#56636f;font-size:13px">Until someone decides, they can use the calendar and the newsletter but cannot see any other family.</p>`,
  };
}

/** Daily roll-up of everyone who joined since the last digest (= "daily"). */
export function newUserDigestEmail(env: Env, users: NewUserSummary[]): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.APP_URL}/admin`;
  const n = users.length;
  const heading = `${n} new ${n === 1 ? "member" : "members"} joined the ${school} Directory`;
  const lines = users.map((u) => `• ${u.email} — ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}`);
  const rows = users
    .map(
      (u) =>
        `<li><strong>${esc(u.email)}</strong> <span style="color:#56636f">— ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}</span></li>`,
    )
    .join("\n");
  return {
    to: "",
    subject: `${n} new ${n === 1 ? "sign-up" : "sign-ups"} — ${school} Directory`,
    text: `${heading}\n\n${lines.join("\n")}\n\nManage members: ${admin}\n\nYou're getting this because you chose the daily new-member digest. Change it in Admin → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because you chose the daily new-member digest. Change it in Admin → Notifications.</p>`,
  };
}

export interface NewSubscriberSummary {
  email: string;
  confirmedAt: string;
}

/** Sent to system admins when someone completes double opt-in on the public
 *  newsletter form (notifications = "instant").
 *
 *  Under the instance's own From identity, not the newsletter's configured
 *  sender — this is transactional mail to staff about the newsletter, not an
 *  issue of it, and it should look like the rest of the admin notifications in
 *  their inbox. */
export function newSubscriberEmail(env: Env, s: NewSubscriberSummary): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.NEWSLETTER_URL}/admin/subscribers`;
  return {
    to: "",
    subject: `New newsletter subscriber: ${s.email}`,
    text: `${s.email} confirmed a subscription to the ${school} Newsletter.\n\n${fmtWhen(s.confirmedAt)}\n\nManage subscribers: ${admin}\n\nYou're getting this because new-subscriber notifications are on. Change them in Newsletter → Settings → Notifications.`,
    html: `<p><strong>${esc(s.email)}</strong> confirmed a subscription to the <strong>${esc(school)} Newsletter</strong>.</p>
<p style="color:#56636f;font-size:13px">${fmtWhen(s.confirmedAt)}</p>
<p><a href="${admin}">Manage subscribers</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because new-subscriber notifications are on. Change them in Newsletter → Settings → Notifications.</p>`,
  };
}

/** Daily roll-up of everyone who confirmed since the last digest (= "daily"). */
export function newSubscriberDigestEmail(env: Env, subs: NewSubscriberSummary[]): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.NEWSLETTER_URL}/admin/subscribers`;
  const n = subs.length;
  const heading = `${n} new ${n === 1 ? "subscriber" : "subscribers"} joined the ${school} Newsletter`;
  const lines = subs.map((s) => `• ${s.email} — ${fmtWhen(s.confirmedAt)}`);
  const rows = subs
    .map(
      (s) =>
        `<li><strong>${esc(s.email)}</strong> <span style="color:#56636f">— ${fmtWhen(s.confirmedAt)}</span></li>`,
    )
    .join("\n");
  return {
    to: "",
    subject: `${n} new newsletter ${n === 1 ? "subscriber" : "subscribers"} — ${school}`,
    text: `${heading}\n\n${lines.join("\n")}\n\nManage subscribers: ${admin}\n\nYou're getting this because the daily new-subscriber digest is on. Change it in Newsletter → Settings → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage subscribers</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because the daily new-subscriber digest is on. Change it in Newsletter → Settings → Notifications.</p>`,
  };
}

/**
 * Somebody said "that's mine" on a lost & found item (invariant 33).
 *
 * Sent to the addresses a system admin configured on the lost & found settings
 * screen. Deliberately thin, for `accessRequestEmail`'s reason: the item's
 * TITLE is here because the item is public and the title is how staff recognise
 * it, but the claimant's name, contact and message are NOT — those belong on
 * the staff queue behind a session, not copied into several inboxes that
 * outlive the claim's own retention (claims are swept; email isn't).
 */
export function lostFoundClaimEmail(env: Env, itemTitle: string): SendArgs {
  const school = env.SCHOOL_NAME;
  const queue = `${env.LOSTFOUND_URL ?? ""}/staff`;
  const title = itemTitle.trim() || "an item";
  return {
    to: "",
    subject: `Lost & found claim: ${title}`,
    text: `Someone says "${title}" in the ${school} lost & found is theirs.

Their name and how to reach them are on the claims queue:
${queue}

You're getting this because your address is on the lost & found's claim notifications. A system admin can change the list in Lost & found → Admin.`,
    html: `<p>Someone says <strong>${esc(title)}</strong> in the <strong>${esc(school)}</strong> lost &amp; found is theirs.</p>
<p>Their name and how to reach them are on the claims queue:</p>
<p><a href="${queue}">Open the claims queue</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because your address is on the lost &amp; found's claim notifications. A system admin can change the list in Lost &amp; found → Admin.</p>`,
  };
}

export interface VolunteerReminderShift {
  /** The position's title, admin-entered. */
  title: string;
  /** "5:00 – 7:00 PM" in the school's zone, or "" for an all-day commitment. */
  window: string;
}

/**
 * Two evenings before an event, to each address holding a spot on its volunteer
 * sheet (lib/volunteerReminders.ts).
 *
 * Deliberately names NOBODY — not the volunteer, not the child a parent signed
 * up. The shifts and their windows are the whole content, the same posture as
 * `signupIcsOf` (invariant 13): the recipient knows who in their family they
 * signed up, and an email forwards. "Your family signed up" is true whether the
 * recipient claimed the spot for themselves or for a child. English-only like
 * every transactional template in this file.
 *
 * The RUNBOOK link rides along when the sheet has one (migration 0039). That
 * is members-only content — it never crosses `publicSheetOf` — and this email
 * does not widen the audience: the recipients are resolved from the sheet's
 * own signups, exactly the signed-in families the event page already shows it
 * to, and the people who most need it on the day. It is a link, not the
 * document; the document keeps its own access control.
 */
export function volunteerReminderEmail(
  env: Env,
  args: {
    eventTitle: string;
    /** "Thursday, November 5" — minted in the school's zone by the caller. */
    when: string;
    location: string | null;
    shifts: VolunteerReminderShift[];
    /** The sheet's permanent `/v/:slug` URL, or null with no CALENDAR_URL. */
    sheetUrl: string | null;
    /** The sheet's admin-entered runbook link, if any (held to http(s) on
     *  write by `normalizeRunbookUrl`, so it is safe as an anchor). */
    runbookUrl: string | null;
  },
): SendArgs {
  const school = env.SCHOOL_NAME;
  const one = args.shifts.length === 1;
  const lines = args.shifts.map((s) => `• ${s.title}${s.window ? ` — ${s.window}` : ""}`);
  const rows = args.shifts
    .map(
      (s) =>
        `<li><strong>${esc(s.title)}</strong>${s.window ? ` <span style="color:#56636f">— ${esc(s.window)}</span>` : ""}</li>`,
    )
    .join("\n");
  const where = args.location ? `\nWhere: ${args.location}` : "";
  const runbook = args.runbookUrl ? `\n\nHow this event is run (volunteer runbook):\n${args.runbookUrl}` : "";
  const link = args.sheetUrl ? `\n\nEvent details and your sign-up:\n${args.sheetUrl}` : "";
  return {
    to: "",
    subject: `Reminder: volunteering at ${args.eventTitle} — ${args.when}`,
    text: `Your family signed up to volunteer at ${args.eventTitle}.\n\nWhen: ${args.when}${where}\n\nYour ${one ? "shift" : "shifts"}:\n${lines.join("\n")}${runbook}${link}\n\nThank you for helping out — ${school}.`,
    html: `<p>Your family signed up to volunteer at <strong>${esc(args.eventTitle)}</strong>.</p>
<p>When: <strong>${esc(args.when)}</strong>${args.location ? `<br>Where: ${esc(args.location)}` : ""}</p>
<p>Your ${one ? "shift" : "shifts"}:</p>
<ul>${rows}</ul>
${args.runbookUrl ? `<p><a href="${args.runbookUrl}">How this event is run</a> — the volunteer runbook.</p>\n` : ""}${args.sheetUrl ? `<p><a href="${args.sheetUrl}">Event details and your sign-up</a></p>\n` : ""}<p style="color:#56636f;font-size:13px">Thank you for helping out — ${esc(school)}.</p>`,
  };
}

export function magicLinkEmail(env: Env, link: string): SendArgs {
  const school = env.SCHOOL_NAME;
  return {
    to: "", // filled by caller
    subject: `Sign in to the ${school} Directory`,
    text: `Sign in to the ${school} Directory.\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, you can ignore this email.`,
    html: `<p>Sign in to the <strong>${school} Directory</strong>.</p>
<p><a href="${link}">Click here to sign in</a></p>
<p style="color:#56636f;font-size:13px">This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>`,
  };
}

/** Sent to people added via bulk import: a sign-in link that, when used, binds
 *  the recipient as a controller of their imported listing (INVITE_TTL = 14 days). */
export function directoryInviteEmail(env: Env, link: string, personName: string): SendArgs {
  const school = env.SCHOOL_NAME;
  const who = personName.trim() || "you";
  return {
    to: "",
    subject: `You're listed in the ${school} Directory`,
    text: `${who} has been added to the ${school} Directory.\n\nSign in to view the directory and manage your profile:\n${link}\n\nThis link expires in 14 days. If you weren't expecting this, you can ignore this email.`,
    html: `<p><strong>${escapeHtml(who)}</strong> has been added to the <strong>${escapeHtml(school)} Directory</strong>.</p>
<p><a href="${link}">Sign in to view the directory and manage your profile</a></p>
<p style="color:#56636f;font-size:13px">This link expires in 14 days. If you weren't expecting this, you can ignore this email.</p>`,
  };
}

/** Invitation to control a Person.
 *
 *  The wording deliberately avoids "help manage {name}". This same email is now
 *  sent in two situations: a co-parent being given rights over a child, and —
 *  since the welcome wizard — somebody being invited to take over THEIR OWN
 *  profile, which a partner created for them. "Help manage Marcus Ruiz" reads
 *  as nonsense when you are Marcus. "Lets you manage the profile for {name}" is
 *  true and unremarkable either way, and avoids a possessive apostrophe on
 *  names that already end in s. */
export function inviteEmail(
  env: Env,
  link: string,
  inviterName: string,
  personName: string,
): SendArgs {
  const school = env.SCHOOL_NAME;
  // Both names are typed by a member and land in somebody else's inbox as
  // markup, so neither may be interpolated raw.
  const inviter = escapeHtml(inviterName);
  const person = escapeHtml(personName);
  return {
    to: "",
    subject: `${inviterName} invited you to the ${school} Directory`,
    text: `${inviterName} invited you to the ${school} Directory.\n\nAccepting lets you manage the profile for ${personName}.\n\nAccept: ${link}\n\nThis invitation expires in 14 days.`,
    html: `<p><strong>${inviter}</strong> invited you to the ${escapeHtml(school)} Directory.</p>
<p>Accepting lets you manage the profile for <strong>${person}</strong>.</p>
<p><a href="${link}">Accept invitation</a></p>
<p style="color:#56636f;font-size:13px">This invitation expires in 14 days.</p>`,
  };
}

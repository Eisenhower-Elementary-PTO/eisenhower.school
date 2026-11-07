// Slack delivery via an Incoming Webhook.
//
// Transport only: this file knows nothing about audit actions, members or what
// a message is allowed to say. That is lib/slackNotify.ts's job, and the split
// is the same one lib/email.ts and lib/notify.ts already make — a transport
// that can't leak anything because it was never told anything, and an
// orchestration layer above it that decides what leaves.
//
// The contract mirrors `sendEmailResult`: no webhook configured means the
// message is logged instead of posted (so local dev still shows you what would
// have gone out), and nothing here ever throws. Callers run inside `waitUntil`,
// where a rejection is an unobserved promise and a Slack outage must never
// affect the audit write it rode in on.

import type { Env } from "../env.js";

export interface SlackMessage {
  /** Slack mrkdwn. Built by the formatters in lib/slackNotify.ts; there is
   *  deliberately no templating layer here. */
  text: string;
}

export interface SlackSendResult {
  ok: boolean;
  error?: string;
}

/** Post one message to the configured channel. Never throws.
 *
 *  The webhook URL is a bearer capability — anyone holding it can post into the
 *  channel — so like every other secret it is never logged, not even on
 *  the error paths below. Only the response body is echoed, truncated. */
export async function postToSlack(env: Env, msg: SlackMessage): Promise<SlackSendResult> {
  if (!env.SLACK_WEBHOOK_URL) {
    // Local/dev fallback — surface the message the way [email:dev] does.
    console.log(`\n[slack:dev] ${msg.text}\n`);
    return { ok: true };
  }
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[slack] webhook error ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[slack] post failed: ${error}`);
    return { ok: false, error: error.slice(0, 200) };
  }
}

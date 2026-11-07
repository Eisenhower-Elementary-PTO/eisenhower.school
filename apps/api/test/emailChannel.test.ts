// The outbound channel (lib/email.ts): ALL mail rides the Cloudflare Email
// Sending binding once it is configured (EMAIL + BULK_EMAIL_FROM). A From
// already on the onboarded sending domain sends as itself (transactional mail
// keeps its own identity); any other asked-for sender keeps its display name
// while its address is swapped for the onboarded one and survives as Reply-To.
// With the channel half-configured, mail is logged to the console instead —
// there is no fallback channel (Resend was retired 2026-11-05).

import { describe, expect, it } from "vitest";
import type { HonoEnv } from "../src/env.js";
import {
  isTransientSendError,
  sendEmailBatchResult,
  sendEmailResult,
  type SendArgs,
} from "../src/lib/email.js";

type Bindings = HonoEnv["Bindings"];

function fakeBinding() {
  const sent: Record<string, unknown>[] = [];
  let fail: { code: string; message: string; left: number } | null = null;
  return {
    sent,
    /** Fail the next `times` sends (default: all of them) with this code. */
    setFail(code: string, message = "nope", times = Number.POSITIVE_INFINITY) {
      fail = { code, message, left: times };
    },
    binding: {
      async send(builder: Record<string, unknown>) {
        if (fail && fail.left > 0) {
          fail.left--;
          const err = new Error(fail.message) as Error & { code: string };
          err.code = fail.code;
          throw err;
        }
        sent.push(builder);
        return { messageId: "mid" };
      },
    },
  };
}

const msg = (over: Partial<SendArgs> = {}): SendArgs => ({
  to: "reader@example.com",
  subject: "Issue #4",
  html: "<p>hi</p>",
  text: "hi",
  ...over,
});

const BULK_FROM = "Eisenhower PTO <newsletter@sitemail.eisenhower.school>";

describe("sendEmailResult channel routing", () => {
  it("sends through the binding, swapping only an off-domain From ADDRESS", async () => {
    const { sent, binding } = fakeBinding();
    const env = { EMAIL: binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    const r = await sendEmailResult(env, msg({ from: "Ms. Frizzle <news@eisenhower.school>" }));
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    // The admin's display name survives; the address is the onboarded domain's.
    expect(sent[0]!.from).toEqual({ name: "Ms. Frizzle", email: "newsletter@sitemail.eisenhower.school" });
    // Replies keep going where they always did.
    expect(sent[0]!.replyTo).toBe("news@eisenhower.school");
  });

  it("lets a From already on the sending domain send as ITSELF — transactional identity", async () => {
    const { sent, binding } = fakeBinding();
    const env = {
      EMAIL: binding,
      BULK_EMAIL_FROM: BULK_FROM,
      EMAIL_FROM: "Eisenhower PTO Directory <directory@sitemail.eisenhower.school>",
    } as unknown as Bindings;
    const r = await sendEmailResult(env, msg()); // no per-message From → EMAIL_FROM
    expect(r.ok).toBe(true);
    expect(sent[0]!.from).toEqual({ name: "Eisenhower PTO Directory", email: "directory@sitemail.eisenhower.school" });
    // Its own address needs no Reply-To escape hatch.
    expect(sent[0]!.replyTo).toBeUndefined();
  });

  it("keeps an explicit replyTo and falls back to the configured name", async () => {
    const { sent, binding } = fakeBinding();
    const env = { EMAIL: binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    await sendEmailResult(env, msg({ replyTo: "editor@example.com" }));
    expect(sent[0]!.from).toEqual({ name: "Eisenhower PTO", email: "newsletter@sitemail.eisenhower.school" });
    expect(sent[0]!.replyTo).toBe("editor@example.com");
  });

  it("stays off the binding while the channel is half-configured", async () => {
    const { sent, binding } = fakeBinding();
    for (const env of [
      { EMAIL: binding }, // binding, no From — domain not onboarded yet
      { BULK_EMAIL_FROM: BULK_FROM }, // From, no binding
    ]) {
      // Half-configured → the message is logged, reported accepted, and the
      // assertion that matters is that the BINDING saw nothing.
      const r = await sendEmailResult(env as unknown as Bindings, msg());
      expect(r.ok).toBe(true);
    }
    expect(sent).toEqual([]);
  });

  it("surfaces a binding failure as 'E_CODE: message' for the send ledger", async () => {
    const fake = fakeBinding();
    fake.setFail("E_RATE_LIMIT_EXCEEDED", "slow down");
    const env = { EMAIL: fake.binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    const r = await sendEmailResult(env, msg());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^E_RATE_LIMIT_EXCEEDED: slow down/);
  });
});

describe("sendEmailBatchResult on the binding", () => {
  it("sends individually and reports per-message results", async () => {
    const { sent, binding } = fakeBinding();
    const env = { EMAIL: binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    const r = await sendEmailBatchResult(env, [msg({ to: "a@example.com" }), msg({ to: "b@example.com" })]);
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(sent.map((s) => s.to)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("retries a TRANSIENT per-message failure once, and a refused message doesn't sink its neighbours", async () => {
    const fake = fakeBinding();
    fake.setFail("E_RATE_LIMIT_EXCEEDED", "slow down", 1); // first send only
    const env = { EMAIL: fake.binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    const r = await sendEmailBatchResult(env, [msg({ to: "a@example.com" }), msg({ to: "b@example.com" })]);
    expect(r.ok).toBe(true); // the retry landed it
    expect(r.results!.every((x) => x.ok)).toBe(true);
    expect(fake.sent).toHaveLength(2);
  });

  it("marks a PERMANENT per-message refusal failed without retrying it", async () => {
    const fake = fakeBinding();
    fake.setFail("E_VALIDATION_ERROR", "bad address", 1);
    const env = { EMAIL: fake.binding, BULK_EMAIL_FROM: BULK_FROM } as unknown as Bindings;
    const r = await sendEmailBatchResult(env, [msg({ to: "bad@example.com" }), msg({ to: "ok@example.com" })]);
    expect(r.ok).toBe(false);
    expect(r.results![0]!.ok).toBe(false);
    expect(r.results![1]!.ok).toBe(true);
    expect(fake.sent).toHaveLength(1); // only the healthy neighbour went out
  });
});

describe("isTransientSendError", () => {
  it("judges Cloudflare codes by the transient set", () => {
    expect(isTransientSendError("E_RATE_LIMIT_EXCEEDED: slow down")).toBe(true);
    expect(isTransientSendError("E_DAILY_LIMIT_EXCEEDED: tomorrow")).toBe(true);
    expect(isTransientSendError("E_INTERNAL_SERVER_ERROR: oops")).toBe(true);
    // Retrying an unverified sender or a suppressed recipient earns the same
    // answer forever — these must be permanent or a send loops every cron.
    expect(isTransientSendError("E_SENDER_NOT_VERIFIED: onboard the domain")).toBe(false);
    expect(isTransientSendError("E_RECIPIENT_SUPPRESSED: bounced before")).toBe(false);
    expect(isTransientSendError("E_VALIDATION_ERROR: bad address")).toBe(false);
  });

  it("treats a failure with no verdict code as transient — it never reached the channel's judgement", () => {
    expect(isTransientSendError("network timeout")).toBe(true);
    expect(isTransientSendError("unknown")).toBe(true);
  });
});

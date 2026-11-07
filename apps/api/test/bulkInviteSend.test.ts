// Bulk-import invite mailing, rebuilt after the October 2026 newsletter send
// showed what an unpaced, one-call-per-address fan-out does (the then-channel's
// per-second meter plus the Workers free plan's 50-subrequest cap) — and
// bounded to the ~30-second wall a request's waitUntil actually gets.
//
// What this pins:
//
//   1. Invites go out through the batch seam in slices of INVITE_BATCH, each
//      message its own binding send with one transient retry apiece, reported
//      per message — so a refusal withdraws exactly that invite, never its
//      neighbours, and the accepted sends are never re-sent.
//   2. An invite that never went out is WITHDRAWN (its control_invite and
//      auth_token rows deleted by token hash), because hasPendingInvite would
//      otherwise stop a re-run of the import from ever re-mailing it — the
//      silent, permanent loss the October incident was made of.
//   3. The overflow beyond the per-run batch budget is withdrawn BEFORE any
//      mailing, while the waitUntil is certain to still be alive.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { sendBulkInvites } from "../src/routes/admin.js";
import type { QueuedInvite } from "../src/lib/bulkImport.js";
import { sha256 } from "../src/lib/crypto.js";

interface Fake {
  env: Env;
  sends: string[]; // recipients, in attempt order at the binding
  deletes: string[]; // "ci:<hash>" / "at:<hash>" from withdrawal statements
  order: string[]; // interleaving of "mail" and "withdraw" events
}

function invites(n: number): QueuedInvite[] {
  return Array.from({ length: n }, (_, i) => ({
    email: `fam${i}@example.com`,
    token: `token${i}`,
    personName: `Kid ${i}`,
  }));
}

/** `verdict` answers per attempt, so a test can script "refuse once, then ok". */
function fake(verdict: (to: string, attempt: number) => "ok" | "transient" | "permanent" = () => "ok"): Fake {
  const state: Fake = { env: null as never, sends: [], deletes: [], order: [] };
  const attempts = new Map<string, number>();
  const stmt = (sql: string) => {
    let b: unknown[] = [];
    const s = {
      bind(...args: unknown[]) {
        b = args;
        return s;
      },
      sql,
      boundHash() {
        return b[0] as string;
      },
    };
    return s;
  };
  state.env = {
    DB: {
      prepare: stmt,
      batch: async (stmts: Array<{ sql: string; boundHash(): string }>) => {
        state.order.push("withdraw");
        for (const st of stmts) {
          if (!st.sql.startsWith("DELETE FROM")) throw new Error(`unexpected write: ${st.sql}`);
          state.deletes.push(`${st.sql.includes("control_invite") ? "ci" : "at"}:${st.boundHash()}`);
        }
        return [];
      },
    },
    EMAIL: {
      async send(b: { to: string }) {
        state.order.push("mail");
        state.sends.push(b.to);
        const n = attempts.get(b.to) ?? 0;
        attempts.set(b.to, n + 1);
        const v = verdict(b.to, n);
        if (v === "ok") return { messageId: "mid" };
        const err = new Error(v) as Error & { code: string };
        err.code = v === "transient" ? "E_RATE_LIMIT_EXCEEDED" : "E_VALIDATION_ERROR";
        throw err;
      },
    },
    BULK_EMAIL_FROM: "Eisenhower PTO <newsletter@sitemail.eisenhower.school>",
    SCHOOL_NAME: "Test School",
  } as unknown as Env;
  return state;
}

describe("sendBulkInvites", () => {
  it("mails a roster-sized import once per family, withdrawing nothing", async () => {
    const f = fake();
    await sendBulkInvites(f.env, "https://api.example", invites(60), { paceMs: 0 });

    expect(f.sends).toHaveLength(60);
    expect(new Set(f.sends).size).toBe(60); // nobody mailed twice
    expect(f.deletes).toHaveLength(0);
  });

  it("retries a transient refusal once instead of withdrawing the invite", async () => {
    const f = fake((to, attempt) => (to === "fam3@example.com" && attempt === 0 ? "transient" : "ok"));
    await sendBulkInvites(f.env, "https://api.example", invites(10), { paceMs: 0 });

    expect(f.sends.filter((to) => to === "fam3@example.com")).toHaveLength(2);
    expect(f.deletes).toHaveLength(0);
  });

  it("withdraws exactly the refused invites and never re-sends the accepted ones", async () => {
    const f = fake((to) => (to === "fam1@example.com" ? "permanent" : "ok"));
    await sendBulkInvites(f.env, "https://api.example", invites(20), { paceMs: 0 });

    // A permanent refusal gets no retry; the healthy 19 each went exactly once.
    expect(f.sends.filter((to) => to === "fam1@example.com")).toHaveLength(1);
    expect(f.sends).toHaveLength(20);

    // Only the genuinely unmailable invite is withdrawn — both its rows, by hash.
    const hash = await sha256("token1");
    expect(f.deletes).toEqual([`ci:${hash}`, `at:${hash}`]);
  });

  it("withdraws a refused slice's casualties as soon as that slice settles, not at the end", async () => {
    // One refusal per slice of 10: a withdrawal must follow each slice's sends.
    const f = fake((to) => (to === "fam1@example.com" || to === "fam11@example.com" ? "permanent" : "ok"));
    await sendBulkInvites(f.env, "https://api.example", invites(20), { paceMs: 0 });

    const firstWithdraw = f.order.indexOf("withdraw");
    const lastMail = f.order.lastIndexOf("mail");
    expect(firstWithdraw).toBeGreaterThan(-1);
    expect(firstWithdraw).toBeLessThan(lastMail); // not all deferred to the end
    expect(f.deletes).toHaveLength(2 * 2);
  });

  it("withdraws the overflow beyond the batch budget UP FRONT, before any mail is attempted", async () => {
    const f = fake();
    // 160 invites: 150 fit the budget (15 slices of 10); 10 overflow.
    await sendBulkInvites(f.env, "https://api.example", invites(160), { paceMs: 0 });

    expect(f.sends).toHaveLength(150);
    expect(f.deletes).toHaveLength(10 * 2);
    expect(f.deletes).toContain(`ci:${await sha256("token159")}`);
    // The withdrawal happened while the waitUntil was certain to be alive.
    expect(f.order[0]).toBe("withdraw");
  });
});

// The bingo board's two routes (migration 0040).
//
// Three facts a reader of the route files otherwise takes on faith:
// the public GET genuinely answers with no session and serves EXACTLY the
// public key set; the PUT genuinely refuses without one (absence of
// requireAuth is what a diff can't show — routeAuth.test.ts's reason); and a
// no-op PUT writes nothing and pushes no draft, so the append-only log can't
// be padded by a double tap.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import type { AuditDraft } from "../src/lib/audit.js";
import { bingo } from "../src/routes/bingo.js";
import { bingoPublic } from "../src/routes/bingoPublic.js";
import { normalizeBingoInput } from "../src/lib/bingo.js";
import { UnauthorizedError } from "../src/middleware/session.js";

/** Every key an anonymous caller may see. Changing this list is a deliberate
 *  act — confirm a new field is genuinely safe for a logged-out stranger. */
const PUBLIC_KEYS = ["currentNumber", "markedNumbers", "previous", "updatedAt"].sort();

interface Executed {
  sql: string;
  binds: unknown[];
}

/** D1 stand-in: one SELECT shape, one INSERT shape, statements recorded where
 *  they EXECUTE (run), not where they're prepared. */
type Row = {
  marked_numbers: string;
  current_number: number | null;
  updated_at: string;
  previous_marked_numbers?: string | null;
  previous_ended_at?: string | null;
};
function testEnv(row: Row | null) {
  const executed: Executed[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...binds: unknown[]) => ({
            async first() {
              if (sql.includes("FROM bingo_state")) return row;
              throw new Error(`testEnv: unhandled first(): ${sql}`);
            },
            async run() {
              executed.push({ sql, binds });
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, executed };
}

function auth(): AuthContext {
  return {
    userId: "01USER",
    realUserId: "01USER",
    email: "dana@eisenhower.edu",
    isSystemAdmin: false,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
    // Deliberately NOT approved: running the board is a chore, not a read of
    // member data, so the directory-access gate (invariant 32) is not asked.
    isApproved: false,
  };
}

/** Both routers, with an optional session injected and the drafts captured. */
function appWith(session: AuthContext | null) {
  const drafts: AuditDraft[] = [];
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", drafts);
    if (session) c.set("auth", session);
    await next();
  });
  app.route("/bingo", bingo);
  app.route("/bingo-public", bingoPublic);
  // Mirrors src/index.ts's onError — the only place UnauthorizedError → 401.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return { app, drafts };
}

const GAME_ROW = { marked_numbers: "[12,70,3]", current_number: 3, updated_at: "2026-10-30T01:00:00.000Z" };

describe("GET /bingo-public/state", () => {
  it("answers without a session, exactly the public key set, no-store", async () => {
    const { app } = appWith(null);
    const res = await app.request("/bingo-public/state", {}, testEnv(GAME_ROW).env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { state } = (await res.json()) as { state: Record<string, unknown> };
    expect(Object.keys(state).sort()).toEqual(PUBLIC_KEYS);
    expect(state.markedNumbers).toEqual([12, 70, 3]);
    expect(state.currentNumber).toBe(3);
  });

  it("serves an empty board before the first game, not an error", async () => {
    const { app } = appWith(null);
    const res = await app.request("/bingo-public/state", {}, testEnv(null).env);
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: Record<string, unknown> };
    expect(state).toEqual({ markedNumbers: [], currentNumber: null, updatedAt: null, previous: null });
  });

  it("survives rotted JSON in the row — an empty board, mid-game, not a 500", async () => {
    const { app } = appWith(null);
    const res = await app.request(
      "/bingo-public/state",
      {},
      testEnv({ marked_numbers: "{not json", current_number: 9, updated_at: "2026-10-30T01:00:00.000Z" }).env,
    );
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: { markedNumbers: number[]; currentNumber: unknown } };
    expect(state.markedNumbers).toEqual([]);
    // A current number no longer among the marked is dropped with them.
    expect(state.currentNumber).toBeNull();
  });
});

const put = (body: unknown) => ({
  method: "PUT",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

describe("PUT /bingo/state", () => {
  it("refuses without a session — the board is publicly readable, never publicly writable", async () => {
    const { env, executed } = testEnv(GAME_ROW);
    const { app, drafts } = appWith(null);
    const res = await app.request("/bingo/state", put({ markedNumbers: [], currentNumber: null }), env);
    expect(res.status).toBe(401);
    expect(executed).toEqual([]);
    expect(drafts).toEqual([]);
  });

  it("writes the new state and pushes one draft with the counts", async () => {
    const { env, executed } = testEnv(GAME_ROW);
    const { app, drafts } = appWith(auth());
    const res = await app.request("/bingo/state", put({ markedNumbers: [12, 70, 3, 44], currentNumber: 44 }), env);
    expect(res.status).toBe(200);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.sql).toContain("INSERT INTO bingo_state");
    expect(executed[0]!.binds.slice(0, 3)).toEqual(["board", "[12,70,3,44]", 44]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      action: "bingo.updated",
      entityId: "board",
      detail: { marked: 4, current: 44, was: 3 },
    });
    // No notify bag: bingo.updated is deliberately not Slack-curated.
    expect(drafts[0]!.notify).toBeUndefined();
  });

  it("a no-op PUT writes nothing and pushes no draft", async () => {
    const { env, executed } = testEnv(GAME_ROW);
    const { app, drafts } = appWith(auth());
    const res = await app.request("/bingo/state", put({ markedNumbers: [12, 70, 3], currentNumber: 3 }), env);
    expect(res.status).toBe(200);
    expect(executed).toEqual([]);
    expect(drafts).toEqual([]);
  });

  it("refuses a board it can't trust: out-of-range, non-integer, or a displayed ball never called", async () => {
    const { env, executed } = testEnv(GAME_ROW);
    const { app, drafts } = appWith(auth());
    for (const body of [
      { markedNumbers: [0], currentNumber: null },
      { markedNumbers: [76], currentNumber: null },
      { markedNumbers: [1.5], currentNumber: null },
      { markedNumbers: ["12"], currentNumber: null },
      { markedNumbers: [12], currentNumber: 13 },
      { markedNumbers: "all of them", currentNumber: null },
      {},
    ]) {
      const res = await app.request("/bingo/state", put(body), env);
      expect(res.status).toBe(400);
    }
    expect(executed).toEqual([]);
    expect(drafts).toEqual([]);
  });
});

describe("keeping the cleared game (migration 0047)", () => {
  const BIG = {
    marked_numbers: "[5,20,33,48,61,7]",
    current_number: 7,
    updated_at: "2026-10-30T01:00:00.000Z",
  };
  const clear = { markedNumbers: [], currentNumber: null };

  it("clearing a real game archives its call list, in order, and answers with it", async () => {
    const { env, executed } = testEnv(BIG);
    const { app } = appWith(auth());
    const res = await app.request("/bingo/state", put(clear), env);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.binds[4]).toBe("[5,20,33,48,61,7]");
    expect(executed[0]!.binds[5]).toBe(executed[0]!.binds[3]); // endedAt = the write's own timestamp
    const { state } = (await res.json()) as { state: { previous: { markedNumbers: number[] } | null } };
    expect(state.previous?.markedNumbers).toEqual([5, 20, 33, 48, 61, 7]);
  });

  it("ordinary taps pass NULL so the kept game is left alone", async () => {
    const { env, executed } = testEnv({ ...BIG, previous_marked_numbers: "[1,2,3,4]", previous_ended_at: "2026-10-29T00:00:00.000Z" });
    const { app } = appWith(auth());
    await app.request("/bingo/state", put({ markedNumbers: [5, 20, 33, 48, 61, 7, 9], currentNumber: 9 }), env);
    expect(executed[0]!.binds.slice(4)).toEqual([null, null]);
    expect(executed[0]!.sql).toContain("COALESCE(?, previous_marked_numbers)");
  });

  it("a second clear of an already-empty board writes nothing — the kept game survives a double tap", async () => {
    const { env, executed } = testEnv({
      marked_numbers: "[]", current_number: null, updated_at: "2026-10-30T01:00:00.000Z",
      previous_marked_numbers: "[5,20,33,48,61,7]", previous_ended_at: "2026-10-30T01:00:00.000Z",
    });
    const { app } = appWith(auth());
    await app.request("/bingo/state", put(clear), env);
    expect(executed).toEqual([]);
  });

  it("clearing a barely-started board (a stray tap) does not replace the kept game", async () => {
    const { env, executed } = testEnv({
      marked_numbers: "[12]", current_number: 12, updated_at: "2026-10-30T01:00:00.000Z",
      previous_marked_numbers: "[5,20,33,48,61,7]", previous_ended_at: "2026-10-29T00:00:00.000Z",
    });
    const { app } = appWith(auth());
    await app.request("/bingo/state", put(clear), env);
    expect(executed[0]!.binds.slice(4)).toEqual([null, null]);
  });

  it("the public GET serves the kept game, numbers and a time only", async () => {
    const { app } = appWith(null);
    const res = await app.request(
      "/bingo-public/state",
      {},
      testEnv({ ...BIG, marked_numbers: "[]", current_number: null, previous_marked_numbers: "[5,20,33,48]", previous_ended_at: "2026-10-30T01:05:00.000Z" }).env,
    );
    const { state } = (await res.json()) as { state: { previous: Record<string, unknown> } };
    expect(Object.keys(state.previous).sort()).toEqual(["endedAt", "markedNumbers"]);
    expect(state.previous.markedNumbers).toEqual([5, 20, 33, 48]);
  });
});

describe("normalizeBingoInput", () => {
  it("collapses a double-tap duplicate to its first appearance", () => {
    expect(normalizeBingoInput({ markedNumbers: [5, 9, 5], currentNumber: 9 })).toEqual({
      markedNumbers: [5, 9],
      currentNumber: 9,
    });
  });

  it("treats a missing currentNumber as null", () => {
    expect(normalizeBingoInput({ markedNumbers: [5] })).toEqual({ markedNumbers: [5], currentNumber: null });
  });

  it("accepts the full board and refuses more", () => {
    const all = Array.from({ length: 75 }, (_, i) => i + 1);
    expect(normalizeBingoInput({ markedNumbers: all, currentNumber: 75 })).not.toBeNull();
    expect(normalizeBingoInput({ markedNumbers: [...all, 1, 2], currentNumber: null })).toBeNull();
  });
});

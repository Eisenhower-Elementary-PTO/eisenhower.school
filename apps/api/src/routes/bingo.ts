// Operating the bingo board — the write half of apps/bingo.
//
// Any session will do, like submitting a lost & found item (invariant 33):
// running the board is a game-night chore, not a read of member data, so
// neither `requireApproved` nor a roster gate is asked. What the session
// buys is a closed door against the open internet — the board's state is
// public to READ (routes/bingoPublic.ts), and an anonymous PUT would let
// anyone who finds the hostname wipe a live game.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { endsArchivableGame, normalizeBingoInput, readBingoState, sameBingoState, writeBingoState } from "../lib/bingo.js";

export const bingo = new Hono<HonoEnv>();

/** PUT /bingo/state — replace the whole board.
 *
 *  Full state rather than a toggle delta, so a retry after a dropped write is
 *  trivially safe: last-write-wins over one row, the same answer invariant 28
 *  gives a card drag, and losing a race costs one tap. A PUT that changes
 *  nothing writes nothing and pushes no draft — the append-only log must not
 *  be paddable by a double tap (invariants 5, 27). */
bingo.put("/state", async (c) => {
  requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const next = normalizeBingoInput(body);
  if (!next) return c.json({ error: "invalid_body" }, 400);

  const prev = await readBingoState(c.env);
  if (sameBingoState(prev, next)) return c.json({ state: prev });

  // Clearing a real game keeps its call list (migration 0047) so a winner still
  // in line can be refereed afterwards. Decided here, from the row we just
  // read, so the rule is testable without a database.
  const archive = endsArchivableGame(prev, next) ? prev.markedNumbers : null;
  const updatedAt = await writeBingoState(c.env, next, archive);
  c.var.audit.push({
    action: "bingo.updated",
    entityKind: "bingo",
    entityId: "board",
    // Counts, not the number list: "was 43, now 0" is the reset someone asks
    // about later, and the full list is re-derivable from nothing anyway.
    detail: { marked: next.markedNumbers.length, current: next.currentNumber, was: prev.markedNumbers.length },
  });
  return c.json({
    state: {
      markedNumbers: next.markedNumbers,
      currentNumber: next.currentNumber,
      updatedAt,
      previous: archive ? { markedNumbers: archive, endedAt: updatedAt } : prev.previous,
    },
  });
});

// The bingo board's one row of shared state (migration 0040).
//
// Both routers read through `readBingoState`, which is also the public seam:
// the DTO is hand-built field by field like `publicEventOf` and its siblings,
// so a column added to `bingo_state` later stays server-side until someone
// publishes it on purpose. There is nothing private in the row TODAY — the
// game is 75 numbers — but the habit is the guarantee, not the contents.

import type { BingoPreviousGameDTO, BingoStateDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { nowIso } from "./time.js";

/** The single row. One school, one game at a time. */
const BOARD_ID = "board";

/** A called ball: an integer on the 75-ball board. */
export function isBingoNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 75;
}

/** A cleared game is worth keeping only if somebody could have won it: a card
 *  has 24 numbers plus the free square, and the shortest line is 4 numbers +
 *  FREE. Below that, a stray tap followed by a reset would overwrite the
 *  archive of the game the queue is actually waiting on. */
export const MIN_ARCHIVED_CALLS = 4;

/** What a PUT may replace the board with. Validated, never trusted:
 *  out-of-range or non-integer numbers refuse the whole write (a 400, not a
 *  silently narrowed board — invariant 18's "never a dropped term" posture),
 *  duplicates collapse to their first appearance (a double-tap is a client
 *  hiccup, not a different game), and the displayed ball must be one that was
 *  actually called. */
export function normalizeBingoInput(
  body: unknown,
): { markedNumbers: number[]; currentNumber: number | null } | null {
  if (!body || typeof body !== "object") return null;
  const { markedNumbers, currentNumber } = body as {
    markedNumbers?: unknown;
    currentNumber?: unknown;
  };
  if (!Array.isArray(markedNumbers) || markedNumbers.length > 75) return null;
  const marked: number[] = [];
  for (const n of markedNumbers) {
    if (!isBingoNumber(n)) return null;
    if (!marked.includes(n)) marked.push(n);
  }
  if (currentNumber === null || currentNumber === undefined) {
    return { markedNumbers: marked, currentNumber: null };
  }
  if (!isBingoNumber(currentNumber) || !marked.includes(currentNumber)) return null;
  return { markedNumbers: marked, currentNumber };
}

/** The board as anyone may see it. A missing row — before the first game — is
 *  an empty board, not an error; so is a row whose JSON has somehow rotted
 *  (the parse failing must not take the public GET down mid-game). */
export async function readBingoState(env: Env): Promise<BingoStateDTO> {
  const row = await env.DB.prepare(
    `SELECT marked_numbers, current_number, updated_at, previous_marked_numbers, previous_ended_at
       FROM bingo_state WHERE id = ?`,
  )
    .bind(BOARD_ID)
    .first<{
      marked_numbers: string;
      current_number: number | null;
      updated_at: string;
      previous_marked_numbers: string | null;
      previous_ended_at: string | null;
    }>();
  if (!row) return { markedNumbers: [], currentNumber: null, updatedAt: null, previous: null };

  const marked = parseNumbers(row.marked_numbers);
  const current = isBingoNumber(row.current_number) && marked.includes(row.current_number)
    ? row.current_number
    : null;
  const previousNumbers = row.previous_marked_numbers ? parseNumbers(row.previous_marked_numbers) : [];
  const previous: BingoPreviousGameDTO | null =
    previousNumbers.length > 0 && row.previous_ended_at
      ? { markedNumbers: previousNumbers, endedAt: row.previous_ended_at }
      : null;
  return { markedNumbers: marked, currentNumber: current, updatedAt: row.updated_at, previous };
}

/** JSON column -> called numbers. Rot reads as empty; the next write repairs it. */
function parseNumbers(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter(isBingoNumber);
  } catch {
    // fall through
  }
  return [];
}

/** Does this write END a game worth keeping? A clear of a board that had a
 *  real game on it. Clearing an empty (or barely started) board archives
 *  nothing, so a double tap on reset can't erase the game being refereed. */
export function endsArchivableGame(
  prev: { markedNumbers: number[] },
  next: { markedNumbers: number[] },
): boolean {
  return next.markedNumbers.length === 0 && prev.markedNumbers.length >= MIN_ARCHIVED_CALLS;
}

/** Same game? Order matters — the call order is part of the state (it is what
 *  distinguishes "unmarked and re-marked" from "untouched"). */
export function sameBingoState(
  a: { markedNumbers: number[]; currentNumber: number | null },
  b: { markedNumbers: number[]; currentNumber: number | null },
): boolean {
  return (
    a.currentNumber === b.currentNumber &&
    a.markedNumbers.length === b.markedNumbers.length &&
    a.markedNumbers.every((n, i) => b.markedNumbers[i] === n)
  );
}

/** Replace the board. Last-write-wins over the whole row — one operator with a
 *  touchscreen, and losing a race costs one tap, re-tappable.
 *
 *  `archive` is the call list of the game this write ends, or null. When set it
 *  replaces the kept previous game; when null the kept game is left alone
 *  (COALESCE) — ordinary taps must not disturb it. */
export async function writeBingoState(
  env: Env,
  state: { markedNumbers: number[]; currentNumber: number | null },
  archive: number[] | null = null,
): Promise<string> {
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO bingo_state (id, marked_numbers, current_number, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       marked_numbers = excluded.marked_numbers,
       current_number = excluded.current_number,
       updated_at = excluded.updated_at,
       previous_marked_numbers = COALESCE(?, previous_marked_numbers),
       previous_ended_at = COALESCE(?, previous_ended_at)`,
  )
    .bind(
      BOARD_ID,
      JSON.stringify(state.markedNumbers),
      state.currentNumber,
      updatedAt,
      archive ? JSON.stringify(archive) : null,
      archive ? updatedAt : null,
    )
    .run();
  return updatedAt;
}

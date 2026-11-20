// The referee: a card's printed numbers + the live board = a verdict. The
// shutters are ignored entirely. The only question is "do this card's numbers
// complete a line among the numbers called so far?" — what the player has
// actually slid shut doesn't matter, so neither misplaced shutters nor a
// player who forgot to cover a number can change the answer.
//
// Numbers arrive from camera reading and may be null (not yet settled). A
// line is a win when all five squares are called (FREE is wild). "No bingo"
// is only claimed once every line holds at least one KNOWN number that was
// not called; until then an unread square could still complete a line, so
// the verdict waits.

export type CellVerdict =
  | "free"
  | "called" // the number is on the board
  | "open" // read, and not called
  | "uncertain"; // not read yet

export interface CheckResult {
  verdicts: CellVerdict[];
  /** Winning lines, as arrays of 5 cell indices. */
  lines: number[][];
  /** Near misses on a card with no bingo: for the line(s) closest to winning,
   *  the called-list numbers that are missing — only lines of ONE or TWO
   *  missing numbers where every other square is read and called. Each entry is
   *  one line's missing set (ascending); empty on a win or when nothing is
   *  within two. Ties at the best distance are all listed (capped). */
  near: number[][];
  /** True once the answer is final: a win, or no line can still win. */
  readable: boolean;
}

const LINES: number[][] = [
  ...Array.from({ length: 5 }, (_, r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export function checkCard(numbers: (number | null)[], called: number[]): CheckResult {
  const calledSet = new Set(called);
  const verdicts: CellVerdict[] = [];

  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      verdicts.push("free");
      continue;
    }
    const value = numbers[i] ?? null;
    verdicts.push(value === null ? "uncertain" : calledSet.has(value) ? "called" : "open");
  }

  const lines = LINES.filter((line) =>
    line.every((i) => verdicts[i] === "free" || verdicts[i] === "called"),
  );
  // Every line is ruled out by a square we read and that wasn't called.
  const allBlocked = LINES.every((line) => line.some((i) => verdicts[i] === "open"));

  return { verdicts, lines, near: lines.length > 0 ? [] : nearMisses(verdicts, numbers), readable: lines.length > 0 || allBlocked };
}

const MAX_NEAR = 3;

/** Lines that are one or two numbers short, closest first. A line with a square
 *  not yet read is skipped: "missing" is only claimed about numbers we SAW. */
function nearMisses(verdicts: CellVerdict[], numbers: (number | null)[]): number[][] {
  const sets: number[][] = [];
  for (const line of LINES) {
    if (line.some((i) => verdicts[i] === "uncertain")) continue;
    const open = line.filter((i) => verdicts[i] === "open");
    if (open.length < 1 || open.length > 2) continue;
    const missing = open.map((i) => numbers[i] as number).sort((a, b) => a - b);
    if (!sets.some((s) => s.length === missing.length && s.every((n, k) => n === missing[k]))) sets.push(missing);
  }
  const best = Math.min(...sets.map((s) => s.length));
  return sets.filter((s) => s.length === best).slice(0, MAX_NEAR);
}

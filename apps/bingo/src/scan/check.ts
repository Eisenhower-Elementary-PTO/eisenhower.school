// The referee: a card's printed numbers + the live board = a verdict. The
// shutters are ignored entirely. The only question is "do this card's numbers
// complete a pattern (a line or the four corners) among the numbers called so far?" — what the player has
// actually slid shut doesn't matter, so neither misplaced shutters nor a
// player who forgot to cover a number can change the answer.
//
// Numbers arrive from camera reading and may be null (not yet settled). A
// pattern is a win when all its squares are called (FREE is wild). "No bingo"
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
  /** Winning patterns (lines, or the four corners), as arrays of cell indices. */
  lines: number[][];
  /** True once the answer is final: a win, or no line can still win. */
  readable: boolean;
}

const LINES: number[][] = [
  ...Array.from({ length: 5 }, (_, r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
  // Four corners: a win on its own (the center is not part of it). Same rules
  // as a line: every square called, and "no bingo" waits until a read, uncalled
  // square rules it out like any other pattern.
  [0, 4, 20, 24],
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

  return { verdicts, lines, readable: lines.length > 0 || allBlocked };
}

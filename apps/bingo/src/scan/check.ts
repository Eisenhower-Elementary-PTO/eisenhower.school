// The referee: a scanned card + the live board = a verdict. Three findings
// matter at a game table, in this order:
//   - a winning line (every square in it covered AND actually called),
//   - covered squares that were never called (a bumped shutter, or hope),
//   - called numbers the player hasn't covered yet (just a heads-up).

import type { CellState } from "./vision.js";

export type CellVerdict =
  | "free"
  | "good-mark" // covered, and the number was called
  | "false-mark" // covered, but the number was never called
  | "missed" // open, but the number WAS called
  | "open" // open, not called — nothing to do
  | "uncertain";

export interface CheckResult {
  verdicts: CellVerdict[];
  falseMarks: number[];
  missed: number[];
  /** Winning lines, as arrays of 5 cell indices. */
  lines: number[][];
  readable: boolean;
}

const LINES: number[][] = [
  ...Array.from({ length: 5 }, (_, r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 16, 20, 12].sort((a, b) => a - b),
];

export function checkCard(numbers: number[], states: CellState[], called: number[]): CheckResult {
  const calledSet = new Set(called);
  const verdicts: CellVerdict[] = [];
  const falseMarks: number[] = [];
  const missed: number[] = [];
  let readable = true;

  for (let i = 0; i < 25; i++) {
    const state = states[i] ?? "uncertain";
    if (i === 12) {
      // FREE plays as covered whether or not the shutter is slid.
      verdicts.push("free");
      continue;
    }
    const value = numbers[i] ?? 0;
    if (state === "uncertain") {
      verdicts.push("uncertain");
      readable = false;
    } else if (state === "marked") {
      if (calledSet.has(value)) {
        verdicts.push("good-mark");
      } else {
        verdicts.push("false-mark");
        falseMarks.push(value);
      }
    } else if (calledSet.has(value)) {
      verdicts.push("missed");
      missed.push(value);
    } else {
      verdicts.push("open");
    }
  }

  // A line wins on covered-and-called squares only; FREE is wild.
  const lines = LINES.filter((line) =>
    line.every((i) => {
      const v = verdicts[i];
      return v === "free" || v === "good-mark";
    }),
  );

  return { verdicts, falseMarks, missed, lines, readable };
}

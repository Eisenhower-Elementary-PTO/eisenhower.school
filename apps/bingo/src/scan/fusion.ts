// Multi-frame fusion: one camera frame is a guess, agreement across frames
// is a reading. Numbers are printed, so once a cell's value is locked it
// stays locked (only shutter STATES change during a game, and those are
// re-classified every frame). A human tap always wins.
//
// Pure TS, no DOM — the lock rules are testable without a camera.

import type { CellState } from "./vision.js";
import type { CellReading } from "./reader.js";

interface ValueVotes {
  reads: number;
  confident: number;
  bestScore: number;
  bestMargin: number;
}

interface CellTrack {
  votes: Map<number, ValueVotes>;
  pinned: number | null;
  locked: number | null;
  /** Most recent state classifications, newest last (window of 3). */
  recent: CellState[];
}

export class CardFusion {
  private cells: CellTrack[] = Array.from({ length: 25 }, () => ({
    votes: new Map<number, ValueVotes>(),
    pinned: null,
    locked: null,
    recent: [],
  }));

  reset(): void {
    this.cells = Array.from({ length: 25 }, () => ({
      votes: new Map<number, ValueVotes>(),
      pinned: null,
      locked: null,
      recent: [],
    }));
  }

  /** Cells (other than FREE) that still need a number read this frame. */
  needsReading(i: number): boolean {
    if (i === 12) return false;
    const c = this.cells[i];
    return !!c && c.pinned === null && c.locked === null;
  }

  addState(i: number, state: CellState): void {
    const c = this.cells[i];
    if (!c) return;
    c.recent.push(state);
    if (c.recent.length > 3) c.recent.shift();
  }

  addReading(i: number, reading: CellReading | null): void {
    const c = this.cells[i];
    if (!c || !reading) return;
    const v =
      c.votes.get(reading.value) ??
      ({ reads: 0, confident: 0, bestScore: Infinity, bestMargin: 0 } as ValueVotes);
    v.reads++;
    if (reading.confident) v.confident++;
    if (reading.score < v.bestScore) v.bestScore = reading.score;
    if (reading.margin > v.bestMargin) v.bestMargin = reading.margin;
    c.votes.set(reading.value, v);
    // Lock when two frames agree with at least one confident read, or one
    // read is emphatic on its own (sharp match, no plausible runner-up).
    if (
      (v.confident >= 2) ||
      (v.confident >= 1 && v.reads >= 2) ||
      (v.confident >= 1 && v.bestScore <= 1.0 && v.bestMargin >= 0.8)
    ) {
      c.locked = reading.value;
    }
  }

  pin(i: number, value: number | null): void {
    const c = this.cells[i];
    if (!c) return;
    c.pinned = value;
  }

  /** The fused number for a cell: human > locked > best unlocked guess. */
  numberAt(i: number): { value: number | null; settled: boolean } {
    if (i === 12) return { value: 0, settled: true };
    const c = this.cells[i];
    if (!c) return { value: null, settled: false };
    if (c.pinned !== null) return { value: c.pinned, settled: true };
    if (c.locked !== null) return { value: c.locked, settled: true };
    let best: number | null = null;
    let bestKey = -1;
    for (const [value, v] of c.votes) {
      const key = v.confident * 100 + v.reads;
      if (key > bestKey) { bestKey = key; best = value; }
    }
    return { value: best, settled: false };
  }

  /** Majority of the recent state window (ties go to the newest). */
  stateAt(i: number): CellState {
    const c = this.cells[i];
    if (!c || c.recent.length === 0) return "uncertain";
    const counts = new Map<CellState, number>();
    for (const s of c.recent) counts.set(s, (counts.get(s) ?? 0) + 1);
    let best: CellState = c.recent[c.recent.length - 1] ?? "uncertain";
    let bestN = 0;
    for (const [s, n] of counts) {
      if (n > bestN || (n === bestN && s === c.recent[c.recent.length - 1])) {
        best = s;
        bestN = n;
      }
    }
    return best;
  }

  numbers(): (number | null)[] {
    return Array.from({ length: 25 }, (_, i) => this.numberAt(i).value);
  }

  states(): CellState[] {
    return Array.from({ length: 25 }, (_, i) => this.stateAt(i));
  }

  settledCount(): number {
    let n = 0;
    for (let i = 0; i < 25; i++) if (i === 12 || this.numberAt(i).settled) n++;
    return n;
  }
}

// Multi-frame fusion: one camera frame is a guess, agreement across frames
// is a reading. Numbers are printed, so once a cell's value is locked it
// stays locked. A human tap always wins. (Shutter positions are not tracked:
// the verdict depends on the printed numbers alone.)
//
// Pure TS, no DOM — the lock rules are testable without a camera.

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
}

export class CardFusion {
  private cells: CellTrack[] = Array.from({ length: 25 }, () => ({
    votes: new Map<number, ValueVotes>(),
    pinned: null,
    locked: null,
  }));

  reset(): void {
    this.cells = Array.from({ length: 25 }, () => ({
      votes: new Map<number, ValueVotes>(),
      pinned: null,
      locked: null,
    }));
  }

  /** Cells (other than FREE) that still need a number read this frame. */
  needsReading(i: number): boolean {
    if (i === 12) return false;
    const c = this.cells[i];
    return !!c && c.pinned === null && c.locked === null;
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

  numbers(): (number | null)[] {
    return Array.from({ length: 25 }, (_, i) => this.numberAt(i).value);
  }

  /** Only settled values (pinned or locked), FREE as 0. A verdict that can
   *  declare a winner must not rest on a best guess. */
  settledNumbers(): (number | null)[] {
    return Array.from({ length: 25 }, (_, i) => {
      const n = this.numberAt(i);
      return n.settled ? n.value : null;
    });
  }

  settledCount(): number {
    let n = 0;
    for (let i = 0; i < 25; i++) if (i === 12 || this.numberAt(i).settled) n++;
    return n;
  }
}

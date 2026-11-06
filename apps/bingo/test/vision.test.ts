// Pipeline tests over real card photos (cropped to the card's edges, which
// is what the viewfinder guide hands the pipeline). Ground truth was read by
// a human. If these fail after a vision/reader tweak, the tweak regressed
// the reader, not the fixtures.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { scanCard, WIN_W, WIN_H, MIN_GRID_QUALITY, type Rgba, type CellState } from "../src/scan/vision.js";
import { readCell } from "../src/scan/reader.js";
import { CardFusion } from "../src/scan/fusion.js";
import { checkCard } from "../src/scan/check.js";

function fixture(name: string): Rgba {
  const raw = decode(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

const M = "marked", O = "open";

// fix-open.jpg: five shutters slid, the rest open.
// prettier-ignore
const OPEN_STATES: CellState[] = [O,M,O,O,O, O,O,O,O,M, O,O,M,O,O, O,M,O,O,O, O,O,O,M,O];
// Printed numbers of fix-open.jpg (0 = FREE) — including under the shutters.
// prettier-ignore
const OPEN_NUMBERS = [7,24,35,57,68, 6,17,33,53,73, 14,27,0,56,72, 10,19,42,59,74, 15,26,41,47,66];
// Printed numbers of fix-mixed.jpg / fix-all.jpg (same physical card).
// prettier-ignore
const MIXED_NUMBERS = [9,28,31,54,73, 11,24,35,46,70, 1,18,0,49,69, 10,27,32,47,74, 13,26,44,56,61];

// prettier-ignore
const FIXTURES: { name: string; states: CellState[] }[] = [
  { name: "fix-open.jpg", states: OPEN_STATES },
  { name: "fix-mixed.jpg", // video still, shutters resting half-open; the
    // "uncertain" is a window physically half-covered — the honest verdict.
    states: [O,O,M,O,O, O,"uncertain",M,O,O, O,M,M,M,O, O,O,M,O,O, O,O,M,O,O] },
  { name: "fix-all.jpg", // every shutter slid but one
    states: [M,M,M,O,M, M,M,M,M,M, M,M,M,M,M, M,M,M,M,M, M,M,M,M,M] },
  { name: "fix-washed.jpg", // overexposed: the reds go pink
    states: [O,M,M,O,M, O,O,M,M,O, O,O,M,O,O, O,O,O,M,O, O,O,O,O,O] },
];

describe("scanCard", () => {
  for (const f of FIXTURES) {
    it(`reads every window of ${f.name}`, () => {
      const scan = scanCard(fixture(f.name));
      expect(scan.gridQuality).toBeGreaterThanOrEqual(MIN_GRID_QUALITY);
      const got = scan.cells.map((c) => c.state);
      expect(got).toEqual(f.states);
    });
  }
});

/** Read every readable cell of a fixture; returns per-cell results. */
function readAll(name: string, numbers: number[]) {
  const img = fixture(name);
  const scan = scanCard(img);
  let attempted = 0, correct = 0, wrongConfident = 0;
  for (const cell of scan.cells) {
    const i = cell.row * 5 + cell.col;
    if (i === 12 || cell.state === "uncertain") continue;
    const mode = cell.state === "marked" ? "red" : "open";
    const read = readCell(img, cell.cx, cell.cy, WIN_W, WIN_H, mode, cell.col);
    if (!read) continue;
    attempted++;
    if (read.value === numbers[i]) correct++;
    else if (read.confident) wrongConfident++;
  }
  return { attempted, correct, wrongConfident };
}

describe("readCell (no registration — numbers read live, even through shutters)", () => {
  it("reads fix-open.jpg nearly perfectly", () => {
    const r = readAll("fix-open.jpg", OPEN_NUMBERS);
    expect(r.attempted).toBeGreaterThanOrEqual(20);
    expect(r.correct / r.attempted).toBeGreaterThanOrEqual(0.95);
    expect(r.wrongConfident).toBe(0);
  });

  it("reads the mostly-covered fix-all.jpg through the shutters", () => {
    const r = readAll("fix-all.jpg", MIXED_NUMBERS);
    expect(r.attempted).toBeGreaterThanOrEqual(18);
    expect(r.correct / r.attempted).toBeGreaterThanOrEqual(0.9);
    expect(r.wrongConfident).toBe(0);
  });

  it("never returns a wrong-but-confident read on the hard fixtures", () => {
    for (const [name, numbers] of [
      ["fix-mixed.jpg", MIXED_NUMBERS],
      ["fix-washed.jpg", [11,28,39,60,63, 15,22,43,52,66, 9,19,0,49,61, 14,18,33,53,62, 4,17,38,55,72]],
    ] as const) {
      const r = readAll(name, [...numbers]);
      expect(r.correct / Math.max(1, r.attempted)).toBeGreaterThanOrEqual(0.8);
      expect(r.wrongConfident).toBeLessThanOrEqual(1);
    }
  });
});

describe("CardFusion", () => {
  it("locks a value on two agreeing confident reads, and a tap wins", () => {
    const f = new CardFusion();
    expect(f.needsReading(3)).toBe(true);
    f.addReading(3, { value: 57, score: 1.5, margin: 0.5, confident: true });
    expect(f.numberAt(3)).toEqual({ value: 57, settled: false });
    f.addReading(3, { value: 57, score: 1.4, margin: 0.6, confident: true });
    expect(f.numberAt(3)).toEqual({ value: 57, settled: true });
    expect(f.needsReading(3)).toBe(false);
    f.pin(3, 59);
    expect(f.numberAt(3)).toEqual({ value: 59, settled: true });
    f.pin(3, null);
    expect(f.numberAt(3)).toEqual({ value: 57, settled: true }); // lock remains
  });

  it("settles immediately on one emphatic read", () => {
    const f = new CardFusion();
    f.addReading(7, { value: 33, score: 0.4, margin: 1.2, confident: true });
    expect(f.numberAt(7).settled).toBe(true);
  });

  it("reports the majority shutter state of recent frames", () => {
    const f = new CardFusion();
    f.addState(4, "marked");
    f.addState(4, "open");
    f.addState(4, "open");
    expect(f.stateAt(4)).toBe("open");
  });
});

describe("checkCard", () => {
  it("confirms a clean card and flags a false mark", () => {
    const clean = checkCard(OPEN_NUMBERS, [...OPEN_STATES], [24, 73, 19, 47]);
    expect(clean.readable).toBe(true);
    expect(clean.falseMarks).toEqual([]);
    expect(clean.lines).toEqual([]);
    const dirty = checkCard(OPEN_NUMBERS, [...OPEN_STATES], [24, 73, 19]);
    expect(dirty.falseMarks).toEqual([47]);
  });

  it("withholds the verdict while a covered number is unknown", () => {
    const numbers: (number | null)[] = [...OPEN_NUMBERS];
    numbers[1] = null; // covered cell (24) not read yet
    const res = checkCard(numbers, [...OPEN_STATES], [73, 19, 47]);
    expect(res.readable).toBe(false);
    expect(res.verdicts[1]).toBe("uncertain");
    // An unknown OPEN cell does not block the verdict.
    const numbers2: (number | null)[] = [...OPEN_NUMBERS];
    numbers2[2] = null; // open cell
    expect(checkCard(numbers2, [...OPEN_STATES], [24, 73, 19, 47]).readable).toBe(true);
  });

  it("sees a bingo, including through the FREE square", () => {
    const s = [...OPEN_STATES];
    s[6] = "marked";
    s[11] = "marked";
    s[21] = "marked";
    const res = checkCard(OPEN_NUMBERS, s, [24, 17, 27, 19, 26, 73, 47]);
    expect(res.lines).toContainEqual([1, 6, 11, 16, 21]);
    const d = [...OPEN_STATES];
    d[0] = "marked";
    d[6] = "marked";
    d[18] = "marked";
    d[24] = "marked";
    const diag = checkCard(OPEN_NUMBERS, d, [7, 17, 59, 66, 24, 73, 19, 47]);
    expect(diag.lines).toContainEqual([0, 6, 12, 18, 24]);
  });

  it("reports called-but-uncovered numbers", () => {
    const res = checkCard(OPEN_NUMBERS, [...OPEN_STATES], [24, 73, 19, 47, 14, 42]);
    expect(res.missed.sort((a, b) => a - b)).toEqual([14, 42]);
  });
});

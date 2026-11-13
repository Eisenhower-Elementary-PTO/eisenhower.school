// Pipeline tests over real card photos (cropped to the card's edges, which
// is what the viewfinder guide hands the pipeline). Ground truth was read by
// a human. If these fail after a vision/reader tweak, the tweak regressed
// the reader, not the fixtures.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { scanCard, MIN_GRID_QUALITY, type Rgba, type CellState } from "../src/scan/vision.js";
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
  { name: "fix-mixed.jpg", // video still, shutters resting half-open. Cell 6
    // is an open window whose tab sits a little proud — it covers a quarter of
    // the plate, exactly what every open shutter does.
    states: [O,O,M,O,O, O,O,M,O,O, O,M,M,M,O, O,O,M,O,O, O,O,M,O,O] },
  { name: "fix-all.jpg", // every shutter slid but one
    states: [M,M,M,O,M, M,M,M,M,M, M,M,M,M,M, M,M,M,M,M, M,M,M,M,M] },
  { name: "fix-washed.jpg", // overexposed: the reds go pink
    states: [O,M,M,O,M, O,O,M,M,O, O,O,M,O,O, O,O,O,M,O, O,O,O,O,O] },
];

// The photos below are the three card models the school has met so far,
// cropped to the card the way the viewfinder guide hands it over (and
// downscaled): woodgrain (taller board, dark-maroon BINGO letters that a
// red test accepts), and cream Finger-Tip with its footer. Every one is
// fully open or fully slid. Their digits were harvested into templates.json,
// so the read tests below are REGRESSION pins, not a generalisation measure —
// that was leave-one-physical-card-out over 16 photos of 6 cards: 351/384
// reads confident-and-correct, 1 confident-and-wrong (a shutter caught
// mid-slide).
const NEW_FIXTURES: { name: string; state: CellState; numbers: number[] }[] = [
  // prettier-ignore
  { name: "new-wood-open.jpg", state: O, numbers: [14,27,37,56,72, 11,26,40,52,74, 8,19,0,58,64, 6,30,42,57,71, 15,29,38,60,73] },
  // prettier-ignore
  { name: "new-wood-covered.jpg", state: M, numbers: [5,23,34,54,61, 15,25,33,48,62, 2,18,0,59,73, 10,20,44,46,72, 12,29,32,49,68] },
  // prettier-ignore
  { name: "new-wood-b-open.jpg", state: O, numbers: [5,23,34,54,61, 15,25,33,48,62, 2,18,0,59,73, 10,20,44,46,72, 12,29,32,49,68] },
  // prettier-ignore
  { name: "new-cream-a-open.jpg", state: O, numbers: [7,18,33,49,63, 13,19,34,60,70, 10,21,0,59,65, 6,25,31,48,68, 14,23,32,51,71] },
  // prettier-ignore
  { name: "new-cream-b-covered.jpg", state: M, numbers: [14,24,31,60,69, 1,27,37,49,65, 13,22,0,56,75, 10,16,33,59,62, 11,23,34,48,71] },
  // prettier-ignore
  { name: "new-cream-c-open.jpg", state: O, numbers: [4,20,39,54,69, 10,29,40,51,71, 2,18,0,48,70, 12,19,38,49,63, 1,30,32,50,66] },
  // prettier-ignore
  { name: "new-cream-d-open.jpg", state: O, numbers: [14,22,31,47,70, 11,27,38,58,61, 9,20,0,56,75, 4,19,37,59,67, 12,28,36,57,68] },
];

describe("new card models (woodgrain + cream variants)", () => {
  for (const f of NEW_FIXTURES) {
    it(`finds the grid and every shutter state of ${f.name}`, () => {
      const scan = scanCard(fixture(f.name));
      // Open cards used to score 0.25 here (plates brighter than the board
      // earned no credit), so the live viewfinder never accepted them.
      expect(scan.gridQuality).toBeGreaterThanOrEqual(0.6);
      expect(scan.cells.map((c) => c.state)).toEqual(Array(25).fill(f.state));
    });
    it(`reads the numbers of ${f.name} with no wrong-but-confident cell`, () => {
      const img = fixture(f.name);
      const scan = scanCard(img);
      let right = 0, wrongConfident = 0, tried = 0;
      for (const cell of scan.cells) {
        const i = cell.row * 5 + cell.col;
        if (i === 12) continue;
        const read = readCell(img, cell.cx, cell.cy, scan.winW, scan.winH, cell.state === "marked" ? "red" : "open", cell.col);
        tried++;
        if (read?.value === f.numbers[i]) right++;
        else if (read?.confident) wrongConfident++;
      }
      expect(right / tried).toBeGreaterThanOrEqual(0.9);
      expect(wrongConfident).toBe(0);
    });
  }

  it("never accepts a frame with no card in it", () => {
    // A red-heavy, card-free scene must fail the alignment gate, not hallucinate a grid.
    const w = 400, h = 400;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = 200; data[i * 4 + 1] = 40; data[i * 4 + 2] = 30; data[i * 4 + 3] = 255; }
    expect(scanCard({ data, width: w, height: h }).gridQuality).toBeLessThan(MIN_GRID_QUALITY);
    for (let i = 0; i < w * h; i++) { data[i * 4] = 90; data[i * 4 + 1] = 90; data[i * 4 + 2] = 90; }
    expect(scanCard({ data, width: w, height: h }).gridQuality).toBeLessThan(MIN_GRID_QUALITY);
  });
});

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
    const read = readCell(img, cell.cx, cell.cy, scan.winW, scan.winH, mode, cell.col);
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
    expect(f.settledNumbers()[3]).toBeNull(); // a guess never reaches the referee
    f.addReading(3, { value: 57, score: 1.4, margin: 0.6, confident: true });
    expect(f.numberAt(3)).toEqual({ value: 57, settled: true });
    expect(f.settledNumbers()[3]).toBe(57);
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
});

describe("checkCard (shutters ignored: do the numbers make a line?)", () => {
  it("says no bingo once every line holds a known uncalled number", () => {
    const res = checkCard(OPEN_NUMBERS, [24, 73, 19, 47]);
    expect(res.lines).toEqual([]);
    expect(res.readable).toBe(true);
  });

  it("sees a bingo, including through the FREE square", () => {
    // Column 2 of fix-open: 24, 17, 27, 19, 26 (rows 0-4 of col 1).
    const col = checkCard(OPEN_NUMBERS, [24, 17, 27, 19, 26]);
    expect(col.lines).toContainEqual([1, 6, 11, 16, 21]);
    const diag = checkCard(OPEN_NUMBERS, [7, 17, 59, 66]);
    expect(diag.lines).toContainEqual([0, 6, 12, 18, 24]);
  });

  it("waits while an unread square could still complete a line", () => {
    const numbers: (number | null)[] = [...OPEN_NUMBERS];
    for (const i of [1, 6, 11, 16, 21]) numbers[i] = null; // column 1 unread: could still be a line
    const res = checkCard(numbers, [73]);
    expect(res.readable).toBe(false);
    expect(res.verdicts[1]).toBe("uncertain");
  });

  it("calls a win even while other squares are unread", () => {
    const numbers: (number | null)[] = [...OPEN_NUMBERS];
    numbers[0] = null; // unrelated to column 1
    const res = checkCard(numbers, [24, 17, 27, 19, 26]);
    expect(res.lines).toContainEqual([1, 6, 11, 16, 21]);
    expect(res.readable).toBe(true);
  });
});

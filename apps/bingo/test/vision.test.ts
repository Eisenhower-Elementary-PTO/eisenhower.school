// Pipeline tests over real card photos (cropped to the card's edges, which
// is what the viewfinder guide hands the pipeline). Ground truth was read by
// a human. If these fail after a vision.ts tweak, the tweak regressed the
// reader, not the fixtures.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { scanCard, WIN_W, WIN_H, MIN_GRID_QUALITY, type Rgba, type CellState } from "../src/scan/vision.js";
import { readCellNumber } from "../src/scan/digits.js";
import { checkCard } from "../src/scan/check.js";
import { invalidCells } from "../src/scan/cards.js";

function fixture(name: string): Rgba {
  const raw = decode(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

const M = "marked", O = "open";

// fix-open.jpg: a card with five shutters slid, the rest open.
// prettier-ignore
const OPEN_STATES: CellState[] = [O,M,O,O,O, O,O,O,O,M, O,O,M,O,O, O,M,O,O,O, O,O,O,M,O];
// fix-open.jpg's printed numbers (0 = FREE), human-read.
// prettier-ignore
const OPEN_NUMBERS = [7,24,35,57,68, 6,17,33,53,73, 14,27,0,56,72, 10,19,42,59,74, 15,26,41,47,66];

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

describe("readCellNumber", () => {
  it("prefills most open windows of a registration photo", () => {
    const img = fixture("fix-open.jpg");
    const scan = scanCard(img);
    let attempted = 0, correct = 0;
    for (const cell of scan.cells) {
      const i = cell.row * 5 + cell.col;
      if (i === 12 || cell.state !== "open") continue;
      const read = readCellNumber(img, cell.cx, cell.cy, WIN_W, WIN_H);
      if (read.text === "") continue;
      attempted++;
      if (Number(read.text) === OPEN_NUMBERS[i]) correct++;
    }
    // The register screen is a review UI: what matters is that the prefill
    // attempts most cells and is right nearly every time it commits.
    expect(attempted).toBeGreaterThanOrEqual(14);
    expect(correct / attempted).toBeGreaterThanOrEqual(0.85);
  });
});

describe("checkCard", () => {
  it("confirms a clean card and flags a false mark", () => {
    // Called: all four covered numbers (FREE needs no call) -> clean, no line.
    const clean = checkCard(OPEN_NUMBERS, [...OPEN_STATES], [24, 73, 19, 47]);
    expect(clean.falseMarks).toEqual([]);
    expect(clean.lines).toEqual([]);
    // Remove 47 from the called list: that covered square becomes a false mark.
    const dirty = checkCard(OPEN_NUMBERS, [...OPEN_STATES], [24, 73, 19]);
    expect(dirty.falseMarks).toEqual([47]);
  });

  it("sees a bingo, including through the FREE square", () => {
    // Column I (indices 1,6,11,16,21 -> 24,17,27,19,26) covered and called.
    const s = [...OPEN_STATES];
    s[6] = "marked";
    s[11] = "marked";
    s[21] = "marked";
    const res = checkCard(OPEN_NUMBERS, s, [24, 17, 27, 19, 26, 73, 47]);
    expect(res.lines).toContainEqual([1, 6, 11, 16, 21]);
    // The main diagonal runs through FREE; the other four covered + called.
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

describe("invalidCells", () => {
  it("accepts a legal grid and catches range and duplicate errors", () => {
    expect(invalidCells(OPEN_NUMBERS)).toEqual([]);
    const bad = [...OPEN_NUMBERS];
    bad[0] = 16; // B column must be 1..15
    bad[5] = 7;
    bad[10] = 7; // duplicate pair
    const flagged = invalidCells(bad);
    expect(flagged).toContain(0);
    expect(flagged).toContain(5);
    expect(flagged).toContain(10);
  });
});

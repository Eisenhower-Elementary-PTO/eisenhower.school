// The card reader's eyes. Pure functions over RGBA pixel buffers — no DOM —
// so the same code runs on a camera frame in the browser and on a fixture
// image in vitest.
//
// The physical object is a Regal "Finger-Tip" shutter card (all cards the
// school owns are this one model): a tan board with 25 recessed windows, each
// holding a white number plate and a translucent red shutter. Marked = the
// shutter slid over the number (the window turns solid red, the number stays
// legible). Crucially for detection: an OPEN shutter still rests over the
// LEFT edge of its window (a red dome "tab"), so redness alone doesn't mean
// marked — redness over the number area (the right of the window) does.
//
// The caller hands us the region the user aligned to the on-screen guide
// (the card's edges). Within it:
//   1. a global offset search fits the nominal 5x5 window grid, scoring by
//      "windowness" (red shutter or recessed-paper pixels — ink gets no
//      credit, so printed text can't attract the fit),
//   2. each window is refined locally the same way,
//   3. each window's number area is classified by its red-pixel fraction,
//      with an explicit "uncertain" verdict between the bands.
// Tuned against nine labeled photos (prototype: 100% of cells on every
// reasonably-aimed shot, failures only under extreme perspective — which the
// guide alignment UX rules out, and `gridQuality` flags when it happens).

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type CellState = "marked" | "open" | "uncertain";

export interface CellResult {
  row: number;
  col: number;
  /** Refined window center, as fractions of the analyzed region. */
  cx: number;
  cy: number;
  redFrac: number;
  state: CellState;
  /** How window-like the refined spot is, 0..1 — low means badly placed. */
  quality: number;
}

export interface CardScan {
  cells: CellResult[];
  /** Mean windowness over all 25 cells — gate on this before trusting states. */
  gridQuality: number;
  uncertain: number;
}

// Nominal window-center grid as fractions of the card's bounding box, and the
// window size as a fraction of card width/height. Measured on a flat product
// photo; the searches below absorb per-shot error.
const COLS = [0.128, 0.322, 0.512, 0.703, 0.898] as const;
const ROWS = [0.233, 0.371, 0.511, 0.651, 0.791] as const;
export const WIN_W = 0.085;
export const WIN_H = 0.078;

/** Accept a scan when the grid fit is at least this window-like. */
export const MIN_GRID_QUALITY = 0.45;

const ANALYSIS_WIDTH = 420;

interface Planes {
  w: number;
  h: number;
  hue: Float32Array;
  sat: Float32Array;
  val: Float32Array;
  vBoard: number;
}

const isRed = (h: number, s: number, v: number): boolean =>
  s > 0.35 && v > 0.12 && (h < 25 || h > 335);

/** Box-downsample an RGBA region to `targetW` wide. Pure, DOM-free. */
export function downscale(src: Rgba, targetW: number): Rgba {
  if (src.width <= targetW) return src;
  const scale = src.width / targetW;
  const targetH = Math.max(1, Math.round(src.height / scale));
  const out = new Uint8ClampedArray(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy0 = Math.floor(y * scale), sy1 = Math.min(src.height, Math.ceil((y + 1) * scale));
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.floor(x * scale), sx1 = Math.min(src.width, Math.ceil((x + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i] ?? 0;
          g += src.data[i + 1] ?? 0;
          b += src.data[i + 2] ?? 0;
          n++;
        }
      }
      const o = (y * targetW + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: targetW, height: targetH };
}

function toHsv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function computePlanes(img: Rgba): Planes {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const hue = new Float32Array(n), sat = new Float32Array(n), val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [hh, ss, vv] = toHsv(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
    hue[i] = hh; sat[i] = ss; val[i] = vv;
  }
  // Board brightness reference: median value over probe points between
  // windows (never red there; glare and shadow average out via the median).
  const vs: number[] = [];
  const probe = (fx: number, fy: number) => {
    const cx = Math.round(fx * w), cy = Math.round(fy * h);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (!isRed(hue[i] ?? 0, sat[i] ?? 0, val[i] ?? 0)) vs.push(val[i] ?? 0);
      }
    }
  };
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) probe(((COLS[c] ?? 0) + (COLS[c + 1] ?? 0)) / 2, ROWS[r] ?? 0);
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) probe(COLS[c] ?? 0, ((ROWS[r] ?? 0) + (ROWS[r + 1] ?? 0)) / 2);
  }
  vs.sort((a, b) => a - b);
  const vBoard = vs[(vs.length / 2) | 0] ?? 0.8;
  return { w, h, hue, sat, val, vBoard };
}

/** Red fraction in the tab zone at the window's left edge. The tab dome
 *  shows red on OPEN windows and the shutter covers this zone when closed —
 *  every true window has red here and nothing else on the card does, which
 *  keeps the grid fit off the BINGO letters (they blur into window-like
 *  mid-gray at analysis resolution). */
function tabRed(p: Planes, cx: number, cy: number): number {
  const hw = (WIN_W * p.w) / 2, hh = (WIN_H * p.h) / 2;
  let n = 0, red = 0;
  for (let y = Math.round(cy - hh * 0.7); y <= cy + hh * 0.7; y += 2) {
    for (let x = Math.round(cx - hw * 1.24); x <= cx - hw * 0.5; x += 2) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const i = y * p.w + x;
      n++;
      if (isRed(p.hue[i] ?? 0, p.sat[i] ?? 0, p.val[i] ?? 0)) red++;
    }
  }
  return n ? red / n : 0;
}

/** Grid-fit score: window content plus the tab anchor. Used for the global
 *  and tilt searches only — per-cell refinement uses plain windowness,
 *  because the tab term pulls a single cell's center rightward. */
function cellScore(p: Planes, cx: number, cy: number): number {
  return windowness(p, cx, cy) + tabRed(p, cx, cy);
}

/** Fraction of the window rect at (cx, cy) that looks like window content:
 *  red shutter, or recessed paper clearly darker than the board but not
 *  ink-black. Ink scoring zero is what keeps the fit off printed text. */
function windowness(p: Planes, cx: number, cy: number): number {
  const hw = (WIN_W * p.w) / 2, hh = (WIN_H * p.h) / 2;
  let n = 0, hit = 0;
  for (let y = Math.round(cy - hh); y <= cy + hh; y += 2) {
    for (let x = Math.round(cx - hw); x <= cx + hw; x += 2) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const i = y * p.w + x;
      const h = p.hue[i] ?? 0, s = p.sat[i] ?? 0, v = p.val[i] ?? 0;
      n++;
      if (isRed(h, s, v) || (s < 0.3 && p.vBoard - v > 0.12 && v > 0.28)) hit++;
    }
  }
  return n ? hit / n : 0;
}

/** Red fraction over the number area — the right of the window, past where
 *  an open shutter rests. Fully slid = ~1, open = ~0 even with the tab. */
function classify(p: Planes, cx: number, cy: number): { redFrac: number; state: CellState } {
  const hw = (WIN_W * p.w) / 2, hh = (WIN_H * p.h) / 2;
  const x0 = Math.round(cx - hw + 2 * hw * 0.42), x1 = Math.round(cx + hw * 0.95);
  const y0 = Math.round(cy - hh * 0.7), y1 = Math.round(cy + hh * 0.7);
  let n = 0, red = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const i = y * p.w + x;
      n++;
      if (isRed(p.hue[i] ?? 0, p.sat[i] ?? 0, p.val[i] ?? 0)) red++;
    }
  }
  const redFrac = n ? red / n : 0;
  const state: CellState = redFrac > 0.45 ? "marked" : redFrac < 0.25 ? "open" : "uncertain";
  return { redFrac, state };
}

/** Analyze a guide-aligned card region. The input should contain the card
 *  roughly filling the frame (the guide contract); downscaling happens here. */
export function scanCard(region: Rgba): CardScan {
  const img = downscale(region, ANALYSIS_WIDTH);
  const p = computePlanes(img);

  // Global offset: the whole grid slides together. The vertical range is
  // wide because the header above the grid varies by batch, and a narrow
  // range lets the fit alias onto a one-row-shifted lattice (20 of 25
  // windows still align there). The tabRed term in cellScore is what breaks
  // that tie in favor of the true fit.
  let bestDx = 0, bestDy = 0, bestScore = -1;
  for (let dy = -0.1; dy <= 0.101; dy += 0.01) {
    for (let dx = -0.06; dx <= 0.061; dx += 0.01) {
      let score = 0;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          score += cellScore(p, ((COLS[c] ?? 0) + dx) * p.w, ((ROWS[r] ?? 0) + dy) * p.h);
        }
      }
      if (score > bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
    }
  }

  // Tilt flex: foreshortening stretches the grid linearly, so fit a pitch
  // slope on each axis (rows and columns stay coupled — an independent
  // per-row search wanders on small blurry inputs).
  let vSlope = 0, hSlope = 0;
  let bs = -1;
  for (let s = -0.04; s <= 0.041; s += 0.005) {
    let sum = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        sum += cellScore(p, ((COLS[c] ?? 0) + bestDx) * p.w, ((ROWS[r] ?? 0) + bestDy + s * (r - 2)) * p.h);
      }
    }
    if (sum > bs) { bs = sum; vSlope = s; }
  }
  bs = -1;
  for (let s = -0.04; s <= 0.041; s += 0.005) {
    let sum = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        sum += cellScore(
          p,
          ((COLS[c] ?? 0) + bestDx + s * (c - 2)) * p.w,
          ((ROWS[r] ?? 0) + bestDy + vSlope * (r - 2)) * p.h,
        );
      }
    }
    if (sum > bs) { bs = sum; hSlope = s; }
  }

  // Per-window refinement (plain windowness — see cellScore), then classify.
  const cells: CellResult[] = [];
  let qualitySum = 0, uncertain = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      let cx = 0, cy = 0, quality = -1;
      for (let fy = -0.022; fy <= 0.023; fy += 0.0055) {
        for (let fx = -0.022; fx <= 0.023; fx += 0.0055) {
          const px = ((COLS[c] ?? 0) + bestDx + hSlope * (c - 2) + fx) * p.w;
          const py = ((ROWS[r] ?? 0) + bestDy + vSlope * (r - 2) + fy) * p.h;
          const score = windowness(p, px, py);
          if (score > quality) { quality = score; cx = px; cy = py; }
        }
      }
      const { redFrac, state } = classify(p, cx, cy);
      if (state === "uncertain") uncertain++;
      qualitySum += quality;
      cells.push({ row: r, col: c, cx: cx / p.w, cy: cy / p.h, redFrac, state, quality });
    }
  }

  return { cells, gridQuality: qualitySum / 25, uncertain };
}

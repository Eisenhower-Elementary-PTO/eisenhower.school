// The card reader's eyes. Pure functions over RGBA pixel buffers — no DOM —
// so the same code runs on a camera frame in the browser and on a fixture
// image in vitest.
//
// The physical object is a Regal "Finger-Tip" shutter card: a board with 25
// recessed windows, each holding a white number plate and a translucent red
// shutter. Marked = the shutter slid over the number (the window turns solid
// red, the number stays legible). An OPEN shutter still rests over the LEFT
// edge of its window (a red dome "tab"), so redness alone doesn't mean marked
// — how far the red reaches ACROSS the plate does.
//
// The school owns several models: cream boards with a FINGER-TIP header and a
// footer, and a woodgrain board that is ~10% taller, whose white plates are
// BRIGHTER than the board (the cream ones read darker) and whose BINGO
// letters are dark maroon. Nothing here may assume one of them. What every
// model shares is the bright red of the tabs/shutters and a lattice whose
// row pitch is ~0.8 of its column pitch.
//
// The caller hands us the region the user aligned to the on-screen guide
// (the card's edges). Within it:
//   1. the lattice (centre, column pitch, row pitch) is fit by brute force
//      over summed-area tables of BRIGHT red + window-ish pixels. Ink and
//      dark-maroon print get no credit, so lettering can't attract the fit
//      (a one-row-shifted lattice lands on BINGO otherwise);
//   2. each cell is refined from its own red blob (tab or shutter);
//   3. each cell's COVERAGE (how much of the plate the shutter reaches) is
//      classified, with an explicit "uncertain" verdict between the bands for
//      a shutter caught mid-slide;
//   4. `gridQuality` is tab/shutter evidence per cell, gutter-checked so a
//      red wall can't pass for a card.
// Tuned against 20 labeled photos of 7 cards (the old fits' perspective flex
// is gone: per-cell refinement absorbs the tilt a hand-held guide allows).

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
  /** Mean tab/shutter evidence over all 25 cells, 0..1 — gate on this before trusting states. */
  gridQuality: number;
  uncertain: number;
  /** Fitted window size, fractions of the analyzed region (the lattice pitch
   *  differs per card model, so readers take this, not a constant). */
  winW: number;
  winH: number;
}

// The lattice is searched, not assumed (see scanCard): card models differ in
// height and a hand-held guide never frames two shots alike.

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
  // Board brightness reference: median value over every non-red pixel. The
  // card fills the guide and the board is most of it, so the median is the
  // board whatever the model's layout (plates, ink and glare are minorities).
  const vs: number[] = [];
  for (let i = 0; i < n; i += 3) {
    if (!isRed(hue[i] ?? 0, sat[i] ?? 0, val[i] ?? 0)) vs.push(val[i] ?? 0);
  }
  vs.sort((a, b) => a - b);
  const vBoard = vs[(vs.length / 2) | 0] ?? 0.8;
  return { w, h, hue, sat, val, vBoard };
}

/** Looser red for the coverage bands: they sit inside the window, where the
 *  only candidates are white plate and shutter, so an overexposed pink shutter
 *  (S ~0.25) can be accepted without the wood-grain risk the global test has. */
const isCoverRed = (h: number, s: number, v: number): boolean =>
  s > 0.22 && v > 0.35 && (h < 22 || h > 335);

/** How much of the plate the shutter covers, 0..1 (stored as `redFrac`).
 *  Sampled in two thin bands near the window's top and bottom edges — digits
 *  never reach them, so ink can't pose as a gap in the red — at eight columns
 *  across the plate. An open shutter shows only its tab (~a quarter of the
 *  plate); a slid one covers it all; anything between is a shutter caught
 *  mid-slide, which is "uncertain" and never counted as marked. `cx` is the
 *  PLATE centre; ww/wh are the fitted window size in analysis pixels. */
function classify(p: Planes, cx: number, cy: number, ww: number, wh: number): { redFrac: number; state: CellState } {
  const plateW = ww * 0.8;
  const left = cx - plateW / 2;
  let covered = 0, cols = 0;
  for (let k = 0; k < 8; k++) {
    const x = Math.round(left + ((k + 0.5) / 8) * plateW);
    if (x < 0 || x >= p.w) continue;
    cols++;
    let n = 0, red = 0;
    for (const side of [-1, 1]) {
      for (let f = 0.3; f <= 0.42; f += 0.04) {
        const y = Math.round(cy + side * f * wh);
        if (y < 0 || y >= p.h) continue;
        const i = y * p.w + x;
        n++;
        if (isCoverRed(p.hue[i] ?? 0, p.sat[i] ?? 0, p.val[i] ?? 0)) red++;
      }
    }
    if (n && red / n >= 0.6) covered++;
  }
  const redFrac = cols ? covered / cols : 0;
  const state: CellState = redFrac >= 0.7 ? "marked" : redFrac <= 0.4 ? "open" : "uncertain";
  return { redFrac, state };
}

/** Summed-area table over a 0/1 mask: any rectangle's count in four reads. */
class Integral {
  private t: Uint32Array;
  constructor(private w: number, private h: number, mask: Uint8Array) {
    this.t = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        run += mask[y * w + x] ?? 0;
        this.t[(y + 1) * (w + 1) + x + 1] = (this.t[y * (w + 1) + x + 1] ?? 0) + run;
      }
    }
  }
  /** Count over [x0,x1) x [y0,y1), clamped to the image (outside counts 0). */
  sum(x0: number, y0: number, x1: number, y1: number): number {
    const a = Math.max(0, Math.round(x0)), b = Math.max(0, Math.round(y0));
    const c = Math.min(this.w, Math.round(x1)), d = Math.min(this.h, Math.round(y1));
    if (c <= a || d <= b) return 0;
    const W = this.w + 1;
    return (this.t[d * W + c] ?? 0) - (this.t[b * W + c] ?? 0) - (this.t[d * W + a] ?? 0) + (this.t[b * W + a] ?? 0);
  }
}

/** Window size as a fraction of the lattice pitch (measured: shutters are
 *  ~0.44 of the column pitch and ~0.52 of the row pitch on every model). */
const WIN_OF_PITCH_X = 0.44;
const WIN_OF_PITCH_Y = 0.55;

/** Where a window's PLATE centre sits relative to its red blob. The blob
 *  includes the tab dome, which bulges out of the plate's left edge, so the
 *  plate is ~0.8 of the blob's width: a covered window's centre is that far in
 *  from the blob's right edge; an open window shows only the tab, and the
 *  centre is that far in from the tab's left edge. Fit against labeled
 *  photos of three card models (digits are read around this point, and a
 *  crop shifted a fifth of a window loses the digit beside the edge). */
const COVERED_RIGHT_INSET = 0.38;
const OPEN_LEFT_INSET = 0.6;

interface Lattice {
  /** Grid centre, analysis pixels. */
  x0: number;
  y0: number;
  /** Row/column pitch, analysis pixels. */
  px: number;
  py: number;
}

const latX = (l: Lattice, c: number): number => l.x0 + (c - 2) * l.px;
const latY = (l: Lattice, r: number): number => l.y0 + (r - 2) * l.py;

/** Analyze a guide-aligned card region. The input should contain the card
 *  roughly filling the frame (the guide contract); downscaling happens here.
 *
 *  The lattice is fit by brute force over (centre, column pitch, row/column
 *  pitch ratio) using summed-area tables, so the search can be wide — card
 *  models differ in height (a woodgrain board is ~10% taller than the cream
 *  Finger-Tip one) and a hand-held guide never frames them identically. */
export function scanCard(region: Rgba): CardScan {
  const img = downscale(region, ANALYSIS_WIDTH);
  const p = computePlanes(img);
  const { w, h } = p;

  const red = new Uint8Array(w * h), win = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const hh = p.hue[i] ?? 0, ss = p.sat[i] ?? 0, vv = p.val[i] ?? 0;
    // Anchors need a BRIGHT red: the woodgrain model prints its BINGO letters
    // and logo in dark maroon (V ~0.25-0.3), which the plain red test accepts
    // and which a one-row-shifted lattice happily locks onto. Tabs and
    // shutters read V >= 0.5 even in dim frames.
    const r = isRed(hh, ss, vv) && vv > 0.4;
    if (r) red[i] = 1;
    if (r || (ss < 0.3 && p.vBoard - vv > 0.12 && vv > 0.28)) win[i] = 1;
  }
  const redI = new Integral(w, h, red), winI = new Integral(w, h, win);

  const cellFit = (cx: number, cy: number, ww: number, wh: number): number => {
    const hw = ww / 2, hh = wh / 2;
    const tabA = (hw * 0.74) * (hh * 1.4);
    const tab = redI.sum(cx - hw * 1.24, cy - hh * 0.7, cx - hw * 0.5, cy + hh * 0.7) / Math.max(1, tabA);
    const winA = ww * wh;
    const wn = winI.sum(cx - hw, cy - hh, cx + hw, cy + hh) / Math.max(1, winA);
    return wn + tab;
  };
  const latticeScore = (l: Lattice): number => {
    const ww = WIN_OF_PITCH_X * l.px, wh = WIN_OF_PITCH_Y * l.py;
    let s = 0;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) s += cellFit(latX(l, c), latY(l, r), ww, wh);
    return s;
  };

  // Coarse-to-fine over the four lattice parameters.
  let best: Lattice = { x0: 0.512 * w, y0: 0.5 * h, px: 0.19 * w, py: 0.145 * h };
  let bestScore = -1;
  for (let pxF = 0.16; pxF <= 0.2051; pxF += 0.005) {
    for (let ratio = 0.72; ratio <= 0.8801; ratio += 0.04) {
      const px = pxF * w, py = px * ratio;
      for (let y0 = 0.3 * h; y0 <= 0.65 * h; y0 += 0.01 * h) {
        for (let x0 = 0.42 * w; x0 <= 0.6 * w; x0 += 0.01 * w) {
          const l: Lattice = { x0, y0, px, py };
          const sc = latticeScore(l);
          if (sc > bestScore) { bestScore = sc; best = l; }
        }
      }
    }
  }
  // Fine pass around the coarse winner.
  const c0 = best;
  for (let dpx = -0.006; dpx <= 0.0061; dpx += 0.003) {
    for (let dpy = -0.006; dpy <= 0.0061; dpy += 0.003) {
      for (let dy = -0.012; dy <= 0.0121; dy += 0.004) {
        for (let dx = -0.012; dx <= 0.0121; dx += 0.004) {
          const l: Lattice = { x0: c0.x0 + dx * w, y0: c0.y0 + dy * h, px: c0.px + dpx * w, py: c0.py + dpy * h };
          const sc = latticeScore(l);
          if (sc > bestScore) { bestScore = sc; best = l; }
        }
      }
    }
  }

  const ww = WIN_OF_PITCH_X * best.px, wh = WIN_OF_PITCH_Y * best.py;

  // Per-window refinement from the cell's own red blob (tab or shutter —
  // both are red, and nothing else on the card is bright red): the vertical
  // centre is the blob's centroid in either state; horizontally a covered
  // window's blob spans it, while an open one shows only the left tab, so
  // there the tab's left edge is placed using the offset the covered/typical
  // cells show.
  interface Blob { n: number; minX: number; maxX: number; cy: number }
  const blobAt = (lx: number, ly: number): Blob | null => {
    let n = 0, minX = Infinity, maxX = -Infinity, sy = 0;
    const x0 = Math.max(0, Math.round(lx - ww * 0.8)), x1 = Math.min(w - 1, Math.round(lx + ww * 0.7));
    const y0 = Math.max(0, Math.round(ly - wh * 0.9)), y1 = Math.min(h - 1, Math.round(ly + wh * 0.9));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!red[y * w + x]) continue;
        n++; sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return n >= 6 ? { n, minX, maxX, cy: sy / n } : null;
  };
  const blobs: (Blob | null)[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) blobs.push(blobAt(latX(best, c), latY(best, r)));
  }

  const cells: CellResult[] = [];
  let qualitySum = 0, uncertain = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const lx = latX(best, c), ly = latY(best, r);
      const b = blobs[r * 5 + c] ?? null;
      let cx = lx, cy = ly;
      if (b) {
        // Clamp: a refinement may nudge the lattice, never relocate a cell.
        const wide = b.maxX - b.minX >= ww * 0.75;
        // A covered window's blob includes the tab dome on its left, so its
        // midpoint sits left of the window's: anchor on the right edge.
        const bx = wide ? b.maxX - ww * COVERED_RIGHT_INSET : b.minX + ww * OPEN_LEFT_INSET;
        cx = Math.min(lx + ww * 0.3, Math.max(lx - ww * 0.3, bx));
        cy = Math.min(ly + wh * 0.3, Math.max(ly - wh * 0.3, b.cy));
      }
      // Quality: red in the tab zone (present on every real window, open or
      // covered) and NOT in the gutter between columns — a red shirt fills
      // both, a card only the first.
      const hw = ww / 2, hh = wh / 2;
      const tabA = hw * 0.74 * hh * 1.4;
      const tab = redI.sum(cx - hw * 1.24, cy - hh * 0.7, cx - hw * 0.5, cy + hh * 0.7) / Math.max(1, tabA);
      const gx = cx + best.px * 0.5;
      const gap = redI.sum(gx - best.px * 0.1, cy - hh, gx + best.px * 0.1, cy + hh) / Math.max(1, best.px * 0.2 * wh);
      const quality = Math.min(1, tab / 0.5) * (gap < 0.3 ? 1 : 0);
      const { redFrac, state } = classify(p, cx, cy, ww, wh);
      if (state === "uncertain") uncertain++;
      qualitySum += quality;
      cells.push({ row: r, col: c, cx: cx / p.w, cy: cy / p.h, redFrac, state, quality });
    }
  }
  return { cells, gridQuality: qualitySum / 25, uncertain, winW: ww / w, winH: wh / h };
}

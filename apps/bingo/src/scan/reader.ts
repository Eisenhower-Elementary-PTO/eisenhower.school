// Reads the printed number in a window — open OR covered — with no card
// registration. The shutter is translucent mylar, so a covered number still
// shows through (darker, red-tinted); and bingo's own structure does the
// heavy lifting: column c holds only 15c+1..15c+15, so recognition is a
// 15-way choice, not free OCR.
//
// Segmentation binarizes the window interior against its own background
// brightness and keeps digit-shaped connected components. Contrast varies
// wildly (glare, dim frames, overexposed pink shutters) and the dark
// window-edge ring can swallow a digit at one threshold and not another, so
// segmentation only PROPOSES: every distinct threshold/erosion variant is
// handed to the decoder, which scores all legal column values against a
// template library of this font's digits (harvested from labeled photos of
// real cards, in both open and covered appearance — templates.json) and
// keeps the best reading. `score` is mean per-pixel distance on a 0..15
// scale; `margin` is the gap to the runner-up VALUE. Low margin or high
// score ⇒ not confident ⇒ the UI flags the cell for a tap-fix.

import type { Rgba } from "./vision.js";
import templatesJson from "./templates.json";

export type CellMode = "open" | "red";

export interface CellReading {
  value: number;
  score: number;
  margin: number;
  confident: boolean;
}

/** Thresholds tuned on the sample photos: on well-aimed shots, wrong reads
 *  essentially never pass both gates. */
const CONFIDENT_SCORE = 2.2;
const CONFIDENT_MARGIN = 0.35;

/** Added to single-digit candidates in column B when a two-digit reading exists. */
const SINGLE_DIGIT_PENALTY = 1.0;

const TW: number = templatesJson.w;
const TH: number = templatesJson.h;

export interface Template {
  label: string;
  q: Uint8Array;
}

let templates: Template[] | null = null;

/** Unpack a templates.json sample (two 4-bit cells per byte). */
export function unpackTemplate(s: { d: string; b: string }): Template {
  const bytes = Uint8Array.from(atob(s.b), (ch) => ch.charCodeAt(0));
  const q = new Uint8Array(TW * TH);
  for (let i = 0; i < q.length; i++) {
    const byte = bytes[i >> 1] ?? 0;
    q[i] = i & 1 ? byte >> 4 : byte & 0x0f;
  }
  return { label: s.d, q };
}

export function library(): Template[] {
  if (templates) return templates;
  templates = templatesJson.samples.map(unpackTemplate);
  return templates;
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

interface Comp {
  n: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  mask: Uint8Array;
}

/** Normalize one component's pixels to a TW x TH bitmap, 0..15 per cell. */
function toBmp(d: Comp, W: number): Uint8Array {
  const H = d.mask.length / W;
  const q = new Uint8Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) {
    for (let tx = 0; tx < TW; tx++) {
      const x = d.minX + ((tx + 0.5) / TW) * d.w;
      const y = d.minY + ((ty + 0.5) / TH) * d.h;
      let on = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.round(x + (dx * (d.w / TW)) / 3), yy = Math.round(y + (dy * (d.h / TH)) / 3);
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          cnt++;
          if (d.mask[yy * W + xx] ?? 0) on++;
        }
      }
      q[ty * TW + tx] = cnt ? Math.min(15, Math.round((on / cnt) * 15)) : 0;
    }
  }
  return q;
}

function trySegment(
  vals: Float32Array,
  nearRed: Uint8Array,
  W: number,
  H: number,
  thr: number,
  mode: CellMode,
  erode: boolean,
): Comp[] | null {
  let mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (mode === "red") {
      if ((vals[i] ?? 1) < thr) mask[i] = 1; // dark against the shutter
    } else if (!(nearRed[i] ?? 0) && (vals[i] ?? 1) < thr) {
      mask[i] = 1;
    }
  }
  if (erode) {
    const e = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) e[i] = 1;
      }
    }
    mask = e;
  }
  // Connected components (4-neighborhood).
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const comps: Comp[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!(mask[start] ?? 0) || (seen[start] ?? 0)) continue;
    let sp = 0, n = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const pIdx = stack[--sp] ?? 0;
      const x = pIdx % W, y = (pIdx / W) | 0;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const q of [pIdx - 1, pIdx + 1, pIdx - W, pIdx + W]) {
        if (q < 0 || q >= W * H || (seen[q] ?? 0) || !(mask[q] ?? 0)) continue;
        if (Math.abs((q % W) - x) > 1) continue;
        seen[q] = 1;
        stack[sp++] = q;
      }
    }
    comps.push({ n, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, mask });
  }
  let digits = comps.filter(
    (c) =>
      c.h >= H * 0.18 && c.h <= H * 0.52 &&
      c.w >= W * 0.05 && c.w <= W * 0.52 &&
      c.minX > 0 && c.maxX < W - 1 && c.minY > 0 && c.maxY < H - 1 &&
      c.n >= c.w * c.h * 0.18 &&
      c.h / c.w >= 0.9,
  );
  // Two digits printed close can merge into one wide blob (which the aspect
  // filter rejects): split the best such candidate at the thinnest column
  // near its middle.
  if (digits.length < 2) {
    const merged = comps.find(
      (c) =>
        c.h >= H * 0.18 && c.h <= H * 0.52 &&
        c.w >= W * 0.4 && c.w <= W * 0.85 &&
        c.h / c.w >= 0.45 && c.h / c.w < 1.1 &&
        c.minX > 0 && c.maxX < W - 1 && c.minY > 0 && c.maxY < H - 1 &&
        c.n >= c.w * c.h * 0.18,
    );
    if (merged) digits = [merged];
  }
  const first = digits[0];
  if (digits.length === 1 && first && first.w >= W * 0.4 && first.h / first.w < 1.4) {
    const colDensity: number[] = new Array<number>(first.w).fill(0);
    for (let y = first.minY; y <= first.maxY; y++) {
      for (let x = first.minX; x <= first.maxX; x++) {
        if (mask[y * W + x]) colDensity[x - first.minX] = (colDensity[x - first.minX] ?? 0) + 1;
      }
    }
    let cut = -1, cutVal = Infinity;
    for (let x = Math.round(first.w * 0.3); x <= Math.round(first.w * 0.7); x++) {
      const v = colDensity[x] ?? Infinity;
      if (v < cutVal) { cutVal = v; cut = x; }
    }
    if (cut > 0 && cutVal <= Math.max(2, first.h * 0.12)) {
      digits = [
        { ...first, maxX: first.minX + cut - 1, w: cut },
        { ...first, minX: first.minX + cut + 1, w: first.w - cut - 1 },
      ];
    }
  }
  if (digits.length === 0) return null;
  // A lone digit with real ink beside it that segmentation refused (a digit
  // half over a shutter's edge, glare across it) is an INCOMPLETE reading, not
  // a one-digit number: "15" with its 5 lost decodes as a perfect "1".
  if (digits.length === 1) {
    const only = digits[0];
    if (only) {
      for (const c of comps) {
        if (c === only || c.minX <= only.maxX || c.h < H * 0.1 || c.n < 20) continue;
        if (c.maxX >= W - 1 && c.w < W * 0.04) continue; // the plate's own edge, not a digit
        return null;
      }
    }
  }
  digits.sort((a, b) => a.minX - b.minX);
  if (digits.length > 2) {
    // Pick the best aligned adjacent pair (taller crops can catch strays).
    let best: [Comp, Comp] | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < digits.length - 1; i++) {
      const a = digits[i], b = digits[i + 1];
      if (!a || !b) continue;
      const gap = b.minX - a.maxX;
      const align = Math.abs(a.minY - b.minY) + Math.abs(a.h - b.h);
      if (gap < 0 || gap > W * 0.2) continue;
      if (align < bestScore) { bestScore = align; best = [a, b]; }
    }
    if (!best) return null;
    digits = best;
  }
  if (digits.length === 2) {
    const [a, b] = digits as [Comp, Comp];
    if (Math.abs(a.minY - b.minY) > H * 0.11 || Math.abs(a.h - b.h) > Math.max(a.h, b.h) * 0.3) return null;
  }
  return digits;
}

/** Segment the window at (cx, cy) — fractions of `img` — into digit-bitmap
 *  candidates, one per distinct threshold/erosion variant. */
export function segmentCell(
  img: Rgba,
  cx: number,
  cy: number,
  winW: number,
  winH: number,
  mode: CellMode,
): Uint8Array[][] | null {
  const wO = winW * img.width, hO = winH * img.height;
  const cxO = cx * img.width, cyO = cy * img.height;
  // Full window for red (the shutter covers all of it), right-of-tab for
  // open. Tall vertical margins: the detected center can sit a third of a
  // window off, and a digit clipped by the crop edge is a digit lost.
  const left = mode === "red" ? 0.52 : 0.4;
  const cropX = Math.max(0, Math.round(cxO - wO * left));
  const cropY = Math.max(0, Math.round(cyO - hO * 0.85));
  const cropW = Math.min(img.width - cropX, Math.round(wO * (mode === "red" ? 1.06 : 1.0)));
  const cropH = Math.min(img.height - cropY, Math.round(hO * 1.7));
  if (cropW < 8 || cropH < 8) return null;

  const scale = Math.max(1, 120 / cropW);
  const W = Math.round(cropW * scale), H = Math.round(cropH * scale);
  const vals = new Float32Array(W * H);
  const reds = new Uint8Array(W * H);
  const bg: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = cropX + Math.min(cropW - 1, Math.floor(x / scale));
      const sy = cropY + Math.min(cropH - 1, Math.floor(y / scale));
      const i = (sy * img.width + sx) * 4;
      const [h, s, v] = toHsv(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0);
      vals[y * W + x] = v;
      // Two red notions. LOOSE finds the shutter even in dim frames (for
      // background sampling); CONFIDENT drives tab exclusion — dim warm
      // lighting makes black ink read as low-value "red", and excluding
      // that would erase the digits.
      const loose = s > 0.3 && v > 0.12 && (h < 30 || h > 330);
      const confident = s > 0.4 && v > 0.28 && (h < 30 || h > 330);
      if (confident) reds[y * W + x] = 1;
      if (mode === "red" ? loose : !loose) bg.push(v);
    }
  }
  if (bg.length < 50) return null;
  bg.sort((a, b) => a - b);
  const bgV = bg[(bg.length * 0.7) | 0] ?? 0.8;

  // Exclude anything NEAR confident red, not just red itself: the tab's
  // dark shadow ring otherwise merges with the first digit.
  let nearRed = reds;
  for (let it = 0; it < 3; it++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (
          nearRed[i] ||
          (x > 0 && nearRed[i - 1]) || (x < W - 1 && nearRed[i + 1]) ||
          (y > 0 && nearRed[i - W]) || (y < H - 1 && nearRed[i + W])
        ) {
          next[i] = 1;
        }
      }
    }
    nearRed = next;
  }

  const variants: Uint8Array[][] = [];
  const seenKeys = new Set<string>();
  for (const erode of [false, true]) {
    for (const k of [0.6, 0.7, 0.5, 0.8, 0.42]) {
      const digits = trySegment(vals, nearRed, W, H, bgV * k, mode, erode);
      if (!digits) continue;
      const key = digits.map((d) => `${d.minX},${d.minY},${d.w},${d.h}`).join("|");
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      variants.push(digits.map((d) => toBmp(d, W)));
      if (variants.length >= 6) return variants;
    }
  }
  return variants.length ? variants : null;
}

/** Distance from one digit bitmap to each digit class 0-9 (best template
 *  per class). Computed once per bitmap, then shared across the up to 15
 *  candidate values that reference it. */
function distByClass(q: Uint8Array, lib: Template[]): Float64Array {
  const out = new Float64Array(10).fill(Infinity);
  for (const tpl of lib) {
    const cls = tpl.label.charCodeAt(0) - 48;
    if (cls < 0 || cls > 9) continue;
    let d = 0;
    for (let i = 0; i < q.length; i++) d += Math.abs((q[i] ?? 0) - (tpl.q[i] ?? 0));
    d /= TW * TH;
    if (d < (out[cls] ?? Infinity)) out[cls] = d;
  }
  return out;
}

/** Decode all segmentation variants against the column's 15 legal values. */
export function decodeCell(
  variants: Uint8Array[][] | null,
  col: number,
  lib: Template[] = library(),
): CellReading | null {
  if (!variants || variants.length === 0) return null;
  const byValue = new Map<number, number>();
  for (const bmps of variants) {
    const dists = bmps.map((b) => distByClass(b, lib));
    for (let v = col * 15 + 1; v <= col * 15 + 15; v++) {
      const s = String(v);
      if (s.length !== bmps.length) continue;
      let score = 0;
      for (let i = 0; i < s.length; i++) score += dists[i]?.[s.charCodeAt(i) - 48] ?? Infinity;
      score /= s.length;
      const prev = byValue.get(v);
      if (prev === undefined || score < prev) byValue.set(v, score);
    }
  }
  if (byValue.size === 0) return null;
  // Column B alone holds single-digit numbers, and there a lone "1" is the
  // classic false read: at some thresholds the second digit of 13/14/15 fades
  // into the shutter and the "1" survives on its own, matching its template
  // very well. When ANY variant segmented two digits, the number is
  // two-digit; a genuine single digit essentially never splits in two.
  if (col === 0) {
    let twoDigit = false;
    for (const v of byValue.keys()) if (v >= 10) twoDigit = true;
    if (twoDigit) for (const [v, sc] of byValue) if (v < 10) byValue.set(v, sc + SINGLE_DIGIT_PENALTY);
  }
  const sorted = [...byValue.entries()].sort((a, b) => a[1] - b[1]);
  const top = sorted[0];
  if (!top || !Number.isFinite(top[1])) return null;
  const margin = sorted.length > 1 ? (sorted[1]?.[1] ?? Infinity) - top[1] : 99;
  return {
    value: top[0],
    score: top[1],
    margin,
    confident: top[1] <= CONFIDENT_SCORE && margin >= CONFIDENT_MARGIN,
  };
}

/** One-call convenience: segment + decode. */
export function readCell(
  img: Rgba,
  cx: number,
  cy: number,
  winW: number,
  winH: number,
  mode: CellMode,
  col: number,
): CellReading | null {
  return decodeCell(segmentCell(img, cx, cy, winW, winH, mode), col);
}

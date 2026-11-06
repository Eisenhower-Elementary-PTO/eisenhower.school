// Registration-time number reading: fixed-font template matching, no OCR
// engine. Every Finger-Tip card prints its numbers in the same bold face, so
// a nearest-neighbor match against ~126 labeled digit bitmaps (harvested from
// sample photos, 20x28 at 4-bit depth — templates.json, ~50KB) recognizes
// ~92% of digits. The register screen shows each window's crop beside the
// prefilled number, so a miss is one glance and one tap to fix; `confident`
// drives which cells get highlighted for a second look.
//
// Segmentation: binarize the window interior against its own paper
// brightness (red excluded, so the shutter tab and its fringe drop out),
// take connected components, keep the digit-shaped ones.

import type { Rgba } from "./vision.js";
import templatesJson from "./templates.json";

export interface DigitRead {
  /** "" when nothing digit-like was found. */
  text: string;
  /** False when the match was weak or ambiguous — highlight for review. */
  confident: boolean;
}

interface Template {
  label: string;
  q: Uint8Array;
}

const TW: number = templatesJson.w;
const TH: number = templatesJson.h;

let templates: Template[] | null = null;

function library(): Template[] {
  if (templates) return templates;
  templates = templatesJson.samples.map((s) => {
    const bytes = Uint8Array.from(atob(s.b), (ch) => ch.charCodeAt(0));
    const q = new Uint8Array(TW * TH);
    for (let i = 0; i < q.length; i++) {
      const byte = bytes[i >> 1] ?? 0;
      q[i] = i & 1 ? byte >> 4 : byte & 0x0f;
    }
    return { label: s.d, q };
  });
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
}

/** Read the number in one window. `img` is the full-resolution card region,
 *  (cx, cy) the window center as fractions of it (from CellResult), and
 *  (winW, winH) the window size as fractions of the region. */
export function readCellNumber(img: Rgba, cx: number, cy: number, winW: number, winH: number): DigitRead {
  const wO = winW * img.width, hO = winH * img.height;
  const cxO = cx * img.width, cyO = cy * img.height;
  // Window interior right of the tab's resting zone, generous margins.
  const cropX = Math.max(0, Math.round(cxO - wO * 0.4));
  const cropY = Math.max(0, Math.round(cyO - hO * 0.6));
  const cropW = Math.min(img.width - cropX, Math.round(wO));
  const cropH = Math.min(img.height - cropY, Math.round(hO * 1.2));
  if (cropW < 8 || cropH < 8) return { text: "", confident: false };

  // Crop, upscaling to at least 120px wide (nearest neighbor is fine: the
  // binarization threshold is relative, not edge-sensitive).
  const scale = Math.max(1, 120 / cropW);
  const W = Math.round(cropW * scale), H = Math.round(cropH * scale);
  const vals = new Float32Array(W * H);
  const reds = new Uint8Array(W * H);
  const bright: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = cropX + Math.min(cropW - 1, Math.floor(x / scale));
      const sy = cropY + Math.min(cropH - 1, Math.floor(y / scale));
      const i = (sy * img.width + sx) * 4;
      const [h, s, v] = toHsv(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0);
      vals[y * W + x] = v;
      if (s > 0.3 && (h < 30 || h > 330)) reds[y * W + x] = 1;
      else bright.push(v);
    }
  }
  if (bright.length === 0) return { text: "", confident: false };
  bright.sort((a, b) => a - b);
  const paper = bright[(bright.length * 0.7) | 0] ?? 0.8;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!(reds[i] ?? 0) && (vals[i] ?? 0) < paper * 0.6) mask[i] = 1;
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
    comps.push({ n, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }

  const digits = comps.filter(
    (c) =>
      c.h >= H * 0.28 && c.h <= H * 0.68 &&
      c.w >= W * 0.06 && c.w <= W * 0.5 &&
      c.minX > 0 && c.maxX < W - 1 && c.minY > 0 && c.maxY < H - 1 &&
      c.n >= c.w * c.h * 0.2,
  );
  if (digits.length === 0 || digits.length > 2) return { text: "", confident: false };
  digits.sort((a, b) => a.minX - b.minX);
  if (digits.length === 2) {
    const [a, b] = digits as [Comp, Comp];
    if (Math.abs(a.minY - b.minY) > H * 0.12 || Math.abs(a.h - b.h) > Math.max(a.h, b.h) * 0.25) {
      return { text: "", confident: false };
    }
  }

  // Normalize each component to TW x TH (4-bit) and match.
  let text = "";
  let confident = true;
  for (const d of digits) {
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
            if (mask[yy * W + xx] ?? 0) on++;
          }
        }
        q[ty * TW + tx] = cnt ? Math.min(15, Math.round((on / cnt) * 15)) : 0;
      }
    }
    let bestLabel = "", bestD = Infinity, secondD = Infinity, secondLabel = "";
    for (const tpl of library()) {
      let dist = 0;
      for (let i = 0; i < q.length; i++) dist += Math.abs((q[i] ?? 0) - (tpl.q[i] ?? 0));
      if (dist < bestD) {
        if (tpl.label !== bestLabel) { secondD = bestD; secondLabel = bestLabel; }
        bestD = dist;
        bestLabel = tpl.label;
      } else if (dist < secondD && tpl.label !== bestLabel) {
        secondD = dist;
        secondLabel = tpl.label;
      }
    }
    void secondLabel;
    // Mean per-pixel distance over a 0..15 scale; past ~3 the shape is not
    // really this font, and a near-tie between classes is a coin flip.
    const mean = bestD / q.length;
    if (mean > 3 || (secondD - bestD) / q.length < 0.15) confident = false;
    text += bestLabel;
  }
  return { text, confident };
}

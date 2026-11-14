// Opt-in timing for the reading loop: add ?perf to /scan/ and a small readout
// appears over the camera. Off by default, so a normal visit pays for nothing
// beyond one boolean check per tick. Built to answer "would a Web Worker help?":
// if `total` stays well under the tick interval and `gap` matches it, the main
// thread has headroom and the interval can simply come down; if `total` is a
// large share of the interval (or `gap` runs long), the loop is saturating it.

const WINDOW = 30;

export const perfEnabled = new URLSearchParams(location.search).has("perf");

class Series {
  private v: number[] = [];
  add(x: number): void {
    this.v.push(x);
    if (this.v.length > WINDOW) this.v.shift();
  }
  avg(): number {
    return this.v.length ? this.v.reduce((a, b) => a + b, 0) / this.v.length : 0;
  }
  max(): number {
    return this.v.length ? Math.max(...this.v) : 0;
  }
  get n(): number {
    return this.v.length;
  }
}

export class PerfStats {
  private series = new Map<string, Series>();
  private lastTickAt = 0;
  private ticks = 0;
  private aligned = 0;

  record(name: string, ms: number): void {
    let s = this.series.get(name);
    if (!s) this.series.set(name, (s = new Series()));
    s.add(ms);
  }

  /** Call once at the start of every tick: records the real gap since the last. */
  tickStart(now: number): void {
    if (this.lastTickAt) this.record("gap", now - this.lastTickAt);
    this.lastTickAt = now;
    this.ticks++;
  }

  noteAligned(ok: boolean): void {
    if (ok) this.aligned++;
  }

  report(): string {
    const row = (label: string, key: string, unit = "ms"): string => {
      const s = this.series.get(key);
      if (!s || s.n === 0) return `${label.padEnd(8)} -`;
      return `${label.padEnd(8)} avg ${s.avg().toFixed(1)}${unit}  max ${s.max().toFixed(1)}${unit}`;
    };
    return [
      row("capture", "capture"),
      row("scan", "scan"),
      row("read", "read"),
      row("per cell", "cell"),
      row("total", "total"),
      row("gap", "gap"),
      `ticks ${this.ticks}  aligned ${this.aligned}`,
    ].join("\n");
  }
}

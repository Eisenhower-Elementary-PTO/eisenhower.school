// The card-check app (/scan): point the phone at ANY Finger-Tip shutter
// card and get a verdict against the live board — no registration, no per-
// card setup (the school owns 500+ cards). All vision runs in this tab:
// grid detection and shutter states every frame (vision.ts), printed
// numbers read through open windows AND translucent shutters with
// column-constrained template matching (reader.ts), fused across frames
// until each cell settles (fusion.ts), refereed against the called numbers
// (check.ts). A tap on any square corrects a misread; "next card" resets
// for the following player. The only network traffic is the same
// /bingo-public/state poll the spectator board makes.

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, state, query } from "lit/decorators.js";
import { api } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { scanCard, WIN_W, WIN_H, MIN_GRID_QUALITY, type CardScan, type Rgba } from "./vision.js";
import { readCell } from "./reader.js";
import { CardFusion } from "./fusion.js";
import { checkCard, type CheckResult } from "./check.js";
import scannerStyles from "./bingo-scanner.styles.js";

/** Card aspect: the boards are a whisker taller than wide. */
const CARD_ASPECT = 1.03;
const SCAN_INTERVAL_MS = 700;
const POLL_MS = 5000;
/** Number reads per tick — the heavy half of a frame stays bounded. */
const READS_PER_TICK = 8;
const LETTERS = ["B", "I", "N", "G", "O"] as const;

@customElement("bingo-scanner")
export class BingoScanner extends LitElement {
  static override styles = scannerStyles;

  @state() private called: number[] = [];
  @state() private cameraError = false;
  @state() private scan: CardScan | null = null;
  @state() private result: CheckResult | null = null;
  @state() private numbers: (number | null)[] = Array.from({ length: 25 }, () => null);
  @state() private settled = 1; // FREE is always settled
  @state() private editing: number | null = null;

  @query("video") private videoEl?: HTMLVideoElement;
  @query(".guide") private guideEl?: HTMLElement;

  private fusion = new CardFusion();
  private stream: MediaStream | null = null;
  private scanTimer: number | null = null;
  private pollTimer: number | null = null;
  private polling = false;
  private pollInFlight = false;
  private calledAt: string | null = null;
  private workCanvas = document.createElement("canvas");
  private readCursor = 0;
  private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.polling = true;
    void this.pollLoop();
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.startCamera();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopCamera();
    this.polling = false;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stopCamera();
    else {
      void this.startCamera();
      // Catch up now rather than waiting out the timer: numbers were called
      // while the tab was away.
      void this.pollLoop();
    }
  };

  /** Continuous poll: one request in flight at a time, the next scheduled
   *  only after the last settles (a slow network can't stack requests).
   *  Calling it while a loop is already pending restarts it immediately. */
  private async pollLoop(): Promise<void> {
    if (!this.polling) return;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pollInFlight) return; // its completion reschedules
    this.pollInFlight = true;
    try {
      await this.poll();
    } finally {
      this.pollInFlight = false;
      if (this.polling) {
        this.pollTimer = window.setTimeout(() => void this.pollLoop(), POLL_MS);
      }
    }
  }

  private async poll(): Promise<void> {
    if (document.hidden) return;
    try {
      const { state } = await api.state();
      // Ignore an answer older than what we already show.
      if (this.calledAt && state.updatedAt && state.updatedAt < this.calledAt) return;
      this.calledAt = state.updatedAt ?? this.calledAt;
      const changed =
        state.markedNumbers.length !== this.called.length ||
        state.markedNumbers.some((n, i) => n !== this.called[i]);
      this.called = state.markedNumbers;
      if (changed) this.refreshVerdict();
    } catch {
      // Offline: keep the last-known called numbers; the next poll retries.
    }
  }

  // ── camera plumbing ──────────────────────────────────────────────────────

  private async startCamera(): Promise<void> {
    if (this.stream) return;
    this.cameraError = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      this.cameraError = true;
      return;
    }
    await this.updateComplete;
    const video = this.videoEl;
    if (!video) return;
    video.srcObject = this.stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusals surface as a black viewfinder; the photo path remains.
    }
    this.scanTimer = window.setInterval(() => this.tick(), SCAN_INTERVAL_MS);
  }

  private stopCamera(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  /** The guide rectangle, in viewfinder-container coordinates. Mirrors the
   *  .guide rule in bingo-scanner.styles.ts — change them together. */
  private guideRect(container: HTMLElement): { x: number; y: number; w: number; h: number } {
    const cw = container.clientWidth, ch = container.clientHeight;
    const w = cw * 0.92;
    const h = w * CARD_ASPECT;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  /** Pixels of the guide region, at up to the camera's native resolution. */
  private captureRegion(): Rgba | null {
    const video = this.videoEl, guide = this.guideEl;
    if (!video || !guide || video.videoWidth === 0) return null;
    const container = guide.parentElement;
    if (!container) return null;
    const rect = this.guideRect(container);
    // The video is object-fit: cover inside the container.
    const scale = Math.max(container.clientWidth / video.videoWidth, container.clientHeight / video.videoHeight);
    const offX = (container.clientWidth - video.videoWidth * scale) / 2;
    const offY = (container.clientHeight - video.videoHeight * scale) / 2;
    const sx = (rect.x - offX) / scale, sy = (rect.y - offY) / scale;
    const sw = rect.w / scale, sh = rect.h / scale;
    if (sw < 50 || sh < 50) return null;
    const canvas = this.workCanvas;
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // ── the reading loop ─────────────────────────────────────────────────────

  private tick(): void {
    if (document.hidden || this.busy) return;
    this.busy = true;
    try {
      const region = this.captureRegion();
      if (region) this.ingestFrame(region, READS_PER_TICK);
    } finally {
      this.busy = false;
    }
  }

  /** Feed one frame into the fusion: states for all cells, number reads for
   *  up to `readBudget` unsettled ones (covered cells first — they gate the
   *  verdict). A poorly aligned frame is discarded whole. */
  private ingestFrame(region: Rgba, readBudget: number): void {
    const scan = scanCard(region);
    this.scan = scan;
    if (scan.gridQuality < MIN_GRID_QUALITY) {
      this.refreshVerdict();
      return;
    }
    for (const cell of scan.cells) {
      this.fusion.addState(cell.row * 5 + cell.col, cell.state);
    }
    const pending = scan.cells
      .filter((c) => this.fusion.needsReading(c.row * 5 + c.col) && c.state !== "uncertain")
      .sort((a, b) => Number(b.state === "marked") - Number(a.state === "marked"));
    // Round-robin so a hard cell can't starve the rest.
    const start = this.readCursor % Math.max(1, pending.length);
    for (let k = 0; k < Math.min(readBudget, pending.length); k++) {
      const cell = pending[(start + k) % pending.length];
      if (!cell) continue;
      const reading = readCell(
        region,
        cell.cx,
        cell.cy,
        WIN_W,
        WIN_H,
        cell.state === "marked" ? "red" : "open",
        cell.col,
      );
      this.fusion.addReading(cell.row * 5 + cell.col, reading);
    }
    this.readCursor += readBudget;
    this.refreshVerdict();
  }

  private refreshVerdict(): void {
    this.numbers = this.fusion.numbers();
    this.settled = this.fusion.settledCount();
    this.result = checkCard(this.numbers, this.fusion.states(), this.called);
  }

  /** Photo fallback (no camera, or desktop): the file must show just the
   *  card — its edges are treated as the guide frame. */
  private async checkFromFile(file: File): Promise<void> {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = this.workCanvas;
      const scale = Math.min(1, 1600 / bitmap.width);
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const region = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // A photo is one shot: read every cell now, twice (the fusion lock
      // rule wants agreement, and both passes share the segmentations'
      // deterministic result, so a confident read settles immediately).
      this.ingestFrame(region, 24);
      this.ingestFrame(region, 24);
    } catch {
      // Unreadable file: leave the current state alone.
    }
  }

  private nextCard(): void {
    this.fusion.reset();
    this.editing = null;
    this.readCursor = 0;
    this.refreshVerdict();
  }

  // ── rendering ────────────────────────────────────────────────────────────

  /** Paint the whole screen with the verdict — green means bingo, red means
   *  checked-and-no — so a checker (and the table) reads it from feet away.
   *  Neutral while the card is still being aligned or read. */
  override updated(): void {
    const scan = this.scan, result = this.result;
    const aligned = scan !== null && scan.gridQuality >= MIN_GRID_QUALITY;
    const mode = aligned && result?.readable ? (result.lines.length > 0 ? "bingo" : "nobingo") : null;
    if (mode) this.setAttribute("data-verdict", mode);
    else this.removeAttribute("data-verdict");
  }

  override render(): TemplateResult {
    return html`
      <main class="scanview">
        ${this.renderViewfinder()}
        ${this.renderBanner()}
        ${this.renderGrid()}
        <div class="actions">
          <button class="secondary" @click=${this.nextCard}>${t("bingoScanNext")}</button>
          <label class="photo button-like">
            ${t("bingoScanPhoto")}
            <input
              type="file"
              accept="image/*"
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                input.value = "";
                if (file) void this.checkFromFile(file);
              }}
            />
          </label>
        </div>
      </main>
    `;
  }

  private renderViewfinder(): TemplateResult {
    return html`
      <div class="viewfinder">
        <video playsinline muted></video>
        <div class="guide" style="aspect-ratio: 1 / ${CARD_ASPECT}">${this.renderOverlay()}</div>
        ${this.cameraError ? html`<p class="camera-error">${t("bingoScanCamera")}</p>` : nothing}
      </div>
    `;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    const scan = this.scan, result = this.result;
    if (!scan || !result || scan.gridQuality < MIN_GRID_QUALITY) return nothing;
    return html`${scan.cells.map((cell) => {
      const verdict = result.verdicts[cell.row * 5 + cell.col] ?? "open";
      return html`<i class="dot ${verdict}" style="left:${cell.cx * 100}%;top:${cell.cy * 100}%"></i>`;
    })}`;
  }

  private renderBanner(): TemplateResult {
    const scan = this.scan, result = this.result;
    const aligned = scan !== null && scan.gridQuality >= MIN_GRID_QUALITY;
    if (!aligned) return html`<p class="banner hint">${t("bingoScanAlign")}</p>`;
    if (!result || !result.readable) {
      return html`<p class="banner hint">
        ${t("bingoScanReading", { done: this.settled, total: 25 })}
      </p>`;
    }
    if (result.lines.length > 0) return html`<p class="banner bingo">${t("bingoScanBingo")}</p>`;
    if (result.falseMarks.length > 0) {
      return html`<p class="banner bad">
        ${t("bingoScanFalseMarks", { nums: this.withLetters(result.falseMarks) })}
      </p>`;
    }
    return html`
      <p class="banner good">${t("bingoScanClean")}</p>
      ${result.missed.length > 0
        ? html`<p class="note">${t("bingoScanMissed", { nums: this.withLetters(result.missed) })}</p>`
        : nothing}
    `;
  }

  private withLetters(nums: number[]): string {
    return nums.map((n) => `${LETTERS[Math.floor((n - 1) / 15)] ?? ""}${n}`).join(", ");
  }

  private renderGrid(): TemplateResult {
    const result = this.result;
    return html`
      <div class="grid result">
        ${Array.from({ length: 25 }, (_, i) => {
          if (i === 12) return html`<span class="cell free">★</span>`;
          const verdict = result?.verdicts[i] ?? "uncertain";
          const value = this.numbers[i] ?? null;
          if (this.editing === i) {
            const col = i % 5;
            return html`<span class="cell input editing">
              <input
                type="text"
                inputmode="numeric"
                maxlength="2"
                placeholder="${col * 15 + 1}–${col * 15 + 15}"
                .value=${value === null ? "" : String(value)}
                @blur=${(e: Event) => this.commitEdit(i, (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </span>`;
          }
          return html`<button class="cell ${verdict}" @click=${() => this.openEdit(i)}>
            ${value === null ? "·" : value}
          </button>`;
        })}
      </div>
    `;
  }

  private openEdit(i: number): void {
    this.editing = i;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>(".editing input")?.focus();
    });
  }

  private commitEdit(i: number, raw: string): void {
    this.editing = null;
    const col = i % 5;
    const value = raw.trim() === "" ? null : Number(raw.trim());
    if (value === null) {
      this.fusion.pin(i, null); // back to automatic reading
    } else if (Number.isInteger(value) && value >= col * 15 + 1 && value <= col * 15 + 15) {
      this.fusion.pin(i, value);
    }
    this.refreshVerdict();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bingo-scanner": BingoScanner;
  }
}

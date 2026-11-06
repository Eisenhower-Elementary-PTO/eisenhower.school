// The card-check app (/scan): verify a physical Finger-Tip shutter card
// against the live board with the phone camera, at zero marginal cost — all
// vision runs in this tab (src/scan/vision.ts), the only network traffic is
// the same /bingo-public/state poll the spectator board makes.
//
// Two activities, one component:
//   register — once per physical card: photograph it with shutters open,
//     template-match the printed numbers (src/scan/digits.ts), review and fix
//     in a grid that shows each window's crop, save to localStorage.
//   scan — every game: live camera, a guide frame the player fills with the
//     card, continuous marked/open reading, and a verdict against the called
//     numbers: winning lines, covered-but-never-called, called-but-uncovered.

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, state, query } from "lit/decorators.js";
import { api } from "../lib/api.js";
import { t } from "../lib/i18n.js";
import { scanCard, WIN_W, WIN_H, MIN_GRID_QUALITY, type CardScan, type CellState, type Rgba } from "./vision.js";
import { readCellNumber } from "./digits.js";
import { cardStore, invalidCells, type SavedCard } from "./cards.js";
import { checkCard, type CheckResult } from "./check.js";
import scannerStyles from "./bingo-scanner.styles.js";

type View = "home" | "register" | "scan";

/** Card aspect: the boards are a whisker taller than wide. */
const CARD_ASPECT = 1.03;
const SCAN_INTERVAL_MS = 600;
const POLL_MS = 5000;
const LETTERS = ["B", "I", "N", "G", "O"] as const;

interface RegisterDraft {
  numbers: (number | null)[];
  confident: boolean[];
  thumbs: string[];
  markedAtCapture: number;
}

@customElement("bingo-scanner")
export class BingoScanner extends LitElement {
  static override styles = scannerStyles;

  @state() private view: View = "home";
  @state() private cards: SavedCard[] = [];
  @state() private activeCard: SavedCard | null = null;
  @state() private called: number[] = [];
  @state() private current: number | null = null;
  @state() private offline = false;
  @state() private cameraError = false;
  @state() private cameraOn = false;
  @state() private scan: CardScan | null = null;
  @state() private result: CheckResult | null = null;
  @state() private draft: RegisterDraft | null = null;
  @state() private draftName = "";
  @state() private draftInvalid: number[] = [];
  @state() private stillFrame: string | null = null;

  @query("video") private videoEl?: HTMLVideoElement;
  @query(".guide") private guideEl?: HTMLElement;

  private stream: MediaStream | null = null;
  private scanTimer: number | null = null;
  private pollTimer: number | null = null;
  private workCanvas = document.createElement("canvas");

  override connectedCallback(): void {
    super.connectedCallback();
    this.cards = cardStore.all();
    void this.poll();
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopCamera();
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stopCamera();
    else if (this.view !== "home" && !this.draft) void this.startCamera();
  };

  private async poll(): Promise<void> {
    if (document.hidden) return;
    try {
      const { state } = await api.state();
      this.called = state.markedNumbers;
      this.current = state.currentNumber;
      this.offline = false;
    } catch {
      this.offline = true;
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
    this.cameraOn = true;
    await this.updateComplete;
    const video = this.videoEl;
    if (!video) return;
    video.srcObject = this.stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusals surface as a black viewfinder; the photo path remains.
    }
    if (this.view === "scan") {
      this.scanTimer = window.setInterval(() => this.tick(), SCAN_INTERVAL_MS);
    }
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
    this.cameraOn = false;
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

  // ── scan mode ────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.activeCard || document.hidden) return;
    const region = this.captureRegion();
    if (!region) return;
    const scan = scanCard(region);
    this.scan = scan;
    if (scan.gridQuality >= MIN_GRID_QUALITY && scan.uncertain <= 2) {
      const states: CellState[] = scan.cells.map((c) => c.state);
      this.result = checkCard(this.activeCard.numbers, states, this.called);
    } else {
      this.result = null;
    }
  }

  private startScan(card: SavedCard): void {
    this.activeCard = card;
    this.view = "scan";
    this.scan = null;
    this.result = null;
    this.stillFrame = null;
    void this.startCamera();
  }

  /** Photo fallback (no camera, or desktop): the file must show just the
   *  card — its edges are treated as the guide. */
  private async checkFromFile(file: File): Promise<void> {
    const region = await this.fileToRgba(file);
    if (!region || !this.activeCard) return;
    const scan = scanCard(region);
    this.scan = scan;
    const states: CellState[] = scan.cells.map((c) => c.state);
    this.result =
      scan.gridQuality >= MIN_GRID_QUALITY ? checkCard(this.activeCard.numbers, states, this.called) : null;
  }

  private async fileToRgba(file: File): Promise<Rgba | null> {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = this.workCanvas;
      const scale = Math.min(1, 1600 / bitmap.width);
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }
  }

  // ── register mode ────────────────────────────────────────────────────────

  private startRegister(): void {
    this.view = "register";
    this.draft = null;
    this.draftName = "";
    this.draftInvalid = [];
    this.scan = null;
    this.stillFrame = null;
    void this.startCamera();
  }

  private captureForRegister(): void {
    const region = this.captureRegion();
    if (region) this.buildDraft(region);
  }

  private async registerFromFile(file: File): Promise<void> {
    const region = await this.fileToRgba(file);
    if (region) this.buildDraft(region);
  }

  private buildDraft(region: Rgba): void {
    const scan = scanCard(region);
    this.scan = scan;
    if (scan.gridQuality < MIN_GRID_QUALITY) return; // keep showing the align hint
    const numbers: (number | null)[] = [];
    const confident: boolean[] = [];
    const thumbs: string[] = [];
    let markedAtCapture = 0;
    for (const cell of scan.cells) {
      const i = cell.row * 5 + cell.col;
      thumbs.push(this.thumb(region, cell.cx, cell.cy));
      if (i === 12) {
        numbers.push(0);
        confident.push(true);
        continue;
      }
      if (cell.state === "marked") markedAtCapture++;
      const read = cell.state === "open" ? readCellNumber(region, cell.cx, cell.cy, WIN_W, WIN_H) : { text: "", confident: false };
      const value = read.text === "" ? null : Number(read.text);
      numbers.push(value);
      confident.push(read.confident && value !== null);
    }
    this.draft = { numbers, confident, thumbs, markedAtCapture };
    this.draftInvalid = [];
    this.stopCamera();
  }

  private thumb(region: Rgba, cx: number, cy: number): string {
    const w = WIN_W * region.width * 1.5, h = WIN_H * region.height * 1.5;
    const x = Math.max(0, cx * region.width - w / 2), y = Math.max(0, cy * region.height - h / 2);
    const src = document.createElement("canvas");
    src.width = region.width;
    src.height = region.height;
    src.getContext("2d")?.putImageData(new ImageData(region.data.slice(), region.width, region.height), 0, 0);
    const out = document.createElement("canvas");
    out.width = 96;
    out.height = Math.round((96 * h) / w);
    out.getContext("2d")?.drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.7);
  }

  private draftInput(i: number, raw: string): void {
    if (!this.draft) return;
    const numbers = [...this.draft.numbers];
    numbers[i] = raw === "" ? null : Number(raw);
    const confident = [...this.draft.confident];
    confident[i] = true; // touched by a human — no more highlight
    this.draft = { ...this.draft, numbers, confident };
  }

  private saveDraft(): void {
    if (!this.draft) return;
    const numbers = this.draft.numbers.map((n, i) => (i === 12 ? 0 : (n ?? -1)));
    const bad = invalidCells(numbers);
    const missing = numbers.flatMap((n, i) => (i !== 12 && n === -1 ? [i] : []));
    this.draftInvalid = [...new Set([...bad, ...missing])];
    if (this.draftInvalid.length > 0) return;
    const name = this.draftName.trim() || `Card ${this.cards.length + 1}`;
    cardStore.save(name, numbers);
    this.cards = cardStore.all();
    this.goHome();
  }

  private goHome(): void {
    this.stopCamera();
    this.view = "home";
    this.activeCard = null;
    this.scan = null;
    this.result = null;
    this.draft = null;
    this.stillFrame = null;
  }

  // ── rendering ────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    return html`
      <header>
        <button class="back" @click=${this.view === "home" ? this.openBoard : this.goHome} aria-label="back">
          ${this.view === "home" ? "▦" : "‹"}
        </button>
        <h1>${t("bingoScanTitle")}</h1>
        <span class="status ${this.offline ? "off" : ""}"
          >${this.offline ? t("bingoSyncError") : this.boardSummary()}</span
        >
      </header>
      ${this.view === "home" ? this.renderHome() : this.view === "scan" ? this.renderScan() : this.renderRegister()}
    `;
  }

  private openBoard = (): void => {
    window.location.href = "/";
  };

  private boardSummary(): string {
    const letter = this.current === null ? "" : `${LETTERS[Math.floor((this.current - 1) / 15)] ?? ""}${this.current} · `;
    return `${letter}${this.called.length}/75`;
  }

  private renderHome(): TemplateResult {
    return html`
      <main class="home">
        <p class="lead">${t("bingoScanLead")}</p>
        ${this.cards.length === 0 ? html`<p class="empty">${t("bingoScanNoCards")}</p>` : nothing}
        <ul class="cardlist">
          ${this.cards.map(
            (card) => html`
              <li>
                <button class="go" @click=${() => this.startScan(card)}>
                  <strong>${card.name}</strong>
                  <span>${t("bingoScanStart")}</span>
                </button>
                <button
                  class="del"
                  aria-label=${t("bingoCardDelete")}
                  @click=${() => {
                    cardStore.remove(card.id);
                    this.cards = cardStore.all();
                  }}
                >
                  ×
                </button>
              </li>
            `,
          )}
        </ul>
        <button class="primary" @click=${this.startRegister}>${t("bingoScanRegister")}</button>
      </main>
    `;
  }

  private renderViewfinder(ratio: string): TemplateResult {
    return html`
      <div class="viewfinder">
        <video playsinline muted></video>
        <div class="guide" style="aspect-ratio: ${ratio}">${this.renderOverlay()}</div>
        ${this.cameraError ? html`<p class="camera-error">${t("bingoScanCamera")}</p>` : nothing}
      </div>
    `;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    if (this.view === "scan") {
      if (!this.result || !this.scan) return nothing;
      const cells = this.scan.cells;
      return html`${cells.map((cell) => {
        const verdict = this.result?.verdicts[cell.row * 5 + cell.col] ?? "open";
        return html`<i class="dot ${verdict}" style="left:${cell.cx * 100}%;top:${cell.cy * 100}%"></i>`;
      })}`;
    }
    return nothing;
  }

  private renderScan(): TemplateResult {
    const scan = this.scan;
    const result = this.result;
    const aligned = scan !== null && scan.gridQuality >= MIN_GRID_QUALITY;
    const banner = !aligned
      ? { cls: "hint", text: t("bingoScanAlign") }
      : result === null
        ? { cls: "hint", text: t("bingoScanUnreadable") }
        : result.lines.length > 0
          ? { cls: "bingo", text: t("bingoScanBingo") }
          : result.falseMarks.length > 0
            ? { cls: "bad", text: t("bingoScanFalseMarks", { nums: this.withLetters(result.falseMarks) }) }
            : { cls: "good", text: t("bingoScanClean") };
    return html`
      <main class="scanview">
        ${this.renderViewfinder(`1 / ${CARD_ASPECT}`)}
        <p class="banner ${banner.cls}">${banner.text}</p>
        ${result && result.lines.length === 0 && result.missed.length > 0
          ? html`<p class="note">${t("bingoScanMissed", { nums: this.withLetters(result.missed) })}</p>`
          : nothing}
        ${result ? this.renderResultGrid(result) : nothing}
        <label class="photo">
          ${t("bingoScanPhoto")}
          <input
            type="file"
            accept="image/*"
            @change=${(e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) void this.checkFromFile(file);
            }}
          />
        </label>
      </main>
    `;
  }

  private withLetters(nums: number[]): string {
    return nums.map((n) => `${LETTERS[Math.floor((n - 1) / 15)] ?? ""}${n}`).join(", ");
  }

  private renderResultGrid(result: CheckResult): TemplateResult {
    const card = this.activeCard;
    if (!card) return html``;
    return html`
      <div class="grid result">
        ${result.verdicts.map((verdict, i) => {
          const label = i === 12 ? "★" : String(card.numbers[i] ?? "");
          return html`<span class="cell ${verdict}">${label}</span>`;
        })}
      </div>
    `;
  }

  private renderRegister(): TemplateResult {
    if (this.draft) return this.renderReview(this.draft);
    const scan = this.scan;
    const hint =
      scan !== null && scan.gridQuality < MIN_GRID_QUALITY ? t("bingoScanAlign") : t("bingoRegLead");
    return html`
      <main class="scanview">
        ${this.renderViewfinder(`1 / ${CARD_ASPECT}`)}
        <p class="banner hint">${hint}</p>
        <button class="primary" ?disabled=${!this.cameraOn} @click=${this.captureForRegister}>
          ${t("bingoRegCapture")}
        </button>
        <label class="photo">
          ${t("bingoRegPhoto")}
          <input
            type="file"
            accept="image/*"
            @change=${(e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) void this.registerFromFile(file);
            }}
          />
        </label>
      </main>
    `;
  }

  private renderReview(draft: RegisterDraft): TemplateResult {
    return html`
      <main class="review">
        <p class="lead">${t("bingoRegReviewLead")}</p>
        ${draft.markedAtCapture > 0 ? html`<p class="note">${t("bingoRegLead")}</p>` : nothing}
        <div class="grid edit">
          ${draft.numbers.map((value, i) => {
            if (i === 12) return html`<span class="cell free">★</span>`;
            const flagged = this.draftInvalid.includes(i) || !(draft.confident[i] ?? false);
            return html`
              <span class="cell input ${flagged ? "flag" : ""}">
                <img src=${draft.thumbs[i] ?? ""} alt="" />
                <input
                  type="text"
                  inputmode="numeric"
                  maxlength="2"
                  .value=${value === null ? "" : String(value)}
                  @input=${(e: Event) => this.draftInput(i, (e.target as HTMLInputElement).value)}
                />
              </span>
            `;
          })}
        </div>
        ${this.draftInvalid.length > 0 ? html`<p class="banner bad">${t("bingoRegInvalid")}</p>` : nothing}
        <label class="name">
          ${t("bingoRegNameLabel")}
          <input
            type="text"
            .value=${this.draftName}
            placeholder=${t("bingoRegNamePlaceholder")}
            @input=${(e: Event) => {
              this.draftName = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <div class="actions">
          <button class="secondary" @click=${this.startRegister}>${t("bingoRegRetake")}</button>
          <button class="primary" @click=${this.saveDraft}>${t("bingoRegSave")}</button>
        </div>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bingo-scanner": BingoScanner;
  }
}

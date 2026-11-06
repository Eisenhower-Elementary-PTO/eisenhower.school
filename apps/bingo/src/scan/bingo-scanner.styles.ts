import { css } from "lit";

// The scanner is a phone-first tool (the board is a projector surface; this
// is the thing in a parent's hand under cafeteria lighting), so unlike the
// board it follows the system theme. Same house red, same system fonts.
export const scannerStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #fff;
    color: #222;
    --red: #c00;
    --good: #1a7f37;
    --warn: #b35b00;
    --info: #0969da;
    --line: #ddd;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      background: #111;
      color: #eee;
      --line: #333;
    }
  }

  /* ── verdict wash: the whole screen answers, visible from feet away.
        Set via the data-verdict attribute (bingo-scanner.ts, updated()). ── */

  :host {
    transition: background-color 0.4s ease;
  }

  :host([data-verdict]) {
    color: #fff;
    --line: rgba(255, 255, 255, 0.45);
    --info: #fff;
    --warn: #ffd9a0;
  }

  :host([data-verdict="bingo"]) {
    background: #1a7f37;
  }

  :host([data-verdict="nobingo"]) {
    background: #b3001b;
  }

  :host([data-verdict]) header .status,
  :host([data-verdict]) .note {
    color: rgba(255, 255, 255, 0.88);
  }

  /* Banners sit on the wash: give them a white card so their own colors read. */
  :host([data-verdict="bingo"]) .banner.bingo {
    background: #fff;
    color: #1a7f37;
  }

  :host([data-verdict="nobingo"]) .banner.good,
  :host([data-verdict="nobingo"]) .banner.bad {
    background: rgba(255, 255, 255, 0.94);
  }

  :host([data-verdict]) .result .cell.good-mark,
  :host([data-verdict]) .result .cell.false-mark {
    border-color: rgba(255, 255, 255, 0.85);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75em;
    padding: 0.6em 0.9em;
    border-bottom: 1px solid var(--line);
  }

  header h1 {
    font-size: 1.1em;
    margin: 0;
    flex: 1;
  }

  header .back {
    font: inherit;
    font-size: 1.4em;
    line-height: 1;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0.1em 0.3em;
  }

  header .status {
    font-size: 0.85em;
    color: #777;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header .status.off {
    color: var(--warn);
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.8em;
    padding: 1em;
    width: 100%;
    max-width: 34em;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .note {
    margin: 0;
    line-height: 1.45;
    color: #666;
  }

  .hint-line {
    font-size: 0.85em;
    text-align: center;
  }

  @media (prefers-color-scheme: dark) {
    .note {
      color: #aaa;
    }
  }

  /* ── viewfinder ── */

  .viewfinder {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 3.4;
    background: #000;
    border-radius: 0.75em;
    overflow: hidden;
  }

  .viewfinder video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Must mirror guideRect() in bingo-scanner.ts: 92% of the container width,
     centered, aspect set inline — the capture crop uses the same numbers.
     The container's own aspect-ratio (3/3.4) guarantees the guide fits. */
  .guide {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 92%;
    border: 3px solid rgba(255, 255, 255, 0.9);
    border-radius: 4%;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
    box-sizing: border-box;
  }

  .dot {
    position: absolute;
    width: 1.1em;
    height: 1.1em;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid rgba(255, 255, 255, 0.8);
    box-sizing: border-box;
  }

  .dot.good-mark {
    background: var(--good);
  }
  .dot.false-mark {
    background: var(--red);
  }
  .dot.missed {
    background: var(--info);
  }
  .dot.uncertain {
    background: var(--warn);
  }
  .dot.open {
    background: rgba(255, 255, 255, 0.25);
  }
  .dot.free {
    background: #666;
  }

  .camera-error {
    position: absolute;
    inset: auto 0 0 0;
    margin: 0;
    padding: 0.8em;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    text-align: center;
    font-size: 0.9em;
  }

  /* ── banners ── */

  .banner {
    margin: 0;
    padding: 0.7em 1em;
    border-radius: 0.6em;
    font-weight: 700;
    text-align: center;
  }

  .banner.hint {
    background: rgba(128, 128, 128, 0.15);
    font-weight: 400;
  }

  .banner.good {
    background: rgba(26, 127, 55, 0.15);
    color: var(--good);
  }

  .banner.bad {
    background: rgba(204, 0, 0, 0.12);
    color: var(--red);
  }

  .banner.bingo {
    background: var(--red);
    color: white;
    font-size: 1.3em;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      transform: scale(1.03);
    }
  }

  /* ── the read grid ── */

  .grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.35em;
  }

  .grid .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: 0.5em;
    font: inherit;
    font-weight: 700;
    font-size: 1.05em;
    font-variant-numeric: tabular-nums;
    border: 2px solid var(--line);
    background: none;
    color: inherit;
    padding: 0;
    cursor: pointer;
  }

  .result .cell.good-mark {
    background: var(--good);
    border-color: var(--good);
    color: white;
  }

  .result .cell.false-mark {
    background: var(--red);
    border-color: var(--red);
    color: white;
  }

  .result .cell.missed {
    border-color: var(--info);
    color: var(--info);
  }

  .result .cell.uncertain {
    border-color: var(--warn);
    color: var(--warn);
    border-style: dashed;
  }

  .result .cell.free {
    background: rgba(128, 128, 128, 0.2);
    cursor: default;
  }

  .cell.editing {
    border-color: var(--info);
    padding: 0.2em;
  }

  .cell.editing input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-weight: 700;
    text-align: center;
    border: none;
    outline: none;
    background: none;
    color: inherit;
  }

  /* ── actions ── */

  .actions {
    display: flex;
    gap: 0.75em;
  }

  .actions > * {
    flex: 1;
  }

  button.secondary {
    font: inherit;
    font-weight: 700;
    padding: 0.85em 1.2em;
    border-radius: 0.75em;
    background: none;
    border: 2px solid var(--line);
    color: inherit;
    cursor: pointer;
  }

  label.photo {
    text-align: center;
    color: var(--info);
    cursor: pointer;
    font-size: 0.95em;
  }

  label.photo.button-like {
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    padding: 0.85em 1.2em;
    border: 2px solid var(--line);
    border-radius: 0.75em;
    box-sizing: border-box;
  }

  label.photo input {
    display: none;
  }
`;

export default scannerStyles;

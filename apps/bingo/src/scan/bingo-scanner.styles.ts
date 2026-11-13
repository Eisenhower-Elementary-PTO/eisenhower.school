import { css } from "lit";

// The scanner is a phone-first tool (the board is a projector surface; this
// is the thing in a parent's hand under cafeteria lighting), so unlike the
// board it follows the system theme. Same house red, same Gotham Rounded.
export const scannerStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    font-family:
      "Gotham Rounded A", "Gotham Rounded B",
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

  :host([data-verdict]) .result .cell.called {
    border-color: rgba(255, 255, 255, 0.85);
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    /* Home-screen standalone mode runs edge-to-edge: keep the content out
       of the notch and the home indicator (viewport-fit=cover). */
    padding: calc(1em + env(safe-area-inset-top, 0px)) calc(1em + env(safe-area-inset-right, 0px))
      calc(1em + env(safe-area-inset-bottom, 0px)) calc(1em + env(safe-area-inset-left, 0px));
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

  @media (prefers-color-scheme: dark) {
    .note {
      color: #aaa;
    }
  }

  /* ── viewfinder ── */

  .viewfinder {
    position: relative;
    width: 100%;
    /* Just taller than the guide (92% wide x 1.03 aspect = 0.95 of the width),
       so the whole screen — camera, status AND all five rows of numbers —
       fits a phone without scrolling. Any taller and the bottom row of the
       read grid fell below the fold. */
    aspect-ratio: 1 / 1;
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
     The container's own aspect-ratio (1/1) guarantees the guide fits. */
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

  .dot.called {
    background: var(--good);
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
    gap: 0.3em;
  }

  /* Wider than tall: five square rows were as tall as the camera view and
     pushed the bottom row off the screen. */
  .grid .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1.6;
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

  .result .cell.called {
    background: var(--good);
    border-color: var(--good);
    color: white;
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

  /* Short phones (SE-class, or a browser with chrome showing): flatten the
     cells further so the last row is still on screen. */
  @media (max-height: 740px) {
    main {
      gap: 0.4em;
      padding-top: calc(0.5em + env(safe-area-inset-top, 0px));
      padding-bottom: calc(0.5em + env(safe-area-inset-bottom, 0px));
    }
    .grid .cell {
      aspect-ratio: 2.2;
      font-size: 0.95em;
    }
  }

  /* ── status row: banner + square next-card button ── */

  .statusrow {
    display: flex;
    gap: 0.6em;
    align-items: stretch;
  }

  .statuscol {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    justify-content: center;
  }

  button.next {
    flex: none;
    width: 3.4em;
    aspect-ratio: 1;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 0.75em;
    background: none;
    border: 2px solid var(--line);
    color: inherit;
    cursor: pointer;
  }

  .spinner {
    width: 1.4em;
    height: 1.4em;
    border: 3px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export default scannerStyles;

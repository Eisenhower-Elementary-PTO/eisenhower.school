import { css } from "lit";

// Ported from Meandmybadself/bingo-board, two deliberate departures: system
// fonts instead of the Gotham Rounded cloud fonts (a font CDN is a third party
// /privacy would have to name), and the view-only / offline chrome added at
// the bottom. The board is dark in BOTH themes — it is a projector surface,
// like the newsletter composer's email preview — so its colours are literals.
export const boardStyles = css`
  div,
  li {
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }

  :host {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    font-family:
      "Gotham Rounded A", "Gotham Rounded B",
      -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  div.board {
    position: relative;
    display: grid;
    grid-template-columns: 2fr 5fr 2fr;
    background: #222;
    width: 100%;
    height: 100%;
    font-weight: 800;
    border-radius: 1em;
    min-height: 700px;
  }

  div.current {
    grid-column: 3 / 4;
    grid-row: 1 / 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    font-weight: 700;
    background: white;
    color: #222;
  }

  div.current > .letter {
    font-size: 5em;
    line-height: 0.9em;
    font-weight: 800;
  }

  div.current > .number {
    font-size: 3em;
    font-weight: 800;
  }

  *[role="button"] {
    cursor: pointer;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    height: 100%;
    grid-row: 1 / 6;
    display: flex;
    flex-direction: column;
  }

  ul li {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  ul.letters {
    grid-column: 1 / 2;
    background: white;
  }

  ul.letters li {
    color: red;
    font-size: 7em;
    font-weight: 800;
  }

  ul.numbers {
    grid-column: 2 / 3;
    color: white;
    padding: 0 1.25em;
  }

  ul.numbers li ul {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  ul.numbers li ul li.number {
    font-size: 2.5em;
    transition:
      background-color 0.3s ease-in-out,
      color 0.3s ease-in-out;
    font-weight: 500;
    border-radius: 50%;
    width: 2em;
    height: 2em;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #222;
    color: white;
  }

  ul.numbers li ul li.number.marked {
    color: red;
  }

  ul.numbers li ul li.number.last-clicked {
    background: red;
    color: #222;
  }

  /* Status chips — view-only (tap to sign in) and the offline note. Bottom of
     the letters column so they never sit over a number. */
  .chip {
    position: absolute;
    left: 50%;
    bottom: 0.75em;
    transform: translateX(-50%);
    max-width: 85%;
    box-sizing: border-box;
    font-size: 0.9em;
    font-weight: 700;
    padding: 0.5em 1em;
    border-radius: 2em;
    background: rgba(255, 255, 255, 0.92);
    color: #222;
    text-align: center;
  }

  .chip.offline {
    background: #c00;
    color: white;
  }
`;

export default boardStyles;

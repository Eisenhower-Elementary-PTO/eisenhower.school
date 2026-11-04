import { describe, it, expect } from "vitest";
import type { NewsletterNode } from "@sd/shared";
import { applyMeasuredWidths, columnPercents } from "./tableWidths.js";

const para = (text: string): NewsletterNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const cell = (
  type: "tableCell" | "tableHeader",
  text: string,
  attrs?: Record<string, unknown>,
): NewsletterNode => ({ type, attrs, content: [para(text)] });

const table = (...rows: NewsletterNode[]): NewsletterNode => ({ type: "table", content: rows });
const tr = (...cells: NewsletterNode[]): NewsletterNode => ({ type: "tableRow", content: cells });

describe("columnPercents", () => {
  it("normalizes measured pixels to percentages summing to ~100", () => {
    expect(columnPercents([300, 100])).toEqual([75, 25]);
    expect(columnPercents([200, 200, 200])).toEqual([33.3, 33.3, 33.3]);
  });

  it("clamps a sliver column to the sanitizer's 1% floor", () => {
    const out = columnPercents([1, 999])!;
    expect(out[0]).toBe(1);
  });

  it("refuses to divide by nothing", () => {
    expect(columnPercents([])).toBeNull();
    expect(columnPercents([0, 100])).toBeNull();
    expect(columnPercents([Number.NaN, 100])).toBeNull();
  });
});

describe("applyMeasuredWidths", () => {
  const doc = (...content: NewsletterNode[]): NewsletterNode => ({ type: "doc", content });

  it("writes measured percentages onto every row and strips colwidth", () => {
    const d = doc(
      table(
        tr(cell("tableHeader", "a", { colwidth: [300] }), cell("tableHeader", "b")),
        tr(cell("tableCell", "c"), cell("tableCell", "d", { colspan: 1 })),
      ),
    );
    const out = applyMeasuredWidths(d, [[75, 25]]);
    for (const row of out.content![0]!.content!) {
      expect(row.content![0]!.attrs).toMatchObject({ widthPct: 75 });
      expect(row.content![1]!.attrs).toMatchObject({ widthPct: 25 });
    }
    expect(JSON.stringify(out)).not.toContain("colwidth");
    // Untouched attrs ride along.
    expect(out.content![0]!.content![1]!.content![1]!.attrs).toMatchObject({ colspan: 1 });
  });

  it("passes stored widths through untouched when nothing was measured, still stripping colwidth", () => {
    const d = doc(
      table(tr(cell("tableCell", "a", { widthPct: 40, colwidth: [123] }), cell("tableCell", "b", { widthPct: 60 }))),
    );
    const out = applyMeasuredWidths(d, [null]);
    const cells = out.content![0]!.content![0]!.content!;
    expect(cells[0]!.attrs).toEqual({ widthPct: 40 });
    expect(cells[1]!.attrs).toEqual({ widthPct: 60 });
  });

  it("leaves a row whose cell count disagrees with the measurement alone", () => {
    // A colspan row has fewer cells than the table has columns; writing widths
    // onto it would be a guess.
    const d = doc(
      table(
        tr(cell("tableCell", "a"), cell("tableCell", "b")),
        tr(cell("tableCell", "span", { colspan: 2 })),
      ),
    );
    const out = applyMeasuredWidths(d, [[50, 50]]);
    expect(out.content![0]!.content![0]!.content![0]!.attrs).toMatchObject({ widthPct: 50 });
    expect(out.content![0]!.content![1]!.content![0]!.attrs).toEqual({ colspan: 2 });
  });

  it("keys tables to measurements in document pre-order, nested tables included", () => {
    const nested = table(tr(cell("tableCell", "inner")));
    const d = doc(
      table(tr({ type: "tableCell", content: [nested] })),
      table(tr(cell("tableCell", "second"))),
    );
    const out = applyMeasuredWidths(d, [[100], [42], null]);
    // Outer table's one column.
    expect(out.content![0]!.content![0]!.content![0]!.attrs).toMatchObject({ widthPct: 100 });
    // The nested table is the SECOND entry (pre-order), the sibling the third.
    const innerCell = out.content![0]!.content![0]!.content![0]!.content![0]!.content![0]!.content![0]!;
    expect(innerCell.attrs).toMatchObject({ widthPct: 42 });
    const secondCell = out.content![1]!.content![0]!.content![0]!;
    expect(secondCell.attrs).toEqual({});
  });
});

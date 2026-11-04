// Percentage-based table column widths.
//
// The drag handles are prosemirror-tables' own column resizing, which thinks
// in PIXELS (`colwidth` on each cell) — exactly the unit the document format
// refuses, because a pixel width authored on a wide screen is what breaks the
// 600px email. So pixels stay an editor-local affair: `normalizeTableWidths`
// runs at the save boundary (the Editor's onUpdate), and for any table where a
// drag has happened (some cell carries a colwidth) it measures the table's
// ACTUAL rendered columns and writes them into the outgoing JSON as `widthPct`
// — a percentage of the table — on every cell, while `colwidth` is stripped
// from every save unconditionally. What the author sees is what is stored, and
// a percentage means the same thing in the email, on the archive page and on
// paper. The renderer and sanitizer (@sd/shared newsletterRender.ts) hold the
// matching end: `widthPct` is validated on write and re-checked at render.
//
// The editor state itself keeps TipTap's pixel attrs untouched — converting in
// place would fight the resize plugin and pollute undo. A table nobody has
// dragged measures nothing and passes any stored `widthPct` through, so merely
// opening an issue never rewrites its widths.

import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NewsletterNode } from "@sd/shared";

/** Parse/serialize `widthPct` on a cell. The editor DOM renders it as a style
 *  width so the author sees stored percentages without any drag having
 *  happened; parsing also reads the width attribute, which is what the
 *  rendered archive page carries, so a copy-paste from a published issue keeps
 *  its columns. */
const widthPctAttribute = {
  widthPct: {
    default: null as number | null,
    parseHTML: (el: HTMLElement): number | null => {
      const raw = (el.style.width || el.getAttribute("width") || "").trim();
      const m = /^(\d+(?:\.\d+)?)%$/.exec(raw);
      if (!m) return null;
      const pct = Math.round(parseFloat(m[1]!) * 10) / 10;
      return pct >= 1 && pct <= 100 ? pct : null;
    },
    renderHTML: (attrs: Record<string, unknown>): Record<string, string> =>
      typeof attrs.widthPct === "number" ? { style: `width: ${attrs.widthPct}%` } : {},
  },
};

export const PctTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...widthPctAttribute };
  },
});

export const PctTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...widthPctAttribute };
  },
});

/** Measured pixel widths → percentages summing to ~100, one decimal place.
 *  Clamped to ≥1 so a sliver column still clears the sanitizer's floor instead
 *  of silently going flexible. Null when nothing useful was measured. */
export function columnPercents(widths: number[]): number[] | null {
  if (widths.length === 0 || widths.some((w) => !Number.isFinite(w) || w <= 0)) return null;
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map((w) => Math.max(1, Math.round((w / total) * 1000) / 10));
}

const isCellType = (t: string | undefined) => t === "tableCell" || t === "tableHeader";

/** Rewrite a getJSON() document: per table (in document pre-order, matching
 *  measureTableColumns), write the measured percentages onto every cell of
 *  every row whose cell count matches (a colspan row is left alone rather than
 *  guessed at), or pass existing widths through when the measurement is null —
 *  and strip the editor-local pixel `colwidth` from every cell regardless. */
export function applyMeasuredWidths(
  docNode: NewsletterNode,
  perTable: (number[] | null)[],
): NewsletterNode {
  let i = 0;
  const visit = (node: NewsletterNode): NewsletterNode => {
    if (node.type !== "table") {
      return node.content ? { ...node, content: node.content.map(visit) } : node;
    }
    const widths = perTable[i++] ?? null;
    const rows = (node.content ?? []).map((row) => {
      if (row.type !== "tableRow") return visit(row);
      const cells = row.content ?? [];
      const apply =
        widths != null &&
        cells.length === widths.length &&
        cells.every((c) => isCellType(c.type));
      return {
        ...row,
        content: cells.map((cell, k) => {
          if (!isCellType(cell.type)) return visit(cell);
          const { colwidth: _px, ...rest } = (cell.attrs ?? {}) as Record<string, unknown>;
          return {
            ...cell,
            attrs: apply ? { ...rest, widthPct: widths[k]! } : rest,
            // A cell can hold a nested table; keep walking so its count stays
            // in step with the measurement's traversal.
            content: cell.content ? cell.content.map(visit) : cell.content,
          };
        }),
      };
    });
    return { ...node, content: rows };
  };
  return visit(docNode);
}

/** True when any cell under this table was drag-resized (carries a px width). */
function tableHasPxWidths(table: PMNode): boolean {
  let has = false;
  table.descendants((n) => {
    if (has) return false;
    const cw = n.attrs.colwidth as unknown;
    if (isCellType(n.type.name) && Array.isArray(cw) && cw.some((v) => typeof v === "number" && v > 0)) {
      has = true;
      return false;
    }
    return true;
  });
  return has;
}

/** One entry per table in document order: the measured column percentages for
 *  tables a drag has touched, null (leave stored widths alone) for the rest. */
export function measureTableColumns(editor: Editor): (number[] | null)[] {
  const out: (number[] | null)[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    out.push(measureOne(editor, node, pos));
    return true; // a nested table gets its own entry, in pre-order
  });
  return out;
}

function measureOne(editor: Editor, node: PMNode, pos: number): number[] | null {
  if (!tableHasPxWidths(node)) return null;
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  // With resizing on, the node's DOM is prosemirror-tables' wrapper <div>.
  const table = dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
  const first = table?.rows[0];
  if (!table || !first || table.offsetWidth <= 0) return null;
  return columnPercents(Array.from(first.cells, (c) => c.offsetWidth));
}

/** The document as it leaves the editor: pixels converted to percentages. */
export function normalizeTableWidths(editor: Editor): NewsletterNode {
  return applyMeasuredWidths(editor.getJSON() as NewsletterNode, measureTableColumns(editor));
}

/** Toolbar "Auto widths": clear every width — percent and pixel alike — on the
 *  table around the selection, returning its columns to even/flexible. An
 *  explicit author action, so unlike the save-boundary conversion it goes
 *  through a real transaction and is undoable. */
export function clearColumnWidths(editor: Editor): void {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "table") continue;
    const tablePos = $from.before(d);
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const table = state.doc.nodeAt(tablePos);
        if (!table || table.type.name !== "table") return false;
        table.descendants((n, p) => {
          if (isCellType(n.type.name)) {
            tr.setNodeMarkup(tablePos + 1 + p, undefined, {
              ...n.attrs,
              colwidth: null,
              widthPct: null,
            });
          }
          return true;
        });
        return true;
      })
      .run();
    return;
  }
}

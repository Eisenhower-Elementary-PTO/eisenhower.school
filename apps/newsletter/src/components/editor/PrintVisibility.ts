// Per-block print visibility: "everywhere" (no attribute), "screen-only"
// (email + web page, but not paper) or "print-only" (paper alone).
//
// FontSize's pattern one level up: the stored value is a NAME from
// @sd/shared's fixed list, never CSS, and newsletterRender.ts is what turns it
// into markup (invariant 9). The eligible node types are the shared
// PRINT_VISIBILITY_BLOCKS set — the sanitizer drops the attribute from
// anything else, so offering it more widely here would lie to the author.
//
// Why it exists: the printed issue has a two-page budget and the digital one
// doesn't, so a photo spread marks itself screen-only and a "scan the code
// for the photos" line marks itself print-only (the printed page already
// carries a QR code to the live issue).

import { Extension } from "@tiptap/core";
import {
  isNewsletterPrintVisibility,
  PRINT_VISIBILITY_BLOCKS,
  type NewsletterPrintVisibility,
} from "@sd/shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    printVisibility: {
      /** Mark the selected top-level block(s), or clear with `null`. */
      setPrintVisibility: (v: NewsletterPrintVisibility | null) => ReturnType;
    };
  }
}

export const PrintVisibility = Extension.create({
  name: "printVisibility",

  addGlobalAttributes() {
    return [
      {
        types: [...PRINT_VISIBILITY_BLOCKS],
        attributes: {
          printVisibility: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute("data-print-visibility");
              return isNewsletterPrintVisibility(v) ? v : null;
            },
            // The data attribute is what the editor stylesheet hangs the
            // "Not printed" / "Print only" badges on.
            renderHTML: (attrs) =>
              isNewsletterPrintVisibility(attrs.printVisibility)
                ? { "data-print-visibility": attrs.printVisibility }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setPrintVisibility:
        (v) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let found = false;
          // Top-level blocks only: marking from inside a list item marks the
          // whole list, matching what the renderer wraps (half a hidden list
          // is not a thing the print page can mean).
          state.doc.nodesBetween(from, to, (node, pos, parent) => {
            if (parent?.type.name !== "doc") return true;
            if (!PRINT_VISIBILITY_BLOCKS.has(node.type.name)) return false;
            found = true;
            if ((node.attrs.printVisibility ?? null) !== v) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, printVisibility: v });
            }
            return false;
          });
          if (!found) return false;
          if (dispatch && tr.docChanged) dispatch(tr);
          return true;
        },
    };
  },
});

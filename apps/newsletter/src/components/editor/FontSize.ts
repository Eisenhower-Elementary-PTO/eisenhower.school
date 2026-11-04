// Text size as a mark whose only attribute is a NAME from a fixed list.
//
// TipTap's TextStyle + FontSize pair would store an arbitrary CSS value
// ("17.3px", "clamp(…)") on the node; this stores "small" | "large",
// which newsletterRender.ts turns into a style it writes itself (invariant 9).
// The list is NEWSLETTER_FONT_SIZES in @sd/shared, so the picker can't offer a
// size the renderer would drop. "Normal" is no mark at all.

import { Mark, mergeAttributes } from "@tiptap/core";
import { isNewsletterFontSize, NEWSLETTER_FONT_SIZES, type NewsletterFontSize } from "@sd/shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** Apply a size to the selection, or clear it with `null` (Normal). */
      setFontSize: (size: NewsletterFontSize | null) => ReturnType;
    };
  }
}

export const FontSize = Mark.create({
  name: "fontSize",

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-font-size");
          return isNewsletterFontSize(v) ? v : null;
        },
        renderHTML: (attrs) =>
          isNewsletterFontSize(attrs.size)
            ? { "data-font-size": attrs.size, style: `font-size:${NEWSLETTER_FONT_SIZES[attrs.size]}em` }
            : {},
      },
    };
  },

  parseHTML() {
    // Only our own spans: pasting from a web page must not import its sizes.
    return [{ tag: "span[data-font-size]", getAttrs: (el) => (isNewsletterFontSize(el.getAttribute("data-font-size")) ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ commands }) =>
          size ? commands.setMark(this.name, { size }) : commands.unsetMark(this.name),
    };
  },
});

// Floating images: an image may sit left or right with the text wrapping
// beside it. The document carries one attribute, `float` ("left" | "right",
// absent = the full-width block every image has always been); the sanitizer
// and renderer in @sd/shared newsletterRender.ts hold the matching end, where
// the email gets the align attribute (Outlook floats on that) and the archive
// page gets the nl-img-left/right classes, print included.
//
// The extension renders the same geometry inline in the editor DOM, so the
// author sees the real wrap while writing — the margins and the 48% cap match
// the renderer's, and drifting apart would make the draft lie about the issue.

import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";

export type ImageFloat = "left" | "right" | null;

export function imageFloatOf(raw: unknown): ImageFloat {
  return raw === "left" || raw === "right" ? raw : null;
}

export const FloatImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      float: {
        default: null as ImageFloat,
        parseHTML: (el: HTMLElement): ImageFloat =>
          imageFloatOf(el.style.float || el.getAttribute("align")),
        renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
          const float = imageFloatOf(attrs.float);
          if (!float) return {};
          const margin = float === "left" ? "4px 18px 10px 0" : "4px 0 10px 18px";
          return { style: `float:${float};max-width:48%;height:auto;margin:${margin}` };
        },
      },
    };
  },
});

/** Float the SELECTED image (the toolbar only offers this on a NodeSelection
 *  of one), or return it to the full-width block with null. Ordinary
 *  updateAttributes, so it lands in one undo step. */
export function setImageFloat(editor: Editor, float: ImageFloat): void {
  editor.chain().focus().updateAttributes("image", { float }).run();
}

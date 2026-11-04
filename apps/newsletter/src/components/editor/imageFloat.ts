// The image node's two authored attributes, beyond src/alt:
//
// `float` ("left" | "right", absent = the full-width block every image has
// always been) — the image sits to one side with the text wrapping beside it.
// `caption` (plain text, absent = none) — an explanatory line under the
// picture, usually naming who is in it.
//
// The sanitizer and renderer in @sd/shared newsletterRender.ts hold the
// matching end: the email gets the align attribute for a float (Outlook floats
// on that) and the archive page the nl-img-* classes, print included; a
// caption renders as an escaped text line under the image (a captioned float
// rides a one-cell layout table so the pair floats together).
//
// The editor shows both through ImageView.tsx — a node view whose wrapper
// carries the same float geometry (margins, the 48% cap) and draws the caption
// under the picture, so the author sees the real layout while writing;
// drifting apart would make the draft lie about the issue. The renderHTML
// forms below only serve copy/paste fidelity.

import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { ImageView } from "./ImageView.js";

export type ImageFloat = "left" | "right" | null;

export function imageFloatOf(raw: unknown): ImageFloat {
  return raw === "left" || raw === "right" ? raw : null;
}

export function imageCaptionOf(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
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
      caption: {
        default: null as string | null,
        parseHTML: (el: HTMLElement): string | null =>
          imageCaptionOf(el.getAttribute("data-caption")) || null,
        renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
          const caption = imageCaptionOf(attrs.caption);
          return caption ? { "data-caption": caption } : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

/** Float the SELECTED image (the toolbar only offers this on a NodeSelection
 *  of one), or return it to the full-width block with null. Ordinary
 *  updateAttributes, so it lands in one undo step. */
export function setImageFloat(editor: Editor, float: ImageFloat): void {
  editor.chain().focus().updateAttributes("image", { float }).run();
}

/** Caption the SELECTED image, prompt prefilled with what's there — the same
 *  window.prompt convention as linking.ts. Clearing the text removes the
 *  caption; Cancel changes nothing. */
export function captionImage(editor: Editor): void {
  const previous = imageCaptionOf(editor.getAttributes("image").caption);
  const caption = window.prompt("Caption — shown under the picture (e.g. who is in it)", previous);
  if (caption === null) return;
  editor.chain().focus().updateAttributes("image", { caption: caption.trim() || null }).run();
}

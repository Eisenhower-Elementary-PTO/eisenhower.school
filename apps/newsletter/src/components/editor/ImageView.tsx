// The image node's editor rendering: the picture plus, when one is set, its
// caption underneath — so the draft shows the caption where the issue puts it
// (newsletterRender.ts's image case) instead of hiding it in an attribute.
//
// A node view exists ONLY because of the caption: an <img> has nowhere to show
// a line of text, and the renderer's caption would otherwise be invisible while
// writing, which is exactly the draft-lies-about-the-issue drift Editor.tsx's
// header warns about. The float geometry therefore moves from the img's inline
// style (imageFloat.ts renderHTML, still emitted for copy/paste fidelity) onto
// this wrapper, mirroring how the renderer floats the caption's one-cell table.

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { imageFloatOf } from "./imageFloat.js";

export function ImageView({ node }: NodeViewProps) {
  const float = imageFloatOf(node.attrs.float);
  const caption = typeof node.attrs.caption === "string" ? node.attrs.caption.trim() : "";
  return (
    <NodeViewWrapper
      as="figure"
      className={`nlx-img${float ? ` nlx-img-${float}` : ""}`}
      // Dragging grips the picture (data-drag-handle below), never the caption.
    >
      <img src={String(node.attrs.src ?? "")} alt={String(node.attrs.alt ?? "")} data-drag-handle />
      {caption && <figcaption className="nlx-img-caption">{caption}</figcaption>}
    </NodeViewWrapper>
  );
}

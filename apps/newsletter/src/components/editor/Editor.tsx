// The authoring surface: TipTap with a deliberately small extension set.
//
// Every node and mark enabled here has a matching case in @sd/shared's
// newsletterRender.ts. That correspondence is the whole safety story — the
// renderer emits only what it recognizes, so an extension added here without a
// renderer case would silently drop content, and a formatting button the
// renderer can't express would lie to the author. Keep the two in step.
//
// Notably absent: code blocks, text colour and alignment. Not because they're
// hard, but because each one is another thing to get right across Gmail,
// Outlook and Apple Mail, and none of them earn that for a school newsletter.
// Tables cleared that bar (a lunch menu or a schedule is a table or it is
// nothing). Column resizing works in PERCENTAGES: the drag handles are
// pixel-based and stay editor-local; what leaves the editor is `widthPct`
// (tableWidths.ts), because a pixel width authored on a wide screen is what
// breaks a 600px email, while a percentage means the same thing there, on the
// archive page and in print.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { LINK_SHORTCUT_LABEL, LinkShortcut, linkSelection } from "./linking.js";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import {
  PctTableCell,
  PctTableHeader,
  clearColumnWidths,
  normalizeTableWidths,
} from "./tableWidths.js";
import { NodeSelection } from "@tiptap/pm/state";
import { isNewsletterFontSize, type NewsletterFontSize, type NewsletterNode } from "@sd/shared";
import { Icon, type IconName } from "../Icon.js";
import { EventsBlock } from "./EventsBlock.js";
import { FontSize } from "./FontSize.js";
import { ImageEditor } from "./ImageEditor.js";
import { api, errorMessage } from "../../lib/api.js";

/** What the image editor sheet is open on: a picked file, or an image already
 *  in the document (`replace` says which node, and what it held when opened). */
type ImageEdit = { source: Blob | string; type: string; replace?: { pos: number; src: string } };

/** The size picker's options, smallest first. "" is Normal — no mark. */
const SIZE_OPTIONS: { value: NewsletterFontSize | ""; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Huge" },
];

/** An uploaded image's type from its URL. /newsletter/media names every object
 *  `<ulid>.<ext>`, so the extension is reliable for anything that came from there. */
function typeOfUrl(src: string): string {
  const ext = /\.(\w+)(?:[?#].*)?$/.exec(src)?.[1]?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: IconName;
  label?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nlx-tool${active ? " on" : ""}`}
      title={label}
      aria-label={label}
      // Keep the selection: a toolbar button that steals focus would apply its
      // mark to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={16} stroke={2} /> : <span>{label}</span>}
    </button>
  );
}

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const fileInput = useRef<HTMLInputElement>(null);

  const setLink = useCallback(() => linkSelection(editor), [editor]);

  const [imageEdit, setImageEdit] = useState<ImageEdit | null>(null);

  // A GIF skips the editor and goes up as it is: a canvas holds one frame, so
  // cropping an animated one would quietly freeze it.
  const upload = useCallback(
    async (file: File) => {
      try {
        const { url } = await api.uploadMedia(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        window.alert(errorMessage(err, "That image couldn't be uploaded."));
      }
    },
    [editor],
  );

  const sel = editor.state.selection;
  const selectedImage =
    sel instanceof NodeSelection && sel.node.type.name === "image"
      ? { pos: sel.from, src: String(sel.node.attrs.src ?? "") }
      : null;
  const canEditSelected = !!selectedImage?.src && typeOfUrl(selectedImage.src) !== "image/gif";

  /** Upload the edited pixels, then put them where they belong. An edit of an
   *  existing image swaps that node's `src` — keeping its alt text — but only if
   *  the node at that position is still the one that was opened; if the document
   *  moved underneath the sheet, the result is inserted rather than overwriting
   *  whatever is there now. The old object stays in R2: an issue already sent
   *  may show it. */
  const saveEdited = useCallback(
    async (blob: Blob) => {
      if (!imageEdit) return;
      const { url } = await api.uploadMedia(new File([blob], "image", { type: blob.type }));
      const r = imageEdit.replace;
      const node = r ? editor.state.doc.nodeAt(r.pos) : null;
      if (r && node?.type.name === "image" && node.attrs.src === r.src) {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(r.pos, undefined, { ...node.attrs, src: url });
            return true;
          })
          .run();
      } else {
        editor.chain().focus().setImage({ src: url }).run();
      }
      setImageEdit(null);
    },
    [editor, imageEdit],
  );

  return (
    <div className="nlx-toolbar">
      <ToolButton label="H1" active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <ToolButton label="H2" active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <ToolButton label="H3" active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <span className="nlx-tool-sep" />
      <ToolButton label="B" active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolButton label="I" active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolButton label="S" active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()} />
      <select
        className="nlx-size"
        title="Text size"
        aria-label="Text size"
        value={(editor.getAttributes("fontSize").size as string | undefined) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          editor.chain().focus().setFontSize(isNewsletterFontSize(v) ? v : null).run();
        }}
      >
        {SIZE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="nlx-tool-sep" />
      <ToolButton icon="link" label={`Link (${LINK_SHORTCUT_LABEL})`} active={editor.isActive("link")} onClick={setLink} />
      <ToolButton label="• List" active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolButton label="1. List" active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolButton label="Quote" active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <ToolButton icon="minus" label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <span className="nlx-tool-sep" />
      <ToolButton icon="upload" label="Image" onClick={() => fileInput.current?.click()} />
      {canEditSelected && (
        <ToolButton icon="crop" label="Edit image"
          onClick={() => setImageEdit({ source: selectedImage!.src, type: typeOfUrl(selectedImage!.src), replace: selectedImage! })} />
      )}
      <ToolButton icon="table" label="Table"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        } />
      <ToolButton icon="calendar" label="Upcoming events"
        onClick={() => editor.chain().focus().insertEventsBlock().run()} />
      {editor.isActive("table") && (
        <>
          <span className="nlx-tool-sep" />
          <ToolButton label="+ Row" onClick={() => editor.chain().focus().addRowAfter().run()} />
          <ToolButton label="− Row" onClick={() => editor.chain().focus().deleteRow().run()} />
          <ToolButton label="+ Col" onClick={() => editor.chain().focus().addColumnAfter().run()} />
          <ToolButton label="− Col" onClick={() => editor.chain().focus().deleteColumn().run()} />
          <ToolButton label="Header" active={editor.isActive("tableHeader")}
            onClick={() => editor.chain().focus().toggleHeaderRow().run()} />
          <ToolButton label="Auto widths" onClick={() => clearColumnWidths(editor)} />
          <ToolButton icon="x" label="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()} />
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.type === "image/gif") void upload(file);
          else setImageEdit({ source: file, type: file.type });
        }}
      />
      {imageEdit && (
        <ImageEditor
          source={imageEdit.source}
          type={imageEdit.type}
          onSave={saveEdited}
          onClose={() => setImageEdit(null)}
        />
      )}
    </div>
  );
}

export function Editor({
  content,
  editable,
  accentColor,
  timeZone,
  calendarUrl,
  onChange,
  onReady,
}: {
  content: NewsletterNode;
  editable: boolean;
  /** The issue's accent, forwarded to the events block's email preview. */
  accentColor: string;
  /** The school's zone, so a block's fixed date range resolves the same way here
   *  as it will on the server at send time. */
  timeZone: string;
  /** Public calendar site, for the events block's "See all events" link. */
  calendarUrl: string;
  onChange: (doc: NewsletterNode) => void;
  /** Hands the caller the TipTap instance, for programmatic document swaps —
   *  applying or undoing an AI rewrite. Fires again if the editor is rebuilt
   *  (the deps below), so the caller should just keep the latest. */
  onReady?: (editor: TipTapEditor) => void;
}) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          // Disabled because newsletterRender.ts has no case for it; enabling a
          // node without adding its renderer case would drop content silently.
          codeBlock: false,
        }),
        Link.configure({ openOnClick: false, autolink: true }),
        LinkShortcut,
        Image,
        FontSize,
        // The drag handles store pixel colwidths, which never leave the editor:
        // onUpdate below converts them to percentages (see tableWidths.ts).
        Table.configure({ resizable: true, cellMinWidth: 48 }),
        TableRow,
        PctTableHeader,
        PctTableCell,
        Placeholder.configure({ placeholder: "Write the newsletter…" }),
        EventsBlock.configure({ accentColor, timeZone, calendarUrl }),
      ],
      content,
      onUpdate: ({ editor: e }) => onChange(normalizeTableWidths(e)),
    },
    // Only rebuild when the mode flips, or when something the events preview
    // draws with changes. Re-creating on every content change would reset the
    // cursor on each keystroke.
    [editable, accentColor, timeZone, calendarUrl],
  );

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  if (!editor) return <div className="nlx-editor-loading">Loading editor…</div>;

  return (
    <div className={`nlx-editor${editable ? "" : " ro"}`}>
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

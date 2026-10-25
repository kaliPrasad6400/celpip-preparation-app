import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Code, Columns3, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, Link2Off, List, ListChecks, ListOrdered,
  Quote, Redo2, Rows3, Strikethrough, Table2, Trash2, Underline as UnderlineIcon, Undo2, ArrowUpRight,
} from "lucide-react";
import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cx } from "../../lib/util";

/** Link extension that also keeps internal-link attributes (data-link-type / data-link-id). */
const AppLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-link-type": {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-link-type"),
        renderHTML: (attrs: Record<string, any>) => (attrs["data-link-type"] ? { "data-link-type": attrs["data-link-type"] } : {}),
      },
      "data-link-id": {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-link-id"),
        renderHTML: (attrs: Record<string, any>) => (attrs["data-link-id"] ? { "data-link-id": attrs["data-link-id"] } : {}),
      },
    };
  },
});

export function internalPath(kind: string, id: string | number) {
  const map: Record<string, string> = {
    note: `/notes/${id}`,
    template: `/templates/${id}`,
    vocabulary: `/vocabulary?item=${id}`,
    mistake: `/mistakes?item=${id}`,
    topic: `/canada/${id}`,
    attempt: `/attempts/${id}`,
    question: `/practice`,
  };
  return map[kind] ?? "/notes";
}

export function useNoteEditor(content: string, onChange: (html: string) => void) {
  return useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      AppLink.configure({ openOnClick: false, autolink: true, protocols: ["app"] }),
      Placeholder.configure({ placeholder: "Start writing… Use the toolbar for headings, lists, checklists and tables." }),
    ],
    content,
    editorProps: { attributes: { class: "prose-app focus:outline-none", "aria-label": "Note content" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
}

function TB({ onClick, active, label, children, disabled }: { onClick: () => void; active?: boolean; label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx("rounded-md p-1.5 text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-40", active && "bg-accent/12 text-accent")}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-border" aria-hidden />;

export function Toolbar({ editor, onInsertInternal }: { editor: Editor; onInsertInternal: () => void }) {
  const c = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  const setLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt("Link URL (https://…)", prev);
    if (url === null) return;
    if (url === "") c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url }).run();
  };
  const i = "h-4 w-4";
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
      <TB label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 className={i} /></TB>
      <TB label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 className={i} /></TB>
      <TB label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 className={i} /></TB>
      <Sep />
      <TB label="Bold" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><Bold className={i} /></TB>
      <TB label="Italic" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><Italic className={i} /></TB>
      <TB label="Underline" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><UnderlineIcon className={i} /></TB>
      <TB label="Strikethrough" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}><Strikethrough className={i} /></TB>
      <TB label="Highlight" active={editor.isActive("highlight")} onClick={() => c().toggleHighlight().run()}><Highlighter className={i} /></TB>
      <Sep />
      <TB label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}><List className={i} /></TB>
      <TB label="Numbered list" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}><ListOrdered className={i} /></TB>
      <TB label="Checklist" active={editor.isActive("taskList")} onClick={() => c().toggleTaskList().run()}><ListChecks className={i} /></TB>
      <TB label="Quote" active={editor.isActive("blockquote")} onClick={() => c().toggleBlockquote().run()}><Quote className={i} /></TB>
      <TB label="Code" active={editor.isActive("code")} onClick={() => c().toggleCode().run()}><Code className={i} /></TB>
      <Sep />
      <TB label="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className={i} /></TB>
      <TB label="Add row" disabled={!inTable} onClick={() => c().addRowAfter().run()}><Rows3 className={i} /></TB>
      <TB label="Add column" disabled={!inTable} onClick={() => c().addColumnAfter().run()}><Columns3 className={i} /></TB>
      <TB label="Delete table" disabled={!inTable} onClick={() => c().deleteTable().run()}><Trash2 className={i} /></TB>
      <Sep />
      <TB label="Set web link" active={editor.isActive("link") && !editor.getAttributes("link")["data-link-type"]} onClick={setLink}><Link2 className={i} /></TB>
      <TB label="Remove link" disabled={!editor.isActive("link")} onClick={() => c().extendMarkRange("link").unsetLink().run()}><Link2Off className={i} /></TB>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onInsertInternal}
        className="ml-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/10"
      >
        Insert link to…
      </button>
      <Sep />
      <TB label="Undo" disabled={!editor.can().undo()} onClick={() => c().undo().run()}><Undo2 className={i} /></TB>
      <TB label="Redo" disabled={!editor.can().redo()} onClick={() => c().redo().run()}><Redo2 className={i} /></TB>
    </div>
  );
}

/** Shows an "Open" affordance when the cursor sits inside a link. Cmd/Ctrl-click also follows links. */
export function LinkBar({ editor }: { editor: Editor }) {
  const nav = useNavigate();
  if (!editor.isActive("link")) return null;
  const attrs = editor.getAttributes("link");
  const kind = attrs["data-link-type"];
  const id = attrs["data-link-id"];
  return (
    <div className="flex items-center gap-2 rounded-md bg-subtle px-2 py-1 text-[12.5px]">
      <span className="text-muted">{kind ? `Internal link → ${kind} #${id}` : attrs.href}</span>
      <button
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        onClick={() => (kind ? nav(internalPath(kind, id)) : window.open(attrs.href, "_blank", "noopener,noreferrer"))}
      >
        Open <ArrowUpRight className="h-3 w-3" />
      </button>
    </div>
  );
}

export function EditorSurface({ editor }: { editor: Editor }) {
  const nav = useNavigate();
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!a || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const kind = a.getAttribute("data-link-type");
      const id = a.getAttribute("data-link-id");
      if (kind && id) nav(internalPath(kind, id));
      else if (a.href) window.open(a.href, "_blank", "noopener,noreferrer");
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor, nav]);
  return <EditorContent editor={editor} />;
}

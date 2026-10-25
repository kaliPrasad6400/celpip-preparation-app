import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, Download, FilePlus2, FileText, Folder, FolderPlus, NotebookPen, Pencil, Search, Star, Trash2, Upload, X,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EditorSurface, internalPath, LinkBar, Toolbar, useNoteEditor } from "../components/notes/NoteEditor";
import { downloadText, htmlToMarkdown, markdownToHtml, titleFromMarkdown } from "../components/notes/markdown";
import { Badge, Button, ConfirmModal, Empty, ErrorBox, Input, Label, Modal, Select, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { cx, fmtDateTime } from "../lib/util";

type NoteSummary = { id: number; title: string; folder_id: number | null; favorite: boolean; tags: string[]; updated_at: string; excerpt: string; icon?: string | null };
type FolderT = { id: number; name: string; parent_id: number | null; icon?: string | null };

// ------------------------------------------------------------------ sidebar
function NoteRow({ n, active, depth = 0 }: { n: NoteSummary; active: boolean; depth?: number }) {
  return (
    <Link
      to={`/notes/${n.id}`}
      className={cx("flex items-center gap-2 rounded-md px-2 py-1 text-[13px]", active ? "bg-accent/10 font-medium text-accent" : "text-fg/85 hover:bg-subtle")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="w-4 shrink-0 text-center text-[12px]">{n.icon || <FileText className="h-3.5 w-3.5 text-muted" />}</span>
      <span className="truncate">{n.title || "Untitled"}</span>
    </Link>
  );
}

function FolderNode({
  f, folders, notes, activeId, depth, onRename, onDelete, onNewNote,
}: {
  f: FolderT; folders: FolderT[]; notes: NoteSummary[]; activeId: number | null; depth: number;
  onRename: (f: FolderT) => void; onDelete: (f: FolderT) => void; onNewNote: (folderId: number) => void;
}) {
  const children = folders.filter((x) => x.parent_id === f.id);
  const own = notes.filter((n) => n.folder_id === f.id);
  const containsActive = own.some((n) => n.id === activeId);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-subtle" style={{ paddingLeft: 2 + depth * 14 }}>
        <button className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-[13px] font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />}
          <span className="w-4 shrink-0 text-center text-[12px]">{f.icon || <Folder className="h-3.5 w-3.5 text-muted" />}</span>
          <span className="truncate">{f.name}</span>
          <span className="ml-1 text-[11px] font-normal text-muted">{own.length}</span>
        </button>
        <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button className="rounded p-0.5 text-muted hover:text-fg" aria-label={`New note in ${f.name}`} title="New note here" onClick={() => onNewNote(f.id)}><FilePlus2 className="h-3.5 w-3.5" /></button>
          <button className="rounded p-0.5 text-muted hover:text-fg" aria-label={`Rename ${f.name}`} title="Rename" onClick={() => onRename(f)}><Pencil className="h-3.5 w-3.5" /></button>
          <button className="rounded p-0.5 text-muted hover:text-bad" aria-label={`Delete ${f.name}`} title="Delete folder" onClick={() => onDelete(f)}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {open && (
        <div>
          {children.map((c) => (
            <FolderNode key={c.id} f={c} folders={folders} notes={notes} activeId={activeId} depth={depth + 1} onRename={onRename} onDelete={onDelete} onNewNote={onNewNote} />
          ))}
          {own.map((n) => <NoteRow key={n.id} n={n} active={n.id === activeId} depth={depth + 1} />)}
          {!own.length && !children.length && <div className="py-0.5 text-[12px] text-muted" style={{ paddingLeft: 24 + depth * 14 }}>Empty</div>}
        </div>
      )}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{title}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ internal link picker
function InternalLinkModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: { kind: string; id: number; title: string }) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["link-lookup", q],
    queryFn: () => api.get<any[]>(`/api/links/lookup${qs({ q })}`),
    enabled: open,
  });
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Insert link to…">
      <div className="space-y-3">
        <Input autoFocus placeholder="Search notes, templates, vocabulary, mistakes, topics…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items to link" />
        <div className="max-h-80 overflow-y-auto">
          {isFetching && <p className="p-2 text-sm text-muted">Searching…</p>}
          {!isFetching && data?.length === 0 && <p className="p-2 text-sm text-muted">No matches.</p>}
          {data?.map((r) => (
            <button key={`${r.kind}-${r.id}`} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-subtle" onClick={() => onPick(r)}>
              <span className="rounded bg-subtle px-1.5 text-[11px] uppercase tracking-wide text-muted">{r.kind}</span>
              <span className="truncate">{r.title}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">Internal links create backlinks. Cmd/Ctrl-click a link in the editor to open it.</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ tags editor
function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  const add = () => {
    const t = v.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setV("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-[12px] text-muted">
          #{t}
          <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:text-bad"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !v && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder="Add tag…"
        aria-label="Add tag"
        className="w-24 bg-transparent text-[12px] outline-none placeholder:text-muted/70"
      />
    </div>
  );
}

// ------------------------------------------------------------------ note view
function NoteView({ note, folders }: { note: any; folders: FolderT[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState<string[]>(note.tags ?? []);
  const [html, setHtml] = useState(note.content_html ?? "");
  const [dirty, setDirty] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>(note.updated_at);
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const latest = useRef({ title, tags, html, dirty });
  latest.current = { title, tags, html, dirty };

  const editor = useNoteEditor(note.content_html ?? "", (h) => {
    setHtml(h);
    setDirty(true);
  });

  const save = useMutation({
    mutationFn: (body: any) => api.patch(`/api/notes/${note.id}`, body),
    onSuccess: (d) => {
      setUpdatedAt(d.updated_at);
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note", note.id] });
    },
  });

  useEffect(() => {
    if (!dirty) return;
    const id = window.setTimeout(() => {
      setDirty(false);
      save.mutate({ title: title || "Untitled", content_html: html, tags });
    }, 800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, tags, html, dirty]);

  // flush pending edits when leaving the note
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty) api.patch(`/api/notes/${note.id}`, { title: l.title || "Untitled", content_html: l.html, tags: l.tags }).then(() => qc.invalidateQueries({ queryKey: ["notes"] })).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const immediate = (body: any) => save.mutate(body);
  const del = useMutation({
    mutationFn: () => api.del(`/api/notes/${note.id}`),
    onSuccess: () => {
      latest.current.dirty = false;
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["notes"] });
      nav("/notes");
    },
  });

  const insertInternal = (r: { kind: string; id: number; title: string }) => {
    setLinkOpen(false);
    editor
      ?.chain()
      .focus()
      .insertContent([
        { type: "text", text: r.title, marks: [{ type: "link", attrs: { href: `app://${r.kind}/${r.id}`, "data-link-type": r.kind, "data-link-id": String(r.id), target: null } }] },
        { type: "text", text: " " },
      ])
      .run();
  };

  const status = save.isPending ? "Saving…" : dirty ? "Unsaved changes" : save.isError ? "Save failed" : `Saved · last edited ${fmtDateTime(updatedAt)}`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
          <span className={cx(save.isError && "text-bad")} aria-live="polite">{status}</span>
          <div className="flex items-center gap-1">
            <Select
              aria-label="Move to folder"
              value={note.folder_id ?? ""}
              onChange={(e) => (e.target.value ? immediate({ folder_id: Number(e.target.value) }) : immediate({ move_to_root: true }))}
              className="h-8 text-[12.5px]"
            >
              <option value="">No folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => immediate({ favorite: !note.favorite })} aria-pressed={note.favorite} title={note.favorite ? "Remove from favorites" : "Add to favorites"}>
              <Star className={cx("h-4 w-4", note.favorite && "fill-warn text-warn")} />
            </Button>
            <Button size="sm" variant="ghost" title="Export as Markdown" onClick={() => downloadText(`${(title || "note").replace(/[^\w\- ]+/g, "").trim() || "note"}.md`, htmlToMarkdown(title, editor?.getHTML() ?? html))}>
              <Download className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" title="Delete note" onClick={() => setConfirmDel(true)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
          placeholder="Untitled"
          aria-label="Note title"
          className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted/50"
        />
        <div className="mt-2"><TagsEditor tags={tags} onChange={(t) => { setTags(t); setDirty(true); }} /></div>
        {editor && (
          <div className="sticky top-0 z-10 -mx-1 mt-4 space-y-1.5 border-b border-border bg-bg/95 px-1 py-1.5 backdrop-blur">
            <Toolbar editor={editor} onInsertInternal={() => setLinkOpen(true)} />
            <LinkBar editor={editor} />
          </div>
        )}
        <div className="mt-4">{editor ? <EditorSurface editor={editor} /> : <Spinner />}</div>
        {save.error && <div className="mt-3"><ErrorBox error={save.error} /></div>}
      </div>
      <aside className="space-y-5 text-[13px]">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Backlinks</div>
          {note.backlinks?.length ? (
            <ul className="space-y-1">
              {note.backlinks.map((b: any) => (
                <li key={`${b.kind}-${b.id}`}>
                  <Link to={internalPath(b.kind, b.id)} className="flex items-center gap-1.5 hover:text-accent">
                    <Badge>{b.kind}</Badge><span className="truncate">{b.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">No pages link here yet.</p>}
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Links from this page</div>
          {note.outgoing?.length ? (
            <ul className="space-y-1">
              {note.outgoing.map((b: any) => (
                <li key={`${b.kind}-${b.id}`}>
                  <Link to={internalPath(b.kind, b.id)} className={cx("flex items-center gap-1.5 hover:text-accent", b.missing && "text-muted line-through")}>
                    <Badge>{b.kind}</Badge><span className="truncate">{b.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">Use “Insert link to…” to connect templates, vocabulary, mistakes or other notes.</p>}
        </div>
        <p className="text-[12px] text-muted">Created {fmtDateTime(note.created_at)}. Notes are stored locally and work offline.</p>
      </aside>
      <InternalLinkModal open={linkOpen} onClose={() => setLinkOpen(false)} onPick={insertInternal} />
      <ConfirmModal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        title="Delete note?"
        message={<>“{title || "Untitled"}” will be permanently deleted. Consider exporting it as Markdown first.</>}
        confirmText="Delete note"
      />
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function NotesPage() {
  const { id } = useParams();
  const activeId = id ? Number(id) : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState("");
  const [folderModal, setFolderModal] = useState<{ mode: "new" | "rename"; folder?: FolderT } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParent, setFolderParent] = useState("");
  const [delFolder, setDelFolder] = useState<FolderT | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErr, setImportErr] = useState<unknown>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data: folders = [] } = useQuery({ queryKey: ["note-folders"], queryFn: () => api.get<FolderT[]>("/api/note-folders") });
  const { data: allNotes = [], isLoading } = useQuery({ queryKey: ["notes", "all"], queryFn: () => api.get<NoteSummary[]>("/api/notes") });
  const filtering = !!debouncedQ || !!tag;
  const { data: filtered = [], isFetching: searching } = useQuery({
    queryKey: ["notes", "filter", debouncedQ, tag],
    queryFn: () => api.get<NoteSummary[]>(`/api/notes${qs({ q: debouncedQ, tag })}`),
    enabled: filtering,
  });
  const { data: note, error: noteError, isLoading: noteLoading } = useQuery({
    queryKey: ["note", activeId],
    queryFn: () => api.get(`/api/notes/${activeId}`),
    enabled: !!activeId,
  });

  const allTags = useMemo(() => Array.from(new Set(allNotes.flatMap((n) => n.tags ?? []))).sort(), [allNotes]);
  const currentFolder = note?.folder_id ?? null;

  const createNote = useMutation({
    mutationFn: (body: any) => api.post("/api/notes", body),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      nav(`/notes/${n.id}`);
    },
  });
  const saveFolder = useMutation({
    mutationFn: () =>
      folderModal?.mode === "rename" && folderModal.folder
        ? api.patch(`/api/note-folders/${folderModal.folder.id}`, { name: folderName.trim(), icon: folderModal.folder.icon ?? null, parent_id: folderModal.folder.parent_id })
        : api.post("/api/note-folders", { name: folderName.trim(), parent_id: folderParent ? Number(folderParent) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["note-folders"] });
      setFolderModal(null);
    },
  });
  const removeFolder = useMutation({
    mutationFn: (f: FolderT) => api.del(`/api/note-folders/${f.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["note-folders"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setDelFolder(null);
    },
  });

  const importMd = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportErr(null);
    try {
      let last: any = null;
      for (const file of Array.from(files)) {
        const md = await file.text();
        const title = titleFromMarkdown(md, file.name.replace(/\.(md|markdown|txt)$/i, ""));
        const body = md.replace(/^#\s+.+\n?/, "");
        last = await api.post("/api/notes", { title, content_html: markdownToHtml(body), folder_id: currentFolder, tags: ["imported"] });
      }
      qc.invalidateQueries({ queryKey: ["notes"] });
      if (last) nav(`/notes/${last.id}`);
    } catch (e) {
      setImportErr(e);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const roots = folders.filter((f) => f.parent_id === null || !folders.some((x) => x.id === f.parent_id));
  const favorites = allNotes.filter((n) => n.favorite);
  const unfiled = allNotes.filter((n) => n.folder_id === null || !folders.some((f) => f.id === n.folder_id));

  return (
    <div className="-my-2">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><NotebookPen className="h-6 w-6 text-accent" />Notes Workspace</h1>
          <p className="mt-1 text-sm text-muted">Your personal knowledge base — strategies, expressions, examples and links to templates, vocabulary and mistakes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown" multiple className="hidden" onChange={(e) => importMd(e.target.files)} aria-label="Import Markdown files" />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Import Markdown</Button>
          <Button variant="outline" size="sm" onClick={() => { setFolderName(""); setFolderParent(""); setFolderModal({ mode: "new" }); }}><FolderPlus className="h-4 w-4" />New folder</Button>
          <Button variant="primary" size="sm" loading={createNote.isPending} onClick={() => createNote.mutate({ title: "Untitled", folder_id: currentFolder })}>
            <FilePlus2 className="h-4 w-4" />New note
          </Button>
        </div>
      </div>
      {importErr ? <div className="mb-3"><ErrorBox error={importErr} /></div> : null}
      {createNote.error && <div className="mb-3"><ErrorBox error={createNote.error} /></div>}

      <div className="grid gap-6 md:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="md:sticky md:top-0 md:max-h-[calc(100vh-9rem)] md:overflow-y-auto">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <Input className="pl-8" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
          </div>
          {allTags.length > 0 && (
            <Select className="mt-2 w-full" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </Select>
          )}
          {isLoading && <Spinner />}
          {filtering ? (
            <SidebarSection title={searching ? "Searching…" : `Results (${filtered.length})`}>
              {filtered.map((n) => (
                <Link key={n.id} to={`/notes/${n.id}`} className={cx("block rounded-md px-2 py-1.5 hover:bg-subtle", n.id === activeId && "bg-accent/10")}>
                  <div className="truncate text-[13px] font-medium">{n.title}</div>
                  {n.excerpt && <div className="line-clamp-2 text-[12px] text-muted">{n.excerpt}</div>}
                </Link>
              ))}
              {!searching && !filtered.length && <p className="px-2 text-[12.5px] text-muted">No matching notes.</p>}
            </SidebarSection>
          ) : (
            <>
              {favorites.length > 0 && (
                <SidebarSection title="Favorites">
                  {favorites.map((n) => <NoteRow key={n.id} n={n} active={n.id === activeId} />)}
                </SidebarSection>
              )}
              <SidebarSection title="Folders">
                {roots.map((f) => (
                  <FolderNode
                    key={f.id}
                    f={f}
                    folders={folders}
                    notes={allNotes}
                    activeId={activeId}
                    depth={0}
                    onRename={(fo) => { setFolderName(fo.name); setFolderModal({ mode: "rename", folder: fo }); }}
                    onDelete={setDelFolder}
                    onNewNote={(fid) => createNote.mutate({ title: "Untitled", folder_id: fid })}
                  />
                ))}
                {!folders.length && <p className="px-2 text-[12.5px] text-muted">No folders yet.</p>}
              </SidebarSection>
              {unfiled.length > 0 && (
                <SidebarSection title="Unfiled">
                  {unfiled.map((n) => <NoteRow key={n.id} n={n} active={n.id === activeId} />)}
                </SidebarSection>
              )}
            </>
          )}
        </aside>

        <section className="min-w-0">
          {!activeId && (
            <Empty
              icon={<NotebookPen className="h-8 w-8" />}
              title={allNotes.length ? "Select a page" : "No notes yet"}
              action={<Button variant="primary" onClick={() => createNote.mutate({ title: "Untitled", folder_id: null })}><FilePlus2 className="h-4 w-4" />Create a page</Button>}
            >
              Pick a page from the sidebar, create a new one, or import Markdown files. Everything is saved automatically on this computer.
            </Empty>
          )}
          {activeId && noteLoading && <Spinner />}
          {activeId && noteError && <ErrorBox error={noteError} />}
          {activeId && note && <NoteView key={note.id} note={note} folders={folders} />}
        </section>
      </div>

      <Modal open={!!folderModal} onClose={() => setFolderModal(null)} title={folderModal?.mode === "rename" ? "Rename folder" : "New folder"}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (folderName.trim()) saveFolder.mutate();
          }}
        >
          <div><Label>Name</Label><Input autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} /></div>
          {folderModal?.mode === "new" && folders.length > 0 && (
            <div>
              <Label hint="optional">Inside folder</Label>
              <Select className="w-full" value={folderParent} onChange={(e) => setFolderParent(e.target.value)}>
                <option value="">Top level</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </div>
          )}
          {saveFolder.error && <ErrorBox error={saveFolder.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setFolderModal(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saveFolder.isPending} disabled={!folderName.trim()}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!delFolder}
        onClose={() => setDelFolder(null)}
        onConfirm={() => delFolder && removeFolder.mutate(delFolder)}
        loading={removeFolder.isPending}
        title="Delete folder?"
        message={<>The folder “{delFolder?.name}” and its sub-folders will be deleted. Notes inside are kept and moved to <strong>Unfiled</strong>.</>}
        confirmText="Delete folder"
      />
    </div>
  );
}

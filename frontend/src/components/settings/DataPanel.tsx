import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, HardDriveDownload, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/util";
import { Button, Card, CardBody, CardHeader, ConfirmModal, ErrorBox, Notice } from "../ui";

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataPanel() {
  const qc = useQueryClient();
  const { data: diag } = useQuery({ queryKey: ["diagnostics"], queryFn: () => api.get("/api/diagnostics") });
  const { data: backups, error: bErr } = useQuery({ queryKey: ["backups"], queryFn: () => api.get<any[]>("/api/data/backups") });
  const { data: exports } = useQuery({ queryKey: ["exports"], queryFn: () => api.get<string[]>("/api/data/exports") });
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [delName, setDelName] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const afterRestore = (safety: string, what: string) => {
    setMsg(`${what} A safety backup of the previous database was saved as ${safety}. Reloading…`);
    qc.clear();
    window.setTimeout(() => window.location.reload(), 1500);
  };
  const create = useMutation({
    mutationFn: () => api.post("/api/data/backups"),
    onSuccess: (d) => { setMsg(`Backup created: ${d.name}`); qc.invalidateQueries({ queryKey: ["backups"] }); },
  });
  const del = useMutation({
    mutationFn: (name: string) => api.del(`/api/data/backups/${encodeURIComponent(name)}`),
    onSuccess: () => { setDelName(null); qc.invalidateQueries({ queryKey: ["backups"] }); },
  });
  const restore = useMutation({
    mutationFn: (name: string) => api.post("/api/data/restore", { name, confirm: "RESTORE" }),
    onSuccess: (d) => { setRestoreName(null); afterRestore(d.safety_backup, "Database restored."); },
  });
  const restoreUpload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api.form("/api/data/restore-upload?confirm=RESTORE", fd);
    },
    onSuccess: (d) => { setUploadFile(null); afterRestore(d.safety_backup, "Database restored from file."); },
  });
  const clear = useMutation({
    mutationFn: () => api.post("/api/data/clear", { confirm: "DELETE ALL MY DATA" }),
    onSuccess: (d) => { setClearOpen(false); afterRestore(d.safety_backup, "All local data cleared and starter content re-seeded."); },
  });

  return (
    <div className="space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Database className="h-4 w-4" />Database & diagnostics</span>} />
        <CardBody>
          {diag ? (
            <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
              {[
                ["Database location", <code key="p" className="break-all rounded bg-subtle px-1">{diag.database_path}</code>],
                ["Database size", bytes(diag.database_size_bytes)],
                ["Data folder", <code key="d" className="break-all rounded bg-subtle px-1">{diag.data_dir}</code>],
                ["Migration revision", diag.migration_revision],
                ["Practice attempts", diag.attempts],
                ["Audio recordings", `${diag.audio_files} (${bytes(diag.audio_bytes)})`],
                ["App version", diag.app_version],
                ["Python / SQLite", `${diag.python} / ${diag.sqlite}`],
                ["Platform", diag.platform],
                ["Secrets file", <span key="e"><code className="break-all rounded bg-subtle px-1">{diag.env_file}</code> {diag.env_file_exists ? "(present)" : "(not created)"}</span>],
              ].map(([k, v], i) => (
                <div key={i} className="flex flex-col"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          ) : <p className="text-[13px] text-muted">Loading…</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><HardDriveDownload className="h-4 w-4" />Backups</span>}
          subtitle="Consistent SQLite snapshots stored in data/backups. Restoring always saves a safety backup first."
          action={<Button size="sm" variant="primary" onClick={() => create.mutate()} loading={create.isPending}>Create backup</Button>}
        />
        <CardBody className="space-y-3">
          {bErr && <ErrorBox error={bErr} />}
          {backups?.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {backups.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{b.name}</span>
                  <span className="text-muted">{fmtDateTime(b.created_at)} · {bytes(b.size_bytes)}</span>
                  <a className="rounded p-1 text-muted hover:bg-subtle hover:text-fg" href={`/api/data/backups/${encodeURIComponent(b.name)}`} aria-label={`Download ${b.name}`}><Download className="h-3.5 w-3.5" /></a>
                  <Button size="sm" variant="ghost" onClick={() => setRestoreName(b.name)}><RotateCcw className="h-3.5 w-3.5" />Restore</Button>
                  <button className="rounded p-1 text-muted hover:bg-subtle hover:text-bad" onClick={() => setDelName(b.name)} aria-label={`Delete ${b.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-muted">No backups yet.</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input ref={fileRef} type="file" accept=".db,.sqlite,application/x-sqlite3" className="sr-only" id="restore-file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" />Restore from a backup file…</Button>
            <span className="text-[12px] text-muted">The file is validated before anything is replaced.</span>
          </div>
          {(restore.error || restoreUpload.error || del.error || create.error) && <ErrorBox error={restore.error || restoreUpload.error || del.error || create.error} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Export my data" subtitle="Download your notes, vocabulary, attempts, evaluations and more. Nothing is uploaded anywhere." />
        <CardBody className="space-y-2">
          <a href="/api/data/export.json" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-subtle"><Download className="h-3.5 w-3.5" />Everything (JSON)</a>
          <div className="flex flex-wrap gap-1.5">
            {(exports ?? []).map((n) => (
              <a key={n} href={`/api/data/export/${n}.csv`} className="rounded-md bg-subtle px-2 py-1 text-[12px] hover:text-accent">{n}.csv</a>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="border-bad/40">
        <CardHeader title="Clear all local data" subtitle="Deletes the database and all recordings, then re-creates the starter content. A safety backup is made first." />
        <CardBody>
          <Button variant="danger" onClick={() => setClearOpen(true)}><Trash2 className="h-4 w-4" />Clear all local data…</Button>
          {clear.error && <div className="mt-2"><ErrorBox error={clear.error} /></div>}
        </CardBody>
      </Card>

      <ConfirmModal
        open={!!restoreName}
        onClose={() => setRestoreName(null)}
        onConfirm={() => restoreName && restore.mutate(restoreName)}
        loading={restore.isPending}
        title="Restore this backup?"
        message={<>Your current database will be replaced by <code>{restoreName}</code>. A safety backup of the current data is created first, so this can be undone.</>}
        confirmText="Restore"
        typeToConfirm="RESTORE"
      />
      <ConfirmModal
        open={!!uploadFile}
        onClose={() => { setUploadFile(null); if (fileRef.current) fileRef.current.value = ""; }}
        onConfirm={() => uploadFile && restoreUpload.mutate(uploadFile)}
        loading={restoreUpload.isPending}
        title="Restore from uploaded file?"
        message={<>Replace your current database with <strong>{uploadFile?.name}</strong>? A safety backup is created first.</>}
        confirmText="Restore"
        typeToConfirm="RESTORE"
      />
      <ConfirmModal
        open={!!delName}
        onClose={() => setDelName(null)}
        onConfirm={() => delName && del.mutate(delName)}
        loading={del.isPending}
        title="Delete backup?"
        message={<>Permanently delete <code>{delName}</code>?</>}
        confirmText="Delete"
      />
      <ConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => clear.mutate()}
        loading={clear.isPending}
        title="Delete ALL local data?"
        message="All notes, vocabulary, attempts, evaluations, mistakes, plans and recordings will be deleted from this computer. A safety backup is saved in data/backups first. Your API keys are not affected."
        confirmText="Delete everything"
        typeToConfirm="DELETE ALL MY DATA"
      />
    </div>
  );
}

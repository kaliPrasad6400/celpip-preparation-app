import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { internalPath } from "../components/notes/NoteEditor";
import { useFormat } from "../components/QuestionPicker";
import {
  Badge, Button, Card, CardBody, ConfirmModal, Empty, ErrorBox, Input, Label, Modal, PageHeader, Select, SkillBadge, Spinner, Textarea,
} from "../components/ui";
import { api, qs } from "../lib/api";
import { CATEGORY_LABEL, cx, fmtDate, fmtDateTime, practiceLink, SKILLS, SKILL_LABEL } from "../lib/util";

const STATUS_TONE: Record<string, "bad" | "warn" | "good"> = { open: "bad", improving: "warn", resolved: "good" };
const SEVERITY = ["", "Low impact", "Medium impact", "High impact"];

function MistakeDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: m, isLoading, error } = useQuery({ queryKey: ["mistakes", "item", id], queryFn: () => api.get(`/api/mistakes/${id}`), enabled: !!id });
  const [confirm, setConfirm] = useState(false);
  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/api/mistakes/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mistakes"] }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/mistakes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mistakes"] }); setConfirm(false); onClose(); },
  });
  const practiceSkill = m && (SKILLS as string[]).includes(m.skill) ? m.skill : "writing";
  return (
    <Modal open={!!id} onClose={onClose} title={m?.pattern ?? "Mistake"} wide>
      {isLoading && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {m && (
        <div className="space-y-4 text-[14px]">
          <div className="flex flex-wrap items-center gap-2">
            {(SKILLS as string[]).includes(m.skill) ? <SkillBadge skill={m.skill} /> : <Badge>{SKILL_LABEL[m.skill] ?? m.skill}</Badge>}
            <Badge>{CATEGORY_LABEL(m.category)}</Badge>
            <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
            <span className="text-[12.5px] text-muted">
              {m.occurrence_count}× · first seen {fmtDate(m.first_seen_at)} · last seen {fmtDate(m.last_seen_at)} · {m.clean_checks} clean check{m.clean_checks === 1 ? "" : "s"} in a row
            </span>
          </div>
          {(m.original_example || m.corrected_example) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-bad/25 bg-bad/5 p-3">
                <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Original</div>
                <p className="font-serif">{m.original_example || "—"}</p>
              </div>
              <div className="rounded-lg border border-good/25 bg-good/5 p-3">
                <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Corrected</div>
                <p className="font-serif">{m.corrected_example || "—"}</p>
              </div>
            </div>
          )}
          {m.explanation && <div><div className="text-[12px] font-semibold uppercase text-muted">Explanation</div><p>{m.explanation}</p></div>}
          {m.recommended_exercise && (
            <div className="rounded-lg bg-accent/6 p-3">
              <div className="text-[12px] font-semibold uppercase text-muted">Recommended exercise</div>
              <p>{m.recommended_exercise}</p>
            </div>
          )}
          <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <div>
              <Label>Resolution status</Label>
              <Select className="w-full" value={m.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
                <option value="open">Open</option><option value="improving">Improving</option><option value="resolved">Resolved</option>
              </Select>
            </div>
            <div>
              <Label>Impact</Label>
              <Select className="w-full" value={m.severity} onChange={(e) => patch.mutate({ severity: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{SEVERITY[n]}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase text-muted">Occurrences</div>
            {m.occurrences?.length ? (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {m.occurrences.slice().reverse().map((o: any) => (
                  <li key={o.id} className="text-[13px]">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-bad/60" />
                    <div className="flex flex-wrap items-center gap-2 text-muted">
                      <span>{fmtDateTime(o.created_at)}</span>
                      {o.attempt && <Link to={`/attempts/${o.attempt.id}`} onClick={onClose} className="text-accent underline">{o.attempt.task_name} attempt #{o.attempt.id}</Link>}
                    </div>
                    {o.original && <p className="mt-0.5 text-bad line-through decoration-bad/40">{o.original}</p>}
                    {o.corrected && <p className="text-good">{o.corrected}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-[13px] text-muted">No linked occurrences (added manually).</p>}
          </div>
          {m.backlinks?.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Referenced in</div>
              <ul className="space-y-0.5 text-[13px]">
                {m.backlinks.map((b: any) => <li key={`${b.kind}-${b.id}`}><Link to={internalPath(b.kind, b.id)} onClick={onClose} className="hover:text-accent"><Badge>{b.kind}</Badge> {b.title}</Link></li>)}
              </ul>
            </div>
          )}
          {patch.error && <ErrorBox error={patch.error} />}
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>
            <Button variant="primary" onClick={() => { onClose(); nav(practiceLink(practiceSkill)); }}>
              <Play className="h-4 w-4" />Practise this in {SKILL_LABEL[practiceSkill]}
            </Button>
          </div>
          <ConfirmModal open={confirm} onClose={() => setConfirm(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete mistake?" message="This entry and its occurrence history will be removed from your journal." confirmText="Delete" />
        </div>
      )}
    </Modal>
  );
}

function AddMistakeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: format } = useFormat();
  const [f, setF] = useState({ category: "grammar", skill: "writing", pattern: "", original_example: "", corrected_example: "", explanation: "", recommended_exercise: "", severity: 2 });
  const create = useMutation({
    mutationFn: () => api.post("/api/mistakes", f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mistakes"] }); onClose(); setF({ ...f, pattern: "", original_example: "", corrected_example: "", explanation: "", recommended_exercise: "" }); },
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Add a mistake" wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div><Label hint="a short, reusable description">Pattern</Label><Input autoFocus required minLength={3} value={f.pattern} onChange={set("pattern")} placeholder="Missing article before singular countable nouns" /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Skill</Label>
            <Select className="w-full" value={f.skill} onChange={set("skill")}>
              {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select className="w-full" value={f.category} onChange={set("category")}>
              {(format?.mistake_categories ?? ["grammar"]).map((c: string) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
            </Select>
          </div>
          <div>
            <Label>Impact</Label>
            <Select className="w-full" value={f.severity} onChange={(e) => setF({ ...f, severity: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{SEVERITY[n]}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Original example</Label><Textarea rows={2} value={f.original_example} onChange={set("original_example")} /></div>
          <div><Label>Corrected example</Label><Textarea rows={2} value={f.corrected_example} onChange={set("corrected_example")} /></div>
        </div>
        <div><Label>Explanation</Label><Textarea rows={2} value={f.explanation} onChange={set("explanation")} /></div>
        <div><Label>Recommended exercise</Label><Textarea rows={2} value={f.recommended_exercise} onChange={set("recommended_exercise")} /></div>
        {create.error && <ErrorBox error={create.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={f.pattern.trim().length < 3}>Add to journal</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function MistakesPage() {
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item") ? Number(params.get("item")) : null;
  const [skill, setSkill] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: format } = useFormat();
  const { data: all = [] } = useQuery({ queryKey: ["mistakes", "list", "all"], queryFn: () => api.get<any[]>("/api/mistakes") });
  const { data, isLoading, error } = useQuery({
    queryKey: ["mistakes", "list", skill, category, status],
    queryFn: () => api.get<any[]>(`/api/mistakes${qs({ skill, category, status })}`),
  });
  const catCounts = useMemo(() => {
    const c: Record<string, number> = {};
    all.filter((m) => m.status !== "resolved").forEach((m) => (c[m.category] = (c[m.category] ?? 0) + m.occurrence_count));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [all]);
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { open: 0, improving: 0, resolved: 0 };
    all.forEach((m) => (c[m.status] = (c[m.status] ?? 0) + 1));
    return c;
  }, [all]);
  const open = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("item", String(id));
    else p.delete("item");
    setParams(p);
  };

  return (
    <div>
      <PageHeader
        icon={<TriangleAlert className="h-6 w-6 text-accent" />}
        title="Mistake Journal"
        subtitle="Recurring problems found in your evaluations, ranked by how often they occur and how much they affect your score."
        actions={<Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Add mistake</Button>}
      />
      <Card className="mb-5">
        <CardBody className="flex gap-3 pt-4 text-[13px] text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            Each new AI evaluation records new recurring problems here and checks your top open mistakes for that skill.
            If a mistake does not recur, it earns a <strong className="text-fg">clean check</strong>. After 2 clean checks in a row it moves to
            <em> Improving</em>, and after 4 to <em>Resolved</em>. If it shows up again, it goes back to <em>Open</em>. You can also change the status yourself.
          </p>
        </CardBody>
      </Card>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {catCounts.map(([c, n]) => (
          <button
            key={c}
            onClick={() => setCategory(category === c ? "" : c)}
            className={cx("rounded-full border px-2.5 py-1 text-[12px]", category === c ? "border-accent bg-accent/10 text-accent" : "border-border bg-panel text-muted hover:bg-subtle")}
          >
            {CATEGORY_LABEL(c)} <span className="font-semibold">{n}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Filter by skill">
          <option value="">All skills</option>
          {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {(format?.mistake_categories ?? []).map((c: string) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">Open ({statusCounts.open})</option>
          <option value="improving">Improving ({statusCounts.improving})</option>
          <option value="resolved">Resolved ({statusCounts.resolved})</option>
        </Select>
      </div>

      {isLoading && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {data && data.length === 0 && (
        <Empty icon={<TriangleAlert className="h-8 w-8" />} title={all.length ? "No mistakes match these filters" : "No mistakes recorded yet"}>
          Submit writing or speaking responses for AI evaluation, or ask for explanations of missed listening and reading questions. Recurring problems will appear here automatically.
        </Empty>
      )}
      <div className="grid gap-2.5 md:grid-cols-2">
        {data?.map((m, i) => (
          <button key={m.id} onClick={() => open(m.id)} className="rounded-xl border border-border bg-panel p-4 text-left transition-colors hover:border-accent/50 hover:bg-subtle">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[14px] font-medium">
                {!status && !category && !skill && i < 3 && m.status !== "resolved" && <span className="mr-1.5 text-[11px] font-semibold text-bad">#{i + 1}</span>}
                {m.pattern}
              </span>
              <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
            </div>
            {m.original_example && <p className="mt-1.5 line-clamp-1 text-[12.5px] text-bad/90 line-through decoration-bad/30">{m.original_example}</p>}
            {m.corrected_example && <p className="line-clamp-1 text-[12.5px] text-good">{m.corrected_example}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              {(SKILLS as string[]).includes(m.skill) ? <SkillBadge skill={m.skill} /> : <Badge>{m.skill}</Badge>}
              <Badge>{CATEGORY_LABEL(m.category)}</Badge>
              <span className="font-medium text-fg">{m.occurrence_count}×</span>
              <span>{SEVERITY[m.severity]}</span>
              <span className="ml-auto">last seen {fmtDate(m.last_seen_at)}</span>
            </div>
          </button>
        ))}
      </div>
      <MistakeDetail id={itemId} onClose={() => open(null)} />
      <AddMistakeModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

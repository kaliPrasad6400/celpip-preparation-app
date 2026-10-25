import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenCheck, Brain, EyeOff, LibraryBig, Play, Plus, Trash2 } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFormat } from "../components/QuestionPicker";
import { ConfidenceDots } from "../components/vocab/VocabParts";
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Empty, ErrorBox, Input, Label, Modal, Notice, PageHeader, Select, SkillBadge, Spinner, Textarea,
} from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, practiceLink, SKILLS, SKILL_LABEL } from "../lib/util";
import { internalPath } from "../components/notes/NoteEditor";

const STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "good" | "bad" | "accent" }> = {
  learning: { label: "Learning", tone: "neutral" },
  practicing: { label: "Practicing", tone: "accent" },
  mastered: { label: "Mastered", tone: "good" },
  needs_revision: { label: "Needs revision", tone: "bad" },
};

export function TemplateStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.learning;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="text-[14px]">{children}</div>
    </div>
  );
}

function Chips({ items }: { items?: string[] }) {
  if (!items?.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x, i) => <span key={i} className="rounded-md bg-subtle px-2 py-0.5 text-[13px]">{x}</span>)}
    </div>
  );
}

function TemplateBody({ t }: { t: any }) {
  return (
    <div className="space-y-4">
      {t.intended_use && <p className="text-[14.5px]">{t.intended_use}</p>}
      <Field title="Step-by-step structure">
        <ol className="space-y-2">
          {(t.structure ?? []).map((s: any, i: number) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[12px] font-semibold text-accent">{i + 1}</span>
              <div><div className="font-medium">{s.step}</div>{s.guidance && <div className="text-[13px] text-muted">{s.guidance}</div>}</div>
            </li>
          ))}
        </ol>
      </Field>
      {t.time_plan && <Field title="Time plan">{t.time_plan}</Field>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field title="Opening phrases"><Chips items={t.opening_phrases} /></Field>
        <Field title="Transition phrases"><Chips items={t.transition_phrases} /></Field>
      </div>
      <Field title="Useful expressions"><Chips items={t.useful_expressions} /></Field>
      {t.vocabulary?.length > 0 && <Field title="Associated vocabulary"><Chips items={t.vocabulary} /></Field>}
    </div>
  );
}

// ------------------------------------------------------------------ recall check
function RecallCheck({ t, onDone }: { t: any; onDone: () => void }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<"write" | "compare">("write");
  const [text, setText] = useState("");
  const recall = useMutation({
    mutationFn: (success: boolean) => api.post(`/api/templates/${t.id}/recall`, { success, notes: text.slice(0, 2000) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["template", t.id] });
      qc.invalidateQueries({ queryKey: ["templates"] });
      onDone();
    },
  });
  return (
    <div className="space-y-3">
      {stage === "write" ? (
        <>
          <Notice>The template is hidden. Write its structure from memory: the steps in order, plus a few opening and transition phrases.</Notice>
          <Textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. …\n2. …\n3. …"} aria-label="Template from memory" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDone}>Cancel</Button>
            <Button variant="primary" disabled={!text.trim()} onClick={() => setStage("compare")}>Reveal and compare</Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase text-muted">From memory</div>
              <div className="whitespace-pre-wrap rounded-lg bg-subtle p-3 text-[14px]">{text}</div>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Template</div>
              <ol className="space-y-1 rounded-lg border border-border p-3 text-[14px]">
                {(t.structure ?? []).map((s: any, i: number) => <li key={i}>{i + 1}. {s.step}</li>)}
              </ol>
            </div>
          </div>
          <p className="text-[13px] text-muted">Be honest: count it as recalled only if you got every step, in order, without looking.</p>
          {recall.error && <ErrorBox error={recall.error} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => recall.mutate(false)} loading={recall.isPending}>I missed parts</Button>
            <Button variant="primary" onClick={() => recall.mutate(true)} loading={recall.isPending}>I recalled it fully</Button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detail
function TemplateDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: t, isLoading, error } = useQuery({ queryKey: ["template", id], queryFn: () => api.get(`/api/templates/${id}`) });
  const [personal, setPersonal] = useState("");
  const [recallOpen, setRecallOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (t) setPersonal(t.personal_version ?? "");
  }, [t?.id, t?.personal_version]);
  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/api/templates/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["template", id] });
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); nav("/templates"); },
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!t) return null;
  return (
    <div className="space-y-4">
      <Link to="/templates" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />All templates</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SkillBadge skill={t.skill} />
            <Badge>{t.task_type} · {t.task_name}</Badge>
            <TemplateStatusBadge status={t.status} />
            {t.is_user_created && <Badge tone="accent">My template</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRecallOpen(true)}><EyeOff className="h-4 w-4" />Closed-book recall check</Button>
          <Button variant="primary" onClick={() => nav(practiceLink(t.skill))}><Play className="h-4 w-4" />Practise with this template</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card><CardBody className="pt-5"><TemplateBody t={t} /></CardBody></Card>
          {(t.example_prompt || t.example_response) && (
            <Card>
              <CardHeader title="Example" />
              <CardBody className="space-y-3">
                {t.example_prompt && <Field title="Prompt"><p className="whitespace-pre-wrap">{t.example_prompt}</p></Field>}
                {t.example_response && <Field title="Example response"><div className="whitespace-pre-wrap rounded-lg bg-subtle p-3.5 font-serif text-[15px] leading-relaxed">{t.example_response}</div></Field>}
                {t.why_it_works && <Field title="Why it works"><p className="whitespace-pre-wrap">{t.why_it_works}</p></Field>}
              </CardBody>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Common mistakes" />
              <CardBody>
                {t.common_mistakes?.length ? <ul className="list-disc space-y-1 pl-5 text-[14px]">{t.common_mistakes.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul> : <p className="text-sm text-muted">—</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Adapting it to the question" />
              <CardBody><p className="whitespace-pre-wrap text-[14px]">{t.adaptation_guidance || "—"}</p></CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="My personal version" subtitle="Rewrite the framework in your own words, with phrases you actually use." />
            <CardBody className="space-y-2">
              <Textarea rows={8} value={personal} onChange={(e) => setPersonal(e.target.value)} aria-label="My personal version" />
              <div className="flex items-center justify-end gap-2">
                {patch.isSuccess && personal === (t.personal_version ?? "") && <span className="text-[12.5px] text-good">Saved</span>}
                <Button variant="primary" size="sm" disabled={personal === (t.personal_version ?? "")} loading={patch.isPending} onClick={() => patch.mutate({ personal_version: personal })}>Save my version</Button>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Progress" />
            <CardBody className="space-y-3 text-[13.5px]">
              <div>
                <Label>Status</Label>
                <Select className="w-full" value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </div>
              <div><Label>Confidence</Label><ConfidenceDots value={t.confidence} onChange={(n) => patch.mutate({ confidence: n })} /></div>
              <dl className="grid grid-cols-2 gap-y-1.5">
                <dt className="text-muted">Times practised</dt><dd className="text-right font-medium tabular-nums">{t.times_practiced}</dd>
                <dt className="text-muted">Without looking</dt><dd className="text-right font-medium tabular-nums">{t.times_without_looking}</dd>
                <dt className="text-muted">Latest result</dt><dd className="text-right font-medium">{t.last_score !== null && t.last_score !== undefined ? `≈ L${t.last_score} (AI est.)` : "—"}</dd>
                <dt className="text-muted">Last practised</dt><dd className="text-right">{fmtDateTime(t.last_practiced_at)}</dd>
              </dl>
              <p className="text-[12px] text-muted">A template becomes <em>Mastered</em> after 3 closed-book uses with an AI-estimated level of 11 or higher.</p>
              {patch.error && <ErrorBox error={patch.error} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Practice history" />
            <CardBody>
              {t.history?.length ? (
                <ul className="space-y-2 text-[13px]">
                  {t.history.slice().reverse().map((h: any) => (
                    <li key={h.id} className="flex items-start justify-between gap-2">
                      <div>
                        <div>{fmtDateTime(h.created_at)}</div>
                        <div className="text-[12px] text-muted">{h.attempt_id ? (h.used_without_looking ? "Closed-book use ✓" : "Used with template visible") : h.used_without_looking ? "Recall check ✓" : "Recall check — missed parts"}</div>
                      </div>
                      <div className="text-right">
                        {h.score !== null && h.score !== undefined && <Badge tone="accent">≈ L{h.score}</Badge>}
                        {h.attempt_id && <Link className="ml-1 text-[12px] text-accent underline" to={`/attempts/${h.attempt_id}`}>attempt</Link>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-muted">No practice recorded yet. Choose this template in a writing or speaking task, or run a recall check.</p>}
            </CardBody>
          </Card>
          {t.backlinks?.length > 0 && (
            <Card>
              <CardHeader title="Referenced in" />
              <CardBody>
                <ul className="space-y-1 text-[13px]">
                  {t.backlinks.map((b: any) => <li key={`${b.kind}-${b.id}`}><Link className="hover:text-accent" to={internalPath(b.kind, b.id)}><Badge>{b.kind}</Badge> {b.title}</Link></li>)}
                </ul>
              </CardBody>
            </Card>
          )}
          {t.is_user_created && <Button variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 className="h-4 w-4" />Delete template</Button>}
        </div>
      </div>
      <Modal open={recallOpen} onClose={() => setRecallOpen(false)} title={`Recall check: ${t.name}`} wide>
        {recallOpen && <RecallCheck t={t} onDone={() => setRecallOpen(false)} />}
      </Modal>
      <ConfirmModal open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete template?" message={<>“{t.name}” and its practice history will be deleted.</>} confirmText="Delete" />
    </div>
  );
}

// ------------------------------------------------------------------ new template
const LIST_FIELDS = [
  ["opening_phrases", "Opening phrases"],
  ["transition_phrases", "Transition phrases"],
  ["useful_expressions", "Useful expressions"],
  ["common_mistakes", "Common mistakes"],
  ["vocabulary", "Vocabulary"],
] as const;

function NewTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: format } = useFormat();
  const blank: Record<string, string> = {
    name: "", skill: "writing", task_type: "", intended_use: "", structure: "", opening_phrases: "", transition_phrases: "", useful_expressions: "",
    example_prompt: "", example_response: "", why_it_works: "", common_mistakes: "", adaptation_guidance: "", vocabulary: "", time_plan: "",
  };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(blank); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const tasks = format?.components[f.skill]?.tasks ?? [];
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const create = useMutation({
    mutationFn: () =>
      api.post("/api/templates", {
        ...f,
        task_type: f.task_type || tasks[0]?.key,
        structure: lines(f.structure).map((l) => {
          const [step, ...rest] = l.split(/\s[—–-]\s|:\s/);
          return { step: step.replace(/^\d+[.)]\s*/, ""), guidance: rest.join(" — ") };
        }),
        ...Object.fromEntries(LIST_FIELDS.map(([k]) => [k, lines(f[k])])),
      }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["templates"] }); onClose(); nav(`/templates/${t.id}`); },
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="New template" wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr]">
          <div><Label>Name</Label><Input autoFocus required value={f.name} onChange={set("name")} /></div>
          <div>
            <Label>Skill</Label>
            <Select className="w-full" value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value, task_type: "" })}>
              {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
            </Select>
          </div>
          <div>
            <Label>Task type</Label>
            <Select className="w-full" value={f.task_type || tasks[0]?.key || ""} onChange={set("task_type")}>
              {tasks.map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>)}
            </Select>
          </div>
        </div>
        <div><Label>Intended use</Label><Textarea rows={2} value={f.intended_use} onChange={set("intended_use")} /></div>
        <div><Label hint="one step per line; optionally “Step — guidance”">Structure</Label><Textarea rows={5} value={f.structure} onChange={set("structure")} placeholder={"State your position — one clear sentence\nFirst reason — with a specific example"} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIST_FIELDS.map(([k, label]) => <div key={k}><Label hint="one per line">{label}</Label><Textarea rows={3} value={f[k]} onChange={set(k)} /></div>)}
          <div><Label>Time plan</Label><Textarea rows={3} value={f.time_plan} onChange={set("time_plan")} /></div>
        </div>
        <div><Label>Example prompt</Label><Textarea rows={2} value={f.example_prompt} onChange={set("example_prompt")} /></div>
        <div><Label>Example response</Label><Textarea rows={5} value={f.example_response} onChange={set("example_response")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Why it works</Label><Textarea rows={3} value={f.why_it_works} onChange={set("why_it_works")} /></div>
          <div><Label>Adaptation guidance</Label><Textarea rows={3} value={f.adaptation_guidance} onChange={set("adaptation_guidance")} /></div>
        </div>
        {create.error && <ErrorBox error={create.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={f.name.trim().length < 2}>Create template</Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ library
function Library() {
  const [skill, setSkill] = useState("");
  const [status, setStatus] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["templates", skill], queryFn: () => api.get<any[]>(`/api/templates${qs({ skill })}`) });
  const rows = useMemo(() => (data ?? []).filter((t) => !status || t.status === status), [data, status]);
  const groups = useMemo(() => {
    const g: Record<string, Record<string, any[]>> = {};
    rows.forEach((t) => {
      g[t.skill] ??= {};
      (g[t.skill][`${t.task_type} · ${t.task_name}`] ??= []).push(t);
    });
    return g;
  }, [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (data ?? []).forEach((t) => (c[t.status] = (c[t.status] ?? 0) + 1));
    return c;
  }, [data]);
  return (
    <div>
      <PageHeader
        icon={<LibraryBig className="h-6 w-6 text-accent" />}
        title="Templates Library"
        subtitle="Flexible frameworks for organizing answers — learn the structure, adapt it to each question, and practise until you can use it without looking."
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New template</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Filter by skill">
          <option value="">All skills</option>
          {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <div className="ml-auto flex flex-wrap gap-1.5 text-[12px]">
          {Object.entries(STATUS).map(([k, v]) => <Badge key={k} tone={v.tone}>{v.label}: {counts[k] ?? 0}</Badge>)}
        </div>
      </div>
      {isLoading && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {data && rows.length === 0 && <Empty icon={<BookOpenCheck className="h-8 w-8" />} title="No templates match">Change the filters or create your own template.</Empty>}
      <div className="space-y-6">
        {SKILLS.filter((s) => groups[s]).map((s) => (
          <section key={s}>
            <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><SkillBadge skill={s} /></h2>
            <div className="space-y-3">
              {Object.entries(groups[s]).map(([task, list]) => (
                <div key={task}>
                  <div className="mb-1.5 text-[12.5px] font-medium text-muted">{task}</div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((t) => (
                      <Link key={t.id} to={`/templates/${t.id}`} className="rounded-xl border border-border bg-panel p-3.5 transition-colors hover:border-accent/50 hover:bg-subtle">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[14px] font-medium">{t.name}</span>
                          <TemplateStatusBadge status={t.status} />
                        </div>
                        {t.intended_use && <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{t.intended_use}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted">
                          <ConfidenceDots value={t.confidence} />
                          <span>{t.times_practiced}× practised</span>
                          <span><Brain className="mr-0.5 inline h-3 w-3" />{t.times_without_looking}× closed-book</span>
                          {t.last_score !== null && t.last_score !== undefined && <span>last ≈ L{t.last_score}</span>}
                          {t.is_user_created && <Badge tone="accent">Mine</Badge>}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <NewTemplateModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

export default function TemplatesPage() {
  const { id } = useParams();
  return id ? <TemplateDetail id={Number(id)} /> : <Library />;
}

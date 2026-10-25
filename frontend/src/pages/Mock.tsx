import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import MockRunner from "../components/mock/MockRunner";
import { useFormat } from "../components/QuestionPicker";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Empty, ErrorBox, Notice, PageHeader, SkillBadge, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, pct, SKILLS, SKILL_LABEL } from "../lib/util";

function CreateMock() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: format } = useFormat();
  const [mode, setMode] = useState<"full" | "section">("full");
  const [skills, setSkills] = useState<string[]>(["reading"]);
  const create = useMutation({
    mutationFn: () => api.post("/api/mock-exams", { mode, skills: mode === "full" ? SKILLS : skills }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["mocks"] });
      nav(`/mock/${d.id}`, { state: { missing: d.missing_tasks } });
    },
  });
  const chosen = mode === "full" ? SKILLS : skills;
  const minutes = chosen.reduce((m, s) => m + (format?.components[s]?.mock_minutes ?? 0), 0);
  return (
    <Card>
      <CardHeader title="Start a new mock exam" subtitle="Sections run in the official order with section timers and forward-only navigation." />
      <CardBody className="space-y-4">
        <Tabs value={mode} onChange={setMode} tabs={[{ value: "full", label: "Full mock (all four)" }, { value: "section", label: "Individual sections" }]} />
        {mode === "section" && (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Sections</legend>
            {SKILLS.map((s) => (
              <label key={s} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13.5px]">
                <input type="checkbox" checked={skills.includes(s)} onChange={() => setSkills((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} />
                {SKILL_LABEL[s]}
                {format && <span className="text-muted">· {format.components[s].mock_minutes} min</span>}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!chosen.length}>
            <Timer className="h-4 w-4" />Create mock{minutes ? ` (~${minutes} min)` : ""}
          </Button>
          <span className="text-[12.5px] text-muted">Prefers questions you haven't attempted yet.</span>
        </div>
        {create.error && <ErrorBox error={create.error} />}
      </CardBody>
    </Card>
  );
}

function MockList() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["mocks"], queryFn: () => api.get<any[]>("/api/mock-exams") });
  const [del, setDel] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/mock-exams/${id}`),
    onSuccess: () => { setDel(null); qc.invalidateQueries({ queryKey: ["mocks"] }); },
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length) return <Empty icon={<Timer className="h-6 w-6" />} title="No mock exams yet">Start a full mock to rehearse exam timing and get a summary report with an improvement plan.</Empty>;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link to={`/mock/${m.id}`} className="min-w-0 flex-1 hover:text-accent">
              <div className="text-[14px] font-medium">{m.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                {m.sections.map((s: string) => <SkillBadge key={s} skill={s} />)}
                <span>· {m.completed_at ? `completed ${fmtDateTime(m.completed_at)}` : m.started_at ? `started ${fmtDateTime(m.started_at)}` : `created ${fmtDateTime(m.created_at)}`}</span>
              </div>
            </Link>
            <div className="flex flex-wrap gap-2 text-[12.5px] tabular-nums">
              {m.results.map((r: any) => (
                <span key={r.id} className="rounded-md bg-subtle px-2 py-1">
                  {SKILL_LABEL[r.skill]}:{" "}
                  {r.objective_total ? pct((r.objective_correct ?? 0) / r.objective_total) : r.ai_estimated_level !== null && r.ai_estimated_level !== undefined ? `≈L${r.ai_estimated_level}` : "—"}
                </span>
              ))}
            </div>
            <Badge tone={m.status === "completed" ? "good" : m.status === "in_progress" ? "accent" : "neutral"}>{m.status.replace("_", " ")}</Badge>
            <button className="rounded p-1 text-muted hover:bg-subtle hover:text-bad" aria-label="Delete mock" onClick={() => setDel(m.id)}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <ConfirmModal
        open={del !== null}
        onClose={() => setDel(null)}
        onConfirm={() => del !== null && remove.mutate(del)}
        loading={remove.isPending}
        title="Delete this mock exam?"
        message="The mock, its results and the attempts submitted inside it are permanently deleted."
        confirmText="Delete"
      />
    </Card>
  );
}

export default function MockPage() {
  const { id } = useParams();
  if (id) {
    return (
      <div>
        <Link to="/mock" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />All mock exams</Link>
        <MockRunner id={Number(id)} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Timer className="h-6 w-6 text-accent" />}
        title="Mock Exams"
        subtitle="Simulate the CELPIP-General structure and timing: Listening → Reading → Writing → Speaking."
      />
      <Notice>Practice mock built from original practice material — not official CELPIP questions. Results are practice data, not official scores.</Notice>
      <CreateMock />
      <h2 className="pt-2 text-[15px] font-semibold">History</h2>
      <MockList />
    </div>
  );
}

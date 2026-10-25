import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Headphones, Mic, PenLine, Plus } from "lucide-react";
import { ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, qs } from "../lib/api";
import { fmtDateTime, pct, SKILL_LABEL } from "../lib/util";
import AttemptResult from "./AttemptResult";
import { ListeningRunner, ReadingRunner } from "./ObjectiveRunner";
import QuestionPicker, { useFormat } from "./QuestionPicker";
import SessionBanner from "./SessionBanner";
import { SpeakingRunner } from "./SpeakingRunner";
import { WritingRunner } from "./WritingRunner";
import { Badge, Button, Card, Empty, ErrorBox, Input, Label, Modal, Notice, PageHeader, Select, Spinner, Tabs, Textarea } from "./ui";

const ICONS: Record<string, ReactNode> = {
  listening: <Headphones className="h-6 w-6 text-listening" />,
  reading: <BookOpen className="h-6 w-6 text-reading" />,
  writing: <PenLine className="h-6 w-6 text-writing" />,
  speaking: <Mic className="h-6 w-6 text-speaking" />,
};

const SUBTITLES: Record<string, string> = {
  listening: "Six parts modelled on the CELPIP-General listening format. Audio plays once in exam mode; answers are scored against a stored answer key.",
  reading: "Four parts modelled on the CELPIP-General reading format, with timed sets and objective scoring.",
  writing: "Task 1 email (27 min) and Task 2 survey response (26 min), 150–200 words, with AI rubric feedback.",
  speaking: "All eight CELPIP-General speaking tasks with official-style preparation and response timers, recording and AI feedback.",
};

function StudyModeToggle() {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });
  if (!s) return null;
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={s.listening_study_mode}
        onChange={async (e) => {
          await api.put("/api/settings", { listening_study_mode: e.target.checked });
          qc.invalidateQueries({ queryKey: ["settings"] });
          qc.invalidateQueries({ queryKey: ["question"] });
        }}
      />
      Study mode (transcript + replay; not exam-equivalent)
    </label>
  );
}

function PrepareAllAudio() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["listening-audio-status"],
    queryFn: () => api.get("/api/listening/prepare-all"),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  if (!data) return null;
  if (!data.tts_available) return <span className="text-[12.5px] text-muted">Add a Gemini key for natural voices.</span>;
  const allReady = data.sections_ready >= data.sections_total;
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted">
      {data.running ? (
        <span>Preparing natural voices… {data.done}/{data.total} sections</span>
      ) : allReady ? (
        <span>Natural voices ready for all {data.sections_total} sections</span>
      ) : (
        <>
          <span>{data.sections_ready}/{data.sections_total} sections have natural-voice audio</span>
          <Button size="sm" variant="outline" onClick={async () => { await api.post("/api/listening/prepare-all"); refetch(); qc.invalidateQueries({ queryKey: ["listening-audio-status"] }); }}>
            Prepare all
          </Button>
        </>
      )}
      {data.errors?.length > 0 && !data.running && <span className="text-warn">{data.errors[0]}</span>}
    </div>
  );
}

function CustomQuestionModal({ skill, open, onClose, onCreated }: { skill: string; open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { data: format } = useFormat();
  const [f, setF] = useState({ task_type: "", title: "", prompt: "", audience: "", purpose: "" });
  const [err, setErr] = useState<unknown>(null);
  const tasks = format?.components[skill]?.tasks ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Add my own question">
      <div className="space-y-3">
        <div>
          <Label>Task type</Label>
          <Select value={f.task_type} onChange={(e) => setF({ ...f, task_type: e.target.value })} className="w-full">
            <option value="">Choose…</option>
            {tasks.map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>)}
          </Select>
        </div>
        <div><Label>Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><Label>Prompt</Label><Textarea rows={6} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label>Audience</Label><Input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} /></div>
          <div><Label>Purpose</Label><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
        </div>
        {err ? <ErrorBox error={err} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const q = await api.post("/api/questions", { ...f, skill });
                onCreated(q.id);
                onClose();
              } catch (e) {
                setErr(e);
              }
            }}
          >
            Save question
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function History({ skill }: { skill: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["attempts", skill], queryFn: () => api.get<any[]>(`/api/attempts${qs({ skill, limit: 100 })}`) });
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty title="No attempts yet">Your submitted practice will appear here, with scores and feedback.</Empty>;
  const objective = skill === "listening" || skill === "reading";
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.map((a) => (
          <li key={a.id}>
            <Link to={`/attempts/${a.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-subtle">
              <Badge>{a.task_type}</Badge>
              <span className="min-w-0 flex-1 truncate text-[14px]">{a.title}</span>
              {a.mode !== "practice" && <Badge>{a.mode}</Badge>}
              <span className="text-[13px] font-medium tabular-nums">
                {objective ? `${a.score_correct}/${a.score_total} · ${pct(a.accuracy)}` : a.estimated_level ? `≈ L${a.estimated_level} (AI est.)` : a.status === "eval_failed" ? "Eval failed" : "Not evaluated"}
              </span>
              <span className="text-[12px] text-muted">{fmtDateTime(a.submitted_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function SkillStudio({ skill }: { skill: "listening" | "reading" | "writing" | "speaking" }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const qid = params.get("q") ? Number(params.get("q")) : null;
  const sessionId = params.get("session") ? Number(params.get("session")) : null;
  const attemptId = params.get("attempt") ? Number(params.get("attempt")) : null;
  const retryOf = params.get("retry") ? Number(params.get("retry")) : null;
  const [tab, setTab] = useState<"practice" | "history">("practice");
  const [customOpen, setCustomOpen] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });
  const studyMode = skill === "listening" && !!settings?.listening_study_mode;
  const { data: question, error, isLoading } = useQuery({
    queryKey: ["question", qid, studyMode],
    queryFn: () => api.get(`/api/questions/${qid}${studyMode ? "?reveal=true" : ""}`),
    enabled: !!qid && !attemptId,
  });
  const { data: retryAttempt } = useQuery({
    queryKey: ["attempt", retryOf],
    queryFn: () => api.get(`/api/attempts/${retryOf}`),
    enabled: !!retryOf,
  });

  const setP = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    setParams(p);
  };
  const onSubmitted = (a: any) => {
    qc.invalidateQueries({ queryKey: ["questions"] });
    qc.invalidateQueries({ queryKey: ["attempts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (sessionId) qc.invalidateQueries({ queryKey: ["session", sessionId] });
    qc.setQueryData(["attempt", a.id], a);
    setP({ attempt: String(a.id), retry: null });
  };
  const onRetry = (a: any) => setP({ q: String(a.question_id), attempt: null, retry: String(a.id) });

  let body: ReactNode;
  if (attemptId) {
    body = (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setP({ attempt: null, q: null })}><ArrowLeft className="h-4 w-4" />Choose another question</Button>
        <AttemptResult attemptId={attemptId} autoEvaluate={skill === "writing" || skill === "speaking"} onRetry={onRetry} />
      </div>
    );
  } else if (qid) {
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setP({ q: null, retry: null })}><ArrowLeft className="h-4 w-4" />All questions</Button>
          {skill === "listening" && <StudyModeToggle />}
        </div>
        {isLoading && <Spinner />}
        {error && <ErrorBox error={error} />}
        {question && (
          <>
            {(skill === "listening" || skill === "reading") && (
              <div>
                <h2 className="text-lg font-semibold">{question.title}</h2>
                <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone="accent">{question.task_name}</Badge><Badge>Difficulty {question.difficulty}/5</Badge></div>
              </div>
            )}
            {retryAttempt && <Notice>Retry of attempt #{retryOf}. Apply the feedback: {retryAttempt.evaluations?.slice(-1)[0]?.retry_exercise}</Notice>}
            {skill === "reading" && <ReadingRunner key={question.id} question={question} sessionId={sessionId} onSubmitted={onSubmitted} />}
            {skill === "listening" && (
              <ListeningRunner key={`${question.id}-${studyMode}`} question={question} sessionId={sessionId} onSubmitted={onSubmitted} studyScript={studyMode ? question.content?.script : null} />
            )}
            {skill === "writing" && (
              <WritingRunner key={`${question.id}-${retryOf}`} question={question} sessionId={sessionId} onSubmitted={onSubmitted} parentAttemptId={retryOf} initialText={retryAttempt?.response_text} />
            )}
            {skill === "speaking" && <SpeakingRunner key={`${question.id}-${retryOf}`} question={question} sessionId={sessionId} onSubmitted={onSubmitted} parentAttemptId={retryOf} />}
          </>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "practice", label: "Question bank" }, { value: "history", label: "My attempts" }]} />
          <div className="flex flex-wrap items-center gap-3">
            {skill === "listening" && <PrepareAllAudio />}
            {skill === "listening" && <StudyModeToggle />}
            {(skill === "writing" || skill === "speaking") && (
              <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}><Plus className="h-4 w-4" />My own question</Button>
            )}
          </div>
        </div>
        {tab === "practice" ? <QuestionPicker skill={skill} onPick={(id) => setP({ q: String(id) })} /> : <History skill={skill} />}
        <CustomQuestionModal skill={skill} open={customOpen} onClose={() => setCustomOpen(false)} onCreated={(id) => setP({ q: String(id) })} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={ICONS[skill]}
        title={skill === "writing" || skill === "speaking" ? `${SKILL_LABEL[skill]} Studio` : `${SKILL_LABEL[skill]} Practice`}
        subtitle={SUBTITLES[skill]}
      />
      {sessionId && <SessionBanner sessionId={sessionId} />}
      {body}
    </div>
  );
}

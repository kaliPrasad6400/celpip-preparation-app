import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Flag, Loader2, Play, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { cx, fmtSecs, pct, SKILL_LABEL } from "../../lib/util";
import { ListeningRunner, ReadingRunner } from "../ObjectiveRunner";
import { SpeakingRunner } from "../SpeakingRunner";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmModal, ErrorBox, Notice, SkillBadge, Spinner } from "../ui";
import { WritingRunner } from "../WritingRunner";

function parseUtc(iso: string) {
  return new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z")).getTime();
}

function useSectionClock(section: any) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (section?.status !== "in_progress") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [section?.status]);
  if (!section?.started_at) return section?.time_limit_sec ?? 0;
  const elapsed = Math.floor((now - parseUtc(section.started_at)) / 1000);
  return Math.max(0, section.time_limit_sec - elapsed);
}

function SectionTimer({ left, total }: { left: number; total: number }) {
  const warn = left <= Math.min(120, total * 0.1);
  return (
    <div
      className={cx("sticky top-0 z-10 -mx-1 mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 backdrop-blur", warn ? "border-bad/40 bg-bad/10" : "border-border bg-panel/90")}
      role="timer"
      aria-live={warn ? "polite" : "off"}
    >
      <span className="text-[13px] text-muted">Section time remaining</span>
      <span className={cx("inline-flex items-center gap-1.5 text-lg font-semibold tabular-nums", warn && "text-bad")}>
        <Timer className="h-4 w-4" />{fmtSecs(left)}
      </span>
    </div>
  );
}

function ActiveSection({ exam, section, onChanged }: { exam: any; section: any; onChanged: () => void }) {
  const questions: any[] = section.questions ?? [];
  const answered = new Set<number>(section.answered_question_ids ?? []);
  const firstOpen = useMemo(() => {
    const i = questions.findIndex((q) => !answered.has(q.id));
    return i === -1 ? questions.length : i;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id]);
  const [idx, setIdx] = useState(firstOpen);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const left = useSectionClock(section);
  const expiredRef = useRef(false);
  const complete = useMutation({
    mutationFn: () => api.post(`/api/mock-exams/${exam.id}/sections/${section.order}/complete`),
    onSuccess: onChanged,
  });
  useEffect(() => {
    if (left <= 0 && !expiredRef.current && section.status === "in_progress") {
      expiredRef.current = true;
      complete.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const q = questions[idx];
  const done = idx >= questions.length;
  const onSubmitted = () => {
    onChanged();
    setIdx((i) => i + 1);
  };
  return (
    <div>
      <SectionTimer left={left} total={section.time_limit_sec} />
      {left <= 120 && left > 0 && (
        <div className="mb-4"><Notice tone="warn">Less than two minutes left. When time runs out the section closes automatically and unsaved work in the current task is lost — save your response now.</Notice></div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Task progress">
        {questions.map((qq, i) => (
          <span
            key={qq.id}
            className={cx(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px]",
              i === idx ? "bg-accent/12 font-medium text-accent" : "bg-subtle text-muted",
            )}
          >
            {answered.has(qq.id) ? <CheckCircle2 className="h-3 w-3 text-good" /> : <Circle className="h-3 w-3" />}
            {qq.task_type}
          </span>
        ))}
      </div>
      {!done && q ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-muted">Task {idx + 1} of {questions.length}</div>
              <h2 className="text-lg font-semibold">{q.task_name}</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => (answered.has(q.id) ? setIdx(idx + 1) : setSkipConfirm(true))}>
              Next task<ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {answered.has(q.id) ? (
            <Notice>This task is saved. Move on to the next task.</Notice>
          ) : (
            <>
              {section.skill === "reading" && <ReadingRunner key={q.id} question={q} mockExamId={exam.id} externalTimer onSubmitted={onSubmitted} />}
              {section.skill === "listening" && <ListeningRunner key={q.id} question={q} mockExamId={exam.id} externalTimer onSubmitted={onSubmitted} />}
              {section.skill === "writing" && <WritingRunner key={q.id} question={q} mockExamId={exam.id} externalTimer onSubmitted={onSubmitted} />}
              {section.skill === "speaking" && <SpeakingRunner key={q.id} question={q} mockExamId={exam.id} onSubmitted={onSubmitted} />}
            </>
          )}
        </div>
      ) : (
        <Card>
          <CardBody className="space-y-3 pt-5">
            <p className="text-[15px] font-medium">You have reached the end of the {section.name} section.</p>
            <p className="text-[13.5px] text-muted">
              {questions.filter((qq) => answered.has(qq.id)).length} of {questions.length} tasks saved. Once you end the section you cannot return to it.
            </p>
            <Button variant="primary" onClick={() => complete.mutate()} loading={complete.isPending}>End section</Button>
          </CardBody>
        </Card>
      )}
      {complete.error && <div className="mt-3"><ErrorBox error={complete.error} /></div>}
      <ConfirmModal
        open={skipConfirm}
        onClose={() => setSkipConfirm(false)}
        onConfirm={() => { setSkipConfirm(false); setIdx(idx + 1); }}
        title="Skip this task?"
        message="This task has not been saved. In the test you cannot go back — skipping leaves it unanswered."
        confirmText="Skip task"
      />
    </div>
  );
}

function Instructions({ exam, section, onStarted }: { exam: any; section: any; onStarted: () => void }) {
  const start = useMutation({
    mutationFn: () => api.post(`/api/mock-exams/${exam.id}/sections/${section.order}/start`),
    onSuccess: onStarted,
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><SkillBadge skill={section.skill} />{section.name} — instructions</span>} />
      <CardBody className="space-y-3">
        <p className="text-[15px] leading-relaxed">{section.instructions}</p>
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-muted">
          <li>{section.question_ids.length} task{section.question_ids.length === 1 ? "" : "s"} · section time {Math.round(section.time_limit_sec / 60)} minutes.</li>
          <li>The timer starts when you press Start and keeps running if you leave or reload the page.</li>
          <li>Navigation moves forward only. Completed sections cannot be reopened.</li>
          {section.skill === "speaking" && <li>Allow microphone access. Each task runs its own preparation and response timers.</li>}
        </ul>
        <Button variant="primary" size="lg" onClick={() => start.mutate()} loading={start.isPending}><Play className="h-4 w-4" />Start {section.name}</Button>
        {start.error && <ErrorBox error={start.error} />}
      </CardBody>
    </Card>
  );
}

export function MockSummary({ exam }: { exam: any }) {
  return (
    <div className="space-y-4">
      <Notice>
        Summary of a practice mock. Listening/reading show objective accuracy from the answer key; writing/speaking show unofficial AI-estimated
        levels. Neither is an official CELPIP score.
      </Notice>
      <div className="grid gap-4 md:grid-cols-2">
        {exam.sections.map((s: any) => {
          const r = exam.results.find((x: any) => x.skill === s.skill);
          const objective = s.skill === "listening" || s.skill === "reading";
          return (
            <Card key={s.id}>
              <CardHeader title={<span className="flex items-center gap-2"><SkillBadge skill={s.skill} />{SKILL_LABEL[s.skill]}</span>} />
              <CardBody className="space-y-3">
                {r ? (
                  <>
                    <div className="text-2xl font-semibold tabular-nums">
                      {objective
                        ? `${r.objective_correct ?? 0}/${r.objective_total ?? 0} · ${pct(r.objective_total ? (r.objective_correct ?? 0) / r.objective_total : null)}`
                        : r.ai_estimated_level !== null && r.ai_estimated_level !== undefined ? `≈ Level ${r.ai_estimated_level}` : "Not evaluated"}
                    </div>
                    <div className="text-[12px] text-muted">
                      {objective ? "Objective practice accuracy" : `Unofficial AI estimate · ${r.evaluated_count} task(s) evaluated`}
                    </div>
                    <p className="text-[13.5px]">{r.summary}</p>
                    {r.improvement_plan?.length > 0 && (
                      <div>
                        <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Improvement plan</div>
                        <ol className="list-decimal space-y-1 pl-5 text-[13.5px]">{r.improvement_plan.map((p: string, i: number) => <li key={i}>{p}</li>)}</ol>
                      </div>
                    )}
                  </>
                ) : <p className="text-[13px] text-muted">No result recorded.</p>}
                {s.attempt_ids?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                    {s.attempt_ids.map((id: number) => (
                      <Link key={id} to={`/attempts/${id}`} className="rounded-md bg-subtle px-2 py-1 text-[12px] hover:text-accent">Attempt #{id}</Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function MockRunner({ id }: { id: number }) {
  const qc = useQueryClient();
  const { data: exam, isLoading, error, refetch } = useQuery({ queryKey: ["mock", id], queryFn: () => api.get(`/api/mock-exams/${id}`) });
  const [finishConfirm, setFinishConfirm] = useState(false);
  const finish = useMutation({
    mutationFn: () => api.post(`/api/mock-exams/${id}/finish`, { evaluate: true }),
    onSuccess: (d) => {
      qc.setQueryData(["mock", id], d);
      qc.invalidateQueries({ queryKey: ["mocks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!finish.isPending) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [finish.isPending]);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!exam) return null;
  const changed = () => { refetch(); qc.invalidateQueries({ queryKey: ["mocks"] }); };
  const current = exam.sections.find((s: any) => s.order === exam.current_section);
  const allDone = !current;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Flag className="h-5 w-5 text-accent" />{exam.title}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted">{exam.label}</p>
        </div>
        <Badge tone={exam.status === "completed" ? "good" : exam.status === "in_progress" ? "accent" : "neutral"}>{exam.status.replace("_", " ")}</Badge>
      </div>
      <ol className="flex flex-wrap gap-2" aria-label="Sections">
        {exam.sections.map((s: any) => (
          <li key={s.id} className={cx("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px]", s.order === exam.current_section && exam.status !== "completed" ? "border-accent bg-accent/8" : "border-border")}>
            {s.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-good" /> : <Circle className="h-3.5 w-3.5 text-muted" />}
            {s.name}
          </li>
        ))}
      </ol>

      {exam.status === "completed" ? (
        <>
          {finish.data?.errors?.length > 0 && (
            <Notice tone="warn">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Some evaluations failed: {finish.data.errors.join("; ")}. You can evaluate those attempts individually from their pages.
            </Notice>
          )}
          <MockSummary exam={exam} />
        </>
      ) : allDone ? (
        <Card>
          <CardBody className="space-y-3 pt-5">
            <p className="text-[15px] font-medium">All sections are complete.</p>
            <p className="text-[13.5px] text-muted">
              Scoring calculates listening/reading accuracy from the answer keys and requests AI evaluations for writing and speaking (requires an API key
              in Settings; without one those sections are reported as not evaluated).
            </p>
            <Button variant="primary" size="lg" onClick={() => finish.mutate()} loading={finish.isPending}>Finish &amp; score</Button>
            {finish.isPending && (
              <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="h-4 w-4 animate-spin" />Scoring and evaluating… {elapsed}s. AI evaluation of up to 10 responses can take several minutes.</p>
            )}
            {finish.error && <ErrorBox error={finish.error} />}
          </CardBody>
        </Card>
      ) : current.status === "in_progress" ? (
        <ActiveSection key={current.id} exam={exam} section={current} onChanged={changed} />
      ) : (
        <>
          <Instructions exam={exam} section={current} onStarted={changed} />
          {exam.current_section > 0 && (
            <div className="text-right">
              <Button variant="ghost" size="sm" onClick={() => setFinishConfirm(true)}>End mock early and score completed sections</Button>
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={finishConfirm}
        onClose={() => setFinishConfirm(false)}
        onConfirm={() => { setFinishConfirm(false); finish.mutate(); }}
        loading={finish.isPending}
        title="End this mock early?"
        message="Remaining sections will not be taken. Completed sections are scored now and the mock is closed."
        confirmText="End and score"
      />
    </div>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpenCheck, ChevronDown, ChevronRight, EyeOff, Play, Send, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useCountdown } from "../lib/hooks";
import { cx, fmtSecs, storageGet, storageSet, wordCount } from "../lib/util";
import { Badge, Button, Card, CardBody, CardHeader, ErrorBox, Input, Notice, Textarea } from "./ui";

export function PromptCard({ q }: { q: any }) {
  return (
    <Card>
      <CardBody className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{q.task_name}</Badge>
          <Badge>Difficulty {q.difficulty}/5</Badge>
          {q.topic_title && <Badge>Topic: {q.topic_title}</Badge>}
          <Badge tone={q.source_type === "ai_generated" ? "warn" : "neutral"}>
            {q.source_type === "ai_generated" ? "AI-generated practice" : q.source_type === "user" ? "Your question" : "Original practice material"}
          </Badge>
        </div>
        {(q.audience || q.purpose) && (
          <div className="grid gap-2 text-[13px] sm:grid-cols-2">
            {q.audience && <div><span className="text-muted">Audience: </span>{q.audience}</div>}
            {q.purpose && <div><span className="text-muted">Purpose: </span>{q.purpose}</div>}
          </div>
        )}
        {q.background && q.background !== q.prompt && <p className="text-[13.5px] text-muted">{q.background}</p>}
        <div className="whitespace-pre-wrap text-[15.5px] leading-relaxed">{q.prompt}</div>
        {q.content?.options && (
          <div className="grid gap-2 sm:grid-cols-2">
            {q.content.options.map((o: string, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3 text-sm">
                <span className="font-semibold">Option {String.fromCharCode(65 + i)}: </span>{o}
                {q.content.option_details?.[i]?.details && (
                  <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
                    {q.content.option_details[i].details.map((d: string, j: number) => <li key={j}>{d}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {q.content?.scene_description && (
          <div className="rounded-lg border border-dashed border-border bg-subtle p-3 text-[14px]">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Picture (described in text)</div>
            {q.content.scene_description}
          </div>
        )}
        {q.instructions && <p className="text-[13px] text-muted">{q.instructions}</p>}
      </CardBody>
    </Card>
  );
}

export function TemplatePanel({ skill, taskType, hidden, onToggle }: { skill: string; taskType: string; hidden: boolean; onToggle: () => void }) {
  const { data: t } = useQuery({
    queryKey: ["template-rec", skill, taskType],
    queryFn: () => api.get(`/api/templates/recommend?skill=${skill}&task_type=${taskType}`),
  });
  const [open, setOpen] = useState(true);
  if (!t) return null;
  return (
    <Card>
      <CardHeader
        title={<span className="text-[14px] leading-snug">{t.name}</span>}
        subtitle={<span className="flex items-center gap-1"><BookOpenCheck className="h-3.5 w-3.5 shrink-0" />Template — adapt it, don't recite it.</span>}
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={onToggle} title="Practise closed-book">
              <EyeOff className="h-3.5 w-3.5" />{hidden ? "Show" : "Hide"}
            </Button>
            {!hidden && (
              <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-label="Collapse template">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            )}
          </div>
        }
      />
      {hidden ? (
        <CardBody><p className="text-[13px] text-muted">Template hidden — this attempt will count as a closed-book use of the framework if you keep it hidden.</p></CardBody>
      ) : open ? (
        <CardBody className="space-y-3 text-[13.5px]">
          <ol className="space-y-1.5">
            {(t.structure ?? []).map((s: any, i: number) => (
              <li key={i}><span className="font-medium">{i + 1}. {s.step}</span>{s.guidance && <span className="text-muted"> — {s.guidance}</span>}</li>
            ))}
          </ol>
          {t.opening_phrases?.length > 0 && (
            <div><div className="text-[12px] font-semibold uppercase text-muted">Openings</div><p>{t.opening_phrases.join(" · ")}</p></div>
          )}
          {t.transition_phrases?.length > 0 && (
            <div><div className="text-[12px] font-semibold uppercase text-muted">Transitions</div><p>{t.transition_phrases.join(" · ")}</p></div>
          )}
          {t.time_plan && <p className="text-muted"><Timer className="mr-1 inline h-3.5 w-3.5" />{t.time_plan}</p>}
          {t.personal_version && (
            <div><div className="text-[12px] font-semibold uppercase text-muted">My version</div><p className="whitespace-pre-wrap">{t.personal_version}</p></div>
          )}
        </CardBody>
      ) : null}
    </Card>
  );
}

const PLAN_FIELDS = [
  ["purpose", "Main purpose (one sentence)"],
  ["tone", "Audience & tone (formal / semi-formal / friendly)"],
  ["p1", "Point 1 + specific detail"],
  ["p2", "Point 2 + specific detail"],
  ["p3", "Point 3 + specific detail"],
  ["close", "Closing / request / next step"],
] as const;

export function WritingRunner({
  question, sessionId, mockExamId, externalTimer, onSubmitted, parentAttemptId, initialText,
}: {
  question: any; sessionId?: number | null; mockExamId?: number | null; externalTimer?: boolean; onSubmitted: (a: any) => void;
  parentAttemptId?: number | null; initialText?: string;
}) {
  const key = `draft-w-${question.id}${parentAttemptId ? `-r${parentAttemptId}` : ""}`;
  const [text, setText] = useState(() => initialText ?? storageGet(key, ""));
  const [plan, setPlan] = useState<Record<string, string>>(() => {
    try { return JSON.parse(storageGet(key + "-plan", "{}")); } catch { return {}; }
  });
  const [planOpen, setPlanOpen] = useState(!mockExamId);
  const [templateHidden, setTemplateHidden] = useState(false);
  // closed-book = template was never visible while any text existed
  const shownWhileWriting = useRef(false);
  const [tplId, setTplId] = useState<number | null>(null);
  const total = question.time_limit_sec ?? 27 * 60;
  const t = useCountdown(total);
  const startedAt = useRef<Date | null>(null);

  useEffect(() => {
    if (mockExamId) return;
    api.get(`/api/templates/recommend?skill=writing&task_type=${question.task_type}`).then((r) => r && setTplId(r.id)).catch(() => {});
  }, [question.task_type, mockExamId]);
  useEffect(() => {
    if (!templateHidden && text.length > 0) shownWhileWriting.current = true;
  }, [templateHidden, text.length > 0]);
  useEffect(() => {
    const id = window.setTimeout(() => storageSet(key, text), 400);
    return () => window.clearTimeout(id);
  }, [text, key]);
  useEffect(() => storageSet(key + "-plan", JSON.stringify(plan)), [plan, key]);
  useEffect(() => {
    if (externalTimer) return;
    if (text.length > 0 && !t.running && t.left === total) {
      startedAt.current = new Date();
      t.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const wc = wordCount(text);
  const min = question.word_min ?? 150, max = question.word_max ?? 200;
  const submit = useMutation({
    mutationFn: () =>
      api.post("/api/attempts", {
        question_id: question.id,
        response_text: text,
        mode: mockExamId ? "mock" : parentAttemptId ? "retry" : "practice",
        template_id: tplId,
        used_template_without_looking: !!tplId && templateHidden && !shownWhileWriting.current,
        study_session_id: sessionId ?? null,
        mock_exam_id: mockExamId ?? null,
        parent_attempt_id: parentAttemptId ?? null,
        started_at: (startedAt.current ?? new Date()).toISOString(),
        duration_sec: total - t.left,
      }),
    onSuccess: (a) => {
      try { localStorage.removeItem(key); localStorage.removeItem(key + "-plan"); } catch { /* ignore */ }
      onSubmitted(a);
    },
  });
  const toggleTemplate = () => setTemplateHidden((h) => !h);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <PromptCard q={question} />
        {!mockExamId && (
          <Card>
            <button className="flex w-full items-center justify-between px-5 py-3 text-left" onClick={() => setPlanOpen(!planOpen)}>
              <span className="text-[14px] font-semibold">Planning worksheet <span className="font-normal text-muted">(2–4 minutes)</span></span>
              {planOpen ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
            </button>
            {planOpen && (
              <div className="grid gap-2 border-t border-border px-5 py-4 sm:grid-cols-2">
                {PLAN_FIELDS.map(([k, label]) => (
                  <div key={k}>
                    <label className="text-[12px] text-muted">{label}</label>
                    <Input value={plan[k] ?? ""} onChange={(e) => setPlan({ ...plan, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className={cx("text-sm font-medium tabular-nums", wc < min ? "text-warn" : wc > max ? "text-bad" : "text-good")}>
              {wc} words <span className="font-normal text-muted">(target {min}–{max})</span>
            </div>
            {!externalTimer && (
              <div className="flex items-center gap-2">
                {!t.running && t.left === total && (
                  <Button size="sm" variant="ghost" onClick={() => { startedAt.current = new Date(); t.start(); }}><Play className="h-3.5 w-3.5" />Start timer</Button>
                )}
                <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium tabular-nums", t.left < 180 ? "bg-bad/12 text-bad" : "bg-subtle")}>
                  <Timer className="h-3.5 w-3.5" />{fmtSecs(t.left)}
                </span>
              </div>
            )}
          </div>
          <Textarea
            aria-label="Your response"
            className="min-h-[340px] rounded-none border-0 font-serif text-[16px] focus:border-0"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={question.task_type === "W1" ? "Dear …," : "I would choose Option …"}
            // CELPIP's editor has a spelling checker (misspellings underlined) but no grammar check and no autocorrect
            spellCheck
            lang="en-CA"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </Card>
        {!externalTimer && t.left === 0 && <Notice tone="warn">Time is up. In the test your response would be submitted automatically.</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onClick={() => submit.mutate()} loading={submit.isPending} disabled={wc < 5}>
            <Send className="h-4 w-4" />{mockExamId ? "Save response" : "Submit for evaluation"}
          </Button>
          <span className="text-[12.5px] text-muted">Draft autosaves locally. Spell-check is on, as in the test — it flags misspellings only, not grammar or wrong words.</span>
        </div>
        {submit.error && <ErrorBox error={submit.error} />}
      </div>
      {!mockExamId && (
        <div className="space-y-4">
          <TemplatePanel skill="writing" taskType={question.task_type} hidden={templateHidden} onToggle={toggleTemplate} />
        </div>
      )}
    </div>
  );
}

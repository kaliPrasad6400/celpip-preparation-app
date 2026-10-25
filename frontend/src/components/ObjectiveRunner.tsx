import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Headphones, Loader2, Pause, Play, Send, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { playScript, Segment, useCountdown } from "../lib/hooks";
import { cx, fmtSecs, safeHtml } from "../lib/util";
import { marked } from "marked";
import { Badge, Button, Card, CardBody, ErrorBox, Notice, Progress } from "./ui";

export type RunnerProps = {
  question: any;
  sessionId?: number | null;
  mockExamId?: number | null;
  externalTimer?: boolean;
  onSubmitted: (attempt: any) => void;
};

function TimerChip({ left, total }: { left: number; total: number }) {
  const warn = left <= Math.min(60, total * 0.15);
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium tabular-nums", warn ? "bg-bad/12 text-bad" : "bg-subtle")}>
      <Timer className="h-3.5 w-3.5" />
      {fmtSecs(left)}
    </span>
  );
}

function Questions({ items, answers, setAnswers, disabled }: { items: any[]; answers: Record<string, number>; setAnswers: (a: Record<string, number>) => void; disabled?: boolean }) {
  return (
    <ol className="space-y-4">
      {items.map((it, n) => (
        <li key={it.id}>
          <fieldset disabled={disabled}>
            <legend className="mb-1.5 text-[14.5px] font-medium">{n + 1}. {it.stem}</legend>
            <div className="space-y-1">
              {it.options.map((o: string, i: number) => (
                <label
                  key={i}
                  className={cx(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[14px] transition-colors",
                    answers[it.id] === i ? "border-accent bg-accent/8" : "border-border hover:bg-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name={`q-${it.id}`}
                    className="mt-1 accent-[rgb(var(--accent))]"
                    checked={answers[it.id] === i}
                    onChange={() => setAnswers({ ...answers, [it.id]: i })}
                  />
                  <span><span className="mr-1 font-medium text-muted">{String.fromCharCode(65 + i)}.</span>{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </li>
      ))}
    </ol>
  );
}

function useSubmit(question: any, answers: Record<string, number>, startedAt: Date, sessionId?: number | null, mockExamId?: number | null) {
  return useMutation({
    mutationFn: () =>
      api.post("/api/attempts", {
        question_id: question.id,
        answers,
        mode: mockExamId ? "mock" : "practice",
        study_session_id: sessionId ?? null,
        mock_exam_id: mockExamId ?? null,
        started_at: startedAt.toISOString(),
      }),
  });
}

export function ReadingRunner({ question, sessionId, mockExamId, externalTimer, onSubmitted }: RunnerProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const startedAt = useRef(new Date());
  const submit = useSubmit(question, answers, startedAt.current, sessionId, mockExamId);
  const total = question.time_limit_sec ?? 600;
  const t = useCountdown(total);
  useEffect(() => {
    if (!externalTimer) t.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const c = question.content ?? {};
  const answered = Object.keys(answers).length;
  const doSubmit = () => submit.mutate(undefined, { onSuccess: onSubmitted });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{question.instructions || question.prompt}</div>
        <div className="flex items-center gap-2">
          <Badge>{answered}/{question.items.length} answered</Badge>
          {!externalTimer && <TimerChip left={t.left} total={total} />}
        </div>
      </div>
      {!externalTimer && t.left === 0 && <Notice tone="warn">Time is up. In the real test the section would move on — submit now to see your result.</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:sticky lg:top-0 lg:max-h-[78vh] lg:overflow-y-auto">
          <CardBody className="space-y-4 pt-5">
            {c.diagram_text && (
              <div>
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Diagram / notice</div>
                <div className="prose-app rounded-lg bg-subtle p-3" dangerouslySetInnerHTML={safeHtml(marked.parse(c.diagram_text) as string)} />
              </div>
            )}
            {c.passage && <div className="prose-app whitespace-pre-wrap font-serif">{c.passage}</div>}
            {c.response_text && (
              <div>
                <div className="mb-1 mt-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Response</div>
                <div className="prose-app whitespace-pre-wrap rounded-lg bg-subtle p-3 font-serif">{c.response_text}</div>
              </div>
            )}
          </CardBody>
        </Card>
        <div>
          <Questions items={question.items} answers={answers} setAnswers={setAnswers} disabled={submit.isPending} />
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" onClick={doSubmit} loading={submit.isPending}>
              <Send className="h-4 w-4" />Submit answers
            </Button>
            {answered < question.items.length && <span className="text-[13px] text-muted">{question.items.length - answered} unanswered</span>}
          </div>
          {submit.error && <div className="mt-3"><ErrorBox error={submit.error} /></div>}
        </div>
      </div>
    </div>
  );
}

const MARKER = /^\[?\s*(section|part)\s*\d+\s*\]?\.?$/i;
function splitSections(script: Segment[]): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  for (const seg of script) {
    if (/^narrator/i.test(seg.speaker) && MARKER.test(seg.text.trim())) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(seg);
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [[]];
}

type Phase = "loading" | "preparing" | "ready" | "playing" | "questions";

/**
 * CELPIP-style listening: each section is played (once in exam mode), then only that
 * section's questions are shown; the learner moves forward section by section.
 */
export function ListeningRunner({ question, sessionId, mockExamId, externalTimer, onSubmitted, studyScript }: RunnerProps & { studyScript?: Segment[] | null }) {
  const study = !!studyScript;
  const [plan, setPlan] = useState<any | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const [sec, setSec] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [plays, setPlays] = useState(0);
  const [progress, setProgress] = useState(0);
  const [browserVoice, setBrowserVoice] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [segIdx, setSegIdx] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTts = useRef<(() => void) | null>(null);
  const scriptCache = useRef<Segment[][] | null>(null);
  const startedAt = useRef(new Date());
  const submit = useSubmit(question, answers, startedAt.current, sessionId, mockExamId);
  const total = question.time_limit_sec ?? 480;
  const t = useCountdown(total);

  useEffect(() => {
    api.get(`/api/questions/${question.id}/audio-plan`).then(setPlan).catch(setPlanError);
    return () => {
      audioRef.current?.pause();
      stopTts.current?.();
    };
  }, [question.id]);

  const sections: any[] = plan?.sections ?? [];
  const current = sections[sec];
  const items = question.items ?? [];
  const sectionItems = current ? items.filter((it: any) => current.item_ids.includes(String(it.id))) : [];
  const isLast = sec === sections.length - 1;
  const studySections = useMemo(() => (studyScript ? splitSections(studyScript) : null), [studyScript]);

  const prepare = async (k: number) => {
    const s = sections[k];
    if (!s || s.ready || !plan?.tts_available) return;
    const r = await api.post(`/api/questions/${question.id}/audio/${s.index}/prepare`);
    setPlan((p: any) => ({ ...p, sections: p.sections.map((x: any, i: number) => (i === k ? { ...x, ready: true, seconds: r.seconds } : x)) }));
  };

  // get the current section's audio ready (natural voice), then prefetch the next one
  useEffect(() => {
    if (!plan || !current) return;
    if (current.ready || browserVoice) {
      setPhase((ph) => (ph === "loading" || ph === "preparing" ? "ready" : ph));
      prepare(sec + 1).catch(() => {});
      return;
    }
    if (!plan.tts_available) {
      setBrowserVoice(true);
      setFallbackReason("Natural-voice audio needs a Gemini API key (Settings → AI), so your browser's built-in voice is used.");
      setPhase("ready");
      return;
    }
    setPhase("preparing");
    prepare(sec)
      .then(() => setPhase("ready"))
      .catch((e) => {
        setBrowserVoice(true);
        setFallbackReason(`Natural-voice audio could not be generated (${e?.message ?? "error"}), so your browser's built-in voice is used.`);
        setPhase("ready");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.tts_available, sec, current?.ready, browserVoice]);

  const finished = () => {
    setSegIdx(-1);
    setPhase("questions");
    if (!externalTimer && !t.running) t.start();
  };

  const play = async () => {
    setPlays((n) => n + 1);
    setPhase("playing");
    setProgress(0);
    if (!browserVoice && current?.ready) {
      // a real <audio> element in the page (not `new Audio()`), so playback can't be garbage-collected mid-section
      const a = audioRef.current!;
      a.src = `/api/questions/${question.id}/audio/${current.index}.wav`;
      a.currentTime = 0;
      a.ontimeupdate = () => a.duration && setProgress(a.currentTime / a.duration);
      a.onended = finished;
      a.onerror = () => {
        setBrowserVoice(true);
        setFallbackReason("The audio file could not be played, so your browser's built-in voice is used.");
        setPhase("ready");
      };
      await a.play().catch(() => setPhase("ready"));
      return;
    }
    if (!scriptCache.current) {
      const r = await api.get(`/api/questions/${question.id}/audio-script`);
      scriptCache.current = splitSections(r.script);
    }
    const segs = scriptCache.current[sec] ?? [];
    stopTts.current = playScript(segs, {
      voices: question.content?.voices,
      onSegment: (i) => { setSegIdx(i); setProgress(i / Math.max(1, segs.length)); },
      onEnd: finished,
    });
  };

  const stopPlay = () => {
    audioRef.current?.pause();
    stopTts.current?.();
    finished();
  };

  const next = () => {
    audioRef.current?.pause();
    setSec((k) => k + 1);
    setPlays(0);
    setProgress(0);
    setPhase(sections[sec + 1]?.ready || browserVoice ? "ready" : "preparing");
  };

  if (planError) return <ErrorBox error={planError} />;
  if (!plan) return <Notice>Loading the recording…</Notice>;
  const multi = sections.length > 1;
  const answeredHere = sectionItems.filter((it: any) => answers[it.id] !== undefined).length;

  return (
    <div className="space-y-4">
      <audio ref={audioRef} preload="auto" className="hidden" aria-hidden />
      {multi && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Sections">
          {sections.map((s, i) => (
            <Badge key={s.index} tone={i === sec ? "accent" : i < sec ? "good" : "neutral"}>
              {i < sec ? "✓ " : ""}{s.label ?? `Section ${s.index}`} · {s.item_ids.length} Q
            </Badge>
          ))}
        </div>
      )}
      {fallbackReason && <Notice tone="warn">{fallbackReason}</Notice>}
      <Card>
        <CardBody className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-listening/12 text-listening">
                <Headphones className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {multi && <span className="mr-1 text-muted">{current?.label ?? `Section ${sec + 1}`}:</span>}
                  {phase === "loading" && "Loading…"}
                  {phase === "preparing" && "Preparing natural-voice audio (first time only, about 10–20 seconds)…"}
                  {phase === "ready" && (plays ? "Ready to replay." : `Press play when ready. ${study ? "Study mode: replay allowed." : "You will hear this once."}`)}
                  {phase === "playing" && `Listening… ${multi ? "this section's questions" : "the questions"} appear when it ends.`}
                  {phase === "questions" && (multi ? `Answer the ${sectionItems.length} questions for this section.` : "Answer the questions.")}
                </div>
                <div className="text-[12px] text-muted">
                  {browserVoice
                    ? "Browser speech engine — lower quality than the real test."
                    : `Natural AI voices${current?.seconds ? ` · ${Math.round(current.seconds)} s` : ""} — practice audio, not official CELPIP recordings.`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {phase === "preparing" && <Loader2 className="h-5 w-5 animate-spin text-muted" />}
              {phase === "playing" && study && <Button variant="outline" onClick={stopPlay}><Pause className="h-4 w-4" />Stop</Button>}
              {phase === "ready" && (
                <Button variant="primary" onClick={play}><Play className="h-4 w-4" />{plays ? "Replay" : multi ? `Play ${current?.label ?? "section"}` : "Play recording"}</Button>
              )}
              {phase === "questions" && study && (
                <Button variant="ghost" onClick={play}><Play className="h-4 w-4" />Replay</Button>
              )}
              {!externalTimer && phase === "questions" && <TimerChip left={t.left} total={total} />}
            </div>
          </div>
          {phase === "playing" && <Progress value={progress} className="mt-4" />}
        </CardBody>
      </Card>

      {study && studySections && (phase === "questions" || phase === "playing") && (
        <Card>
          <CardBody className="pt-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Transcript{multi ? ` — ${current?.label}` : ""} <Badge tone="warn">Study mode — not exam-equivalent</Badge>
            </div>
            <div className="space-y-1.5 text-[14px]">
              {(studySections[sec] ?? []).map((s, i) => (
                <p key={i} className={cx("rounded px-1", browserVoice && segIdx === i && "bg-accent/10")}>
                  <span className="font-semibold">{s.speaker}: </span>{s.text}
                </p>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {phase === "questions" && (
        <div>
          <Questions items={sectionItems} answers={answers} setAnswers={setAnswers} disabled={submit.isPending} />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isLast ? (
              <Button variant="primary" onClick={() => { audioRef.current?.pause(); stopTts.current?.(); submit.mutate(undefined, { onSuccess: onSubmitted }); }} loading={submit.isPending}>
                <Send className="h-4 w-4" />Submit answers
              </Button>
            ) : (
              <Button variant="primary" onClick={next}>Next section <ChevronRight className="h-4 w-4" /></Button>
            )}
            {answeredHere < sectionItems.length && (
              <span className="text-[13px] text-muted">
                {sectionItems.length - answeredHere} unanswered{!isLast && !study ? " — you can't come back to this section" : ""}
              </span>
            )}
          </div>
          {submit.error && <div className="mt-3"><ErrorBox error={submit.error} /></div>}
        </div>
      )}
    </div>
  );
}

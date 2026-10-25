import { useMutation, useQuery } from "@tanstack/react-query";
import { Keyboard, Mic, RotateCcw, Send, Square, Timer, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useBrowserSTT, useCountdown, useRecorder } from "../lib/hooks";
import { cx, fmtSecs, wordCount } from "../lib/util";
import { PromptCard, TemplatePanel } from "./WritingRunner";
import { Badge, Button, Card, CardBody, ErrorBox, Notice, Textarea } from "./ui";

type Phase = "intro" | "select" | "prep" | "record" | "review" | "typed";

function BigTimer({ label, left, total, tone }: { label: string; left: number; total: number; tone: "prep" | "rec" | "sel" }) {
  const pctLeft = total ? left / total : 0;
  const color = tone === "rec" ? "rgb(var(--bad))" : tone === "sel" ? "rgb(var(--warn))" : "rgb(var(--accent))";
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(var(--subtle))" strokeWidth="3" />
          <circle cx="18" cy="18" r="16" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${pctLeft * 100.5} 100.5`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums">{fmtSecs(left)}</div>
      </div>
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        {tone === "rec" && <div className="mt-1 flex items-center gap-1.5 text-sm text-bad"><span className="h-2 w-2 animate-pulse rounded-full bg-bad" />Recording</div>}
      </div>
    </div>
  );
}

export function SpeakingRunner({
  question, sessionId, mockExamId, onSubmitted, parentAttemptId,
}: { question: any; sessionId?: number | null; mockExamId?: number | null; onSubmitted: (a: any) => void; parentAttemptId?: number | null }) {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });
  const prep = question.prep_time_sec ?? 30;
  const resp = question.time_limit_sec ?? 60;
  const hasSelection = question.task_type === "S5";
  const [phase, setPhase] = useState<Phase>("intro");
  const [transcript, setTranscript] = useState("");
  const [tsSource, setTsSource] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [tplHidden, setTplHidden] = useState(false);
  const [tplId, setTplId] = useState<number | null>(null);
  const rec = useRecorder();
  const stt = useBrowserSTT();
  const recStart = useRef<number>(0);
  const startedAt = useRef<Date>(new Date());
  const useBrowser = settings?.transcription_mode === "browser" && stt.supported;

  useEffect(() => {
    if (mockExamId) return;
    api.get(`/api/templates/recommend?skill=speaking&task_type=${question.task_type}`).then((r) => r && setTplId(r.id)).catch(() => {});
  }, [question.task_type, mockExamId]);

  const finishRecording = () => {
    rec.stop();
    if (useBrowser) stt.stop();
    setDuration(Math.round((Date.now() - recStart.current) / 1000));
    setPhase("review");
  };
  const recordTimer = useCountdown(resp, finishRecording);
  const beginRecording = async () => {
    setPhase("record");
    recStart.current = Date.now();
    const ok = await rec.start();
    if (useBrowser) stt.start();
    recordTimer.start(resp);
    if (!ok) {
      /* continue the timer so the learner can still practise speaking aloud */
    }
  };
  const prepTimer = useCountdown(prep, beginRecording);
  const selTimer = useCountdown(60, () => {
    setPhase("prep");
    prepTimer.start(prep);
  });

  useEffect(() => {
    if (phase === "review" && useBrowser && stt.text && !transcript) {
      setTranscript(stt.text);
      setTsSource("browser");
    }
  }, [phase, stt.text, useBrowser, transcript]);

  const start = () => {
    startedAt.current = new Date();
    rec.clear();
    setTranscript("");
    setTsSource(null);
    if (hasSelection) {
      setPhase("select");
      selTimer.start(60);
    } else {
      setPhase("prep");
      prepTimer.start(prep);
    }
  };

  const transcribe = useMutation({
    mutationFn: async () => {
      if (!rec.blob) throw new Error("No recording");
      const f = new FormData();
      f.append("file", rec.blob, "response.webm");
      f.append("transcribe", "true");
      return api.form("/api/audio", f);
    },
    onSuccess: (r) => {
      uploaded.current = r;
      if (r.transcript) {
        setTranscript(r.transcript);
        setTsSource("openai");
      }
    },
  });
  const uploaded = useRef<any>(null);

  const submit = useMutation({
    mutationFn: async () => {
      let token = uploaded.current?.token ?? null;
      if (rec.blob && !uploaded.current) {
        const f = new FormData();
        f.append("file", rec.blob, "response.webm");
        f.append("transcribe", "false");
        const r = await api.form("/api/audio", f);
        token = r.token;
      }
      const typed = phase === "typed";
      return api.post("/api/attempts", {
        question_id: question.id,
        response_text: transcript,
        transcript: typed ? null : transcript,
        transcript_source: typed ? "manual" : tsSource ?? "manual",
        duration_sec: duration,
        audio_token: token,
        mode: mockExamId ? "mock" : parentAttemptId ? "retry" : "practice",
        template_id: tplId,
        used_template_without_looking: !!tplId && tplHidden,
        study_session_id: sessionId ?? null,
        mock_exam_id: mockExamId ?? null,
        parent_attempt_id: parentAttemptId ?? null,
        started_at: startedAt.current.toISOString(),
      });
    },
    onSuccess: onSubmitted,
  });

  const timed = phase === "select" || phase === "prep" || phase === "record";
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <PromptCard q={question} />
        <Card>
          <CardBody className="pt-5">
            {phase === "intro" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  {hasSelection && <Badge>Selection 60 s</Badge>}
                  <Badge>Preparation {prep} s</Badge>
                  <Badge>Response {resp} s</Badge>
                </div>
                <p className="text-[13.5px] text-muted">
                  Timers run automatically, as in the test: preparation is followed immediately by recording.
                  {settings && !settings.audio_retention && " Audio retention is OFF — recordings are not kept after transcription."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="lg" onClick={start}><Mic className="h-4 w-4" />Start timed task</Button>
                  {!mockExamId && (
                    <Button variant="outline" size="lg" onClick={() => setPhase("typed")}><Keyboard className="h-4 w-4" />Type instead (text-only)</Button>
                  )}
                </div>
                {!rec.supported && <Notice tone="warn">Recording isn't supported in this browser. You can still use the timers and type your response.</Notice>}
              </div>
            )}
            {phase === "select" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <BigTimer label="Choose an option" left={selTimer.left} total={60} tone="sel" />
                <Button variant="ghost" onClick={() => { selTimer.stop(); setPhase("prep"); prepTimer.start(prep); }}>Skip to preparation</Button>
              </div>
            )}
            {phase === "prep" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <BigTimer label="Preparation" left={prepTimer.left} total={prep} tone="prep" />
                <Button variant="ghost" onClick={() => { prepTimer.stop(); beginRecording(); }}>Start speaking now</Button>
              </div>
            )}
            {phase === "record" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <BigTimer label="Speak now" left={recordTimer.left} total={resp} tone="rec" />
                <Button variant="outline" onClick={() => { recordTimer.stop(); finishRecording(); }}><Square className="h-4 w-4" />Stop early</Button>
                {useBrowser && stt.text && <p className="w-full text-[13px] text-muted">Live: {stt.text}</p>}
              </div>
            )}
            {rec.error && <div className="mt-3"><Notice tone="warn">{rec.error} You can type your response after the timer.</Notice></div>}

            {(phase === "review" || phase === "typed") && (
              <div className="space-y-3">
                {rec.url && (
                  <div>
                    <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Your recording {duration ? `(${duration}s)` : ""}</div>
                    <audio controls src={rec.url} className="w-full" />
                  </div>
                )}
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                      {phase === "typed" ? "Type what you would say" : "Transcript"}
                      {tsSource && <Badge className="ml-2">{tsSource === "openai" ? "Auto-transcribed (OpenAI)" : tsSource === "gemini" ? "Auto-transcribed (Gemini)" : tsSource === "browser" ? "Browser speech recognition" : "Typed"}</Badge>}
                    </span>
                    {phase === "review" && rec.blob && settings?.transcription_available && (
                      <Button size="sm" variant="outline" onClick={() => transcribe.mutate()} loading={transcribe.isPending}><Wand2 className="h-3.5 w-3.5" />Transcribe recording</Button>
                    )}
                  </div>
                  <Textarea
                    className="min-h-[160px]"
                    value={transcript}
                    onChange={(e) => { setTranscript(e.target.value); if (!tsSource || tsSource !== "manual") setTsSource(tsSource ?? "manual"); }}
                    placeholder={phase === "typed" ? "Type your spoken response…" : "Transcribe your recording, or type what you said as accurately as possible (including fillers)…"}
                  />
                  <div className="mt-1 text-[12px] text-muted">{wordCount(transcript)} words · a full {resp}s Level-12 answer is typically ~{Math.round((resp / 60) * 135)} words</div>
                  {transcribe.data?.transcription_error && <Notice tone="warn">{transcribe.data.transcription_error}</Notice>}
                  {transcribe.error && <ErrorBox error={transcribe.error} />}
                </div>
                <Notice tone={tsSource === "openai" || tsSource === "gemini" || tsSource === "browser" ? "info" : "warn"}>
                  {tsSource === "openai" || tsSource === "gemini" || tsSource === "browser"
                    ? "Evaluation uses the automatic transcript. Pronunciation and fluency can only be judged indirectly from text."
                    : "Text-only evaluation cannot assess pronunciation, fluency or delivery. Feedback will cover content, organization, vocabulary and grammar."}
                </Notice>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => submit.mutate()} loading={submit.isPending} disabled={wordCount(transcript) < 5}>
                    <Send className="h-4 w-4" />{mockExamId ? "Save response" : "Submit for evaluation"}
                  </Button>
                  {phase === "review" && !mockExamId && (
                    <Button variant="ghost" onClick={() => { setPhase("intro"); rec.clear(); uploaded.current = null; }}><RotateCcw className="h-4 w-4" />Try again</Button>
                  )}
                </div>
                {submit.error && <ErrorBox error={submit.error} />}
              </div>
            )}
          </CardBody>
        </Card>
        {timed && <p className={cx("text-center text-[12px] text-muted")}><Timer className="mr-1 inline h-3 w-3" />Timing follows the CELPIP-General speaking format.</p>}
      </div>
      {!mockExamId && (
        <div className="space-y-4">
          <TemplatePanel skill="speaking" taskType={question.task_type} hidden={tplHidden} onToggle={() => setTplHidden((h) => !h)} />
          <Card>
            <CardBody className="pt-4 text-[12.5px] text-muted">
              <strong className="text-fg">Audio & privacy.</strong> Recordings are saved only on this computer (data/audio) when retention is on, and can be
              deleted from the attempt page or Settings. Audio is sent to the transcription service ({settings?.transcription_provider === "gemini" ? "Google Gemini" : "OpenAI"}) only when you click “Transcribe recording”. Browser speech recognition
              (if selected in Settings) may be processed by your browser vendor's service.
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

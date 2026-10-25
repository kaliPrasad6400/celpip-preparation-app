import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/util";
import { ObjectiveReview, RubricEvaluation } from "./EvaluationView";
import { Badge, Button, Card, CardBody, ErrorBox, Notice, Spinner } from "./ui";

/** Shows a submitted attempt with its evaluation. Optionally triggers AI evaluation automatically. */
export default function AttemptResult({ attemptId, autoEvaluate = false, onRetry }: { attemptId: number; autoEvaluate?: boolean; onRetry?: (attempt: any) => void }) {
  const qc = useQueryClient();
  const { data: a, error, isLoading } = useQuery({ queryKey: ["attempt", attemptId], queryFn: () => api.get(`/api/attempts/${attemptId}`) });
  const evaluate = useMutation({
    mutationFn: () => api.post(`/api/attempts/${attemptId}/evaluate`),
    onSuccess: (d) => {
      qc.setQueryData(["attempt", attemptId], d);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["mistakes"] });
    },
  });
  const explain = useMutation({
    mutationFn: () => api.post(`/api/attempts/${attemptId}/explain`),
    onSuccess: (d) => qc.setQueryData(["attempt", attemptId], d),
  });
  const delAudio = useMutation({
    mutationFn: () => api.del(`/api/attempts/${attemptId}/audio`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attempt", attemptId] }),
  });
  const triggered = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!evaluate.isPending) return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [evaluate.isPending]);

  const rubric = a?.evaluations?.slice().reverse().find((e: any) => e.kind === "ai_rubric");
  useEffect(() => {
    if (!a || triggered.current || !autoEvaluate) return;
    if ((a.skill === "writing" || a.skill === "speaking") && !rubric) {
      triggered.current = true;
      evaluate.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, autoEvaluate]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!a) return null;
  const constructed = a.skill === "writing" || a.skill === "speaking";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Badge tone="accent">{a.task_name}</Badge>
        <span>{a.question?.title}</span>
        <span>· submitted {fmtDateTime(a.submitted_at)}</span>
        {a.word_count ? <span>· {a.word_count} words</span> : null}
        {a.duration_sec ? <span>· {a.duration_sec}s</span> : null}
        {a.mode === "retry" && <Badge>Retry</Badge>}
      </div>
      {a.has_audio && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3 pt-4">
            <audio controls src={`/api/attempts/${a.id}/audio`} className="min-w-0 flex-1" />
            <Button size="sm" variant="ghost" onClick={() => delAudio.mutate()} loading={delAudio.isPending}><Trash2 className="h-3.5 w-3.5" />Delete recording</Button>
          </CardBody>
        </Card>
      )}
      {constructed ? (
        rubric ? (
          <RubricEvaluation ev={rubric} attempt={a} onRetry={onRetry ? () => onRetry(a) : undefined} />
        ) : (
          <Card>
            <CardBody className="space-y-3 pt-5">
              <div className="whitespace-pre-wrap rounded-lg bg-subtle p-3.5 font-serif text-[15px]">{a.transcript || a.response_text}</div>
              {evaluate.isPending ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Evaluating with AI… {elapsed}s (usually 20–90 seconds). Your response is already saved.
                </div>
              ) : (
                <>
                  {evaluate.error && <ErrorBox error={evaluate.error} onRetry={() => evaluate.mutate()} />}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={() => evaluate.mutate()}><Sparkles className="h-4 w-4" />Evaluate with AI</Button>
                    <span className="text-[12.5px] text-muted">Your response is saved — you can evaluate it now or later.</span>
                  </div>
                </>
              )}
              {a.question?.sample_response && (
                <details className="rounded-lg border border-border p-3 text-[14px]">
                  <summary className="cursor-pointer font-medium">Model answer from the question bank</summary>
                  <p className="mt-2 whitespace-pre-wrap font-serif">{a.question.sample_response}</p>
                </details>
              )}
            </CardBody>
          </Card>
        )
      ) : (
        <ObjectiveReview attempt={a} onExplain={() => explain.mutate()} explaining={explain.isPending} explainError={explain.error} />
      )}
      {a.skill === "listening" && a.question?.content?.script && (
        <details className="rounded-xl border border-border bg-panel p-4 text-[14px]">
          <summary className="cursor-pointer font-medium">Show transcript (after submission)</summary>
          <div className="mt-2 space-y-1">
            {a.question.content.script.map((s: any, i: number) => <p key={i}><span className="font-semibold">{s.speaker}: </span>{s.text}</p>)}
          </div>
        </details>
      )}
      {constructed && rubric && a.question?.sample_response && (
        <details className="rounded-xl border border-border bg-panel p-4 text-[14px]">
          <summary className="cursor-pointer font-medium">Model answer from the question bank</summary>
          <p className="mt-2 whitespace-pre-wrap font-serif">{a.question.sample_response}</p>
        </details>
      )}
      {!constructed && <Notice>Objective accuracy is practice data only and is not converted into a CELPIP level.</Notice>}
    </div>
  );
}

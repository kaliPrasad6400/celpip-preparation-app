import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { cx } from "../lib/util";
import { Button, ErrorBox } from "./ui";

/** Shown on practice pages opened from a study-plan module. */
export default function SessionBanner({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["session", sessionId], queryFn: () => api.get(`/api/sessions/${sessionId}`) });
  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/api/sessions/${sessionId}`, body),
    // optimistic, so the checkbox responds immediately
    onMutate: (body: any) => {
      const prev = qc.getQueryData(["session", sessionId]);
      qc.setQueryData(["session", sessionId], (old: any) => (old ? { ...old, ...body } : old));
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(["session", sessionId], ctx.prev),
    onSuccess: (d) => qc.setQueryData(["session", sessionId], d),
  });
  const complete = useMutation({
    mutationFn: () => api.post(`/api/sessions/${sessionId}/complete`),
    onSuccess: (d) => {
      qc.setQueryData(["session", sessionId], d);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
  if (!s) return null;
  const hasAttempt = s.attempts.length > 0;
  const evaluated = s.attempts.some((a: any) => a.evaluated);
  const stepDone: Record<string, boolean> = {
    learn: hasAttempt,
    practice: hasAttempt,
    evaluate: evaluated,
    review: s.review_done,
    vocab: s.vocab_saved,
    retry: s.attempts.length > 1,
  };
  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarCheck className="h-4 w-4 text-accent" />
          Study module: {s.title}
          <span className="font-normal text-muted">· {s.duration_min} min · {s.status.replace("_", " ")}</span>
        </div>
        <Link to="/today" className="text-[13px] text-accent underline">Back to today's plan</Link>
      </div>
      <p className="mt-1 text-[13px] text-muted">{s.objective}</p>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {s.steps.map((st: any) => (
          <li key={st.key} className="flex items-center gap-2 text-[13px]">
            {stepDone[st.key] ? <CheckCircle2 className="h-4 w-4 text-good" /> : <Circle className="h-4 w-4 text-muted" />}
            <span className={cx(stepDone[st.key] && "text-muted")}>{st.label}</span>
            <span className="text-muted">· {st.minutes}m</span>
          </li>
        ))}
      </ol>
      {s.status !== "completed" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-accent/20 pt-3 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={s.review_done} disabled={!hasAttempt} onChange={(e) => patch.mutate({ review_done: e.target.checked })} />
            I reviewed my mistakes
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={s.vocab_saved} onChange={(e) => patch.mutate({ vocab_saved: e.target.checked })} />
            I saved vocabulary / notes
          </label>
          <Button size="sm" variant="primary" disabled={!hasAttempt || !s.review_done} onClick={() => complete.mutate()} loading={complete.isPending}>
            Mark module complete
          </Button>
          {!hasAttempt && <span className="text-muted">Submit the practice task first.</span>}
        </div>
      )}
      {s.status === "completed" && <p className="mt-3 text-[13px] font-medium text-good">Module completed ✓</p>}
      {complete.error && <div className="mt-2"><ErrorBox error={complete.error} /></div>}
    </div>
  );
}

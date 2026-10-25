import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronDown, ChevronRight, Lightbulb, ListChecks, Plus, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { CATEGORY_LABEL, cx, fmtDateTime, pct } from "../lib/util";
import { Badge, Button, Card, CardBody, CardHeader, ErrorBox, Notice } from "./ui";

export function LevelPill({ level, label = "Unofficial AI estimate" }: { level?: number | null; label?: string }) {
  if (level === null || level === undefined) return <Badge>Level not estimated</Badge>;
  const tone = level >= 11 ? "good" : level >= 9 ? "accent" : level >= 7 ? "warn" : "bad";
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tone as any} className="text-[13px]">≈ Level {level}</Badge>
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  );
}

function Section({ title, icon, children, defaultOpen = true }: { title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button className="flex w-full items-center justify-between px-5 py-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-[15px] font-semibold">{icon}{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
      </button>
      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </Card>
  );
}

export function RubricEvaluation({ ev, attempt, onRetry }: { ev: any; attempt: any; onRetry?: () => void }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const saveVocab = useMutation({
    mutationFn: (index: number) => api.post("/api/vocabulary/from-evaluation", { evaluation_id: ev.id, index }),
    onSuccess: (_d, index) => {
      setSaved((s) => ({ ...s, [index]: true }));
      qc.invalidateQueries({ queryKey: ["vocab"] });
    },
  });
  const myText = attempt.skill === "speaking" && attempt.transcript ? attempt.transcript : attempt.response_text;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LevelPill level={ev.estimated_level} />
            <div className="flex items-center gap-2 text-[12px] text-muted">
              {ev.confidence && <Badge>Confidence: {ev.confidence}</Badge>}
              {ev.estimated_level_range && <Badge>Range {ev.estimated_level_range}</Badge>}
              <span>{ev.model} · {fmtDateTime(ev.created_at)}</span>
            </div>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed">{ev.summary}</p>
          {ev.limitations && (
            <div className="mt-3"><Notice tone="warn"><strong>Limitations: </strong>{ev.limitations}</Notice></div>
          )}
          <p className="mt-2 text-[12px] text-muted">
            This is a rubric-based, AI-generated practice assessment — not an official CELPIP score and not a guarantee of any result.
          </p>
        </CardBody>
      </Card>

      <Section title="Criterion-by-criterion feedback" icon={<ListChecks className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-2">
          {ev.criteria.map((c: any) => (
            <div key={c.id} className="rounded-lg border border-border p-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{c.name}</span>
                {c.assessed ? <Badge tone={c.level >= 11 ? "good" : c.level >= 9 ? "accent" : "warn"}>≈ {c.level}</Badge> : <Badge>Not assessed</Badge>}
              </div>
              {c.strengths && <p className="text-[13px]"><span className="font-medium text-good">Strengths: </span>{c.strengths}</p>}
              {c.weaknesses && <p className="mt-1 text-[13px]"><span className="font-medium text-bad">Weaknesses: </span>{c.weaknesses}</p>}
              {c.examples?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {c.examples.map((e: string, i: number) => <li key={i} className="border-l-2 border-border pl-2 text-[12.5px] italic text-muted">“{e}”</li>)}
                </ul>
              )}
              {c.improvements && <p className="mt-1.5 text-[13px]"><span className="font-medium text-accent">Improve: </span>{c.improvements}</p>}
            </div>
          ))}
        </div>
      </Section>

      {ev.corrections?.length > 0 && (
        <Section title={`Sentence-level corrections (${ev.corrections.length})`} icon={<Check className="h-4 w-4" />}>
          <div className="space-y-3">
            {ev.corrections.map((c: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3 text-[14px]">
                <div className="mb-1 flex items-center gap-2"><Badge>{CATEGORY_LABEL(c.category)}</Badge></div>
                <p className="text-bad line-through decoration-bad/40">{c.original}</p>
                <p className="mt-0.5 text-good">{c.corrected}</p>
                <p className="mt-1 text-[13px] text-muted">{c.explanation}</p>
                {c.natural_alternative && c.natural_alternative !== c.corrected && (
                  <p className="mt-1 text-[13px]"><span className="font-medium">More natural: </span>{c.natural_alternative}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {ev.vocabulary_suggestions?.length > 0 && (
        <Section title="Vocabulary improvement" icon={<Sparkles className="h-4 w-4" />}>
          <div className="grid gap-2 md:grid-cols-2">
            {ev.vocabulary_suggestions.map((v: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0 text-[13.5px]">
                  {v.original && <span className="text-muted line-through">{v.original}</span>}{v.original && " → "}
                  <span className="font-semibold">{v.suggestion}</span>
                  {v.meaning && <p className="mt-0.5 text-[12.5px] text-muted">{v.meaning}</p>}
                  {v.example && <p className="mt-0.5 text-[12.5px] italic">“{v.example}”</p>}
                  {v.collocations?.length > 0 && <p className="mt-0.5 text-[12px] text-muted">Collocations: {v.collocations.join(", ")}</p>}
                </div>
                <Button size="sm" variant={saved[i] ? "ghost" : "outline"} disabled={saved[i]} onClick={() => saveVocab.mutate(i)} title="Save to Vocabulary Vault">
                  {saved[i] ? <><Check className="h-3.5 w-3.5" />Saved</> : <><Plus className="h-3.5 w-3.5" />Save</>}
                </Button>
              </div>
            ))}
          </div>
          {saveVocab.error && <div className="mt-2"><ErrorBox error={saveVocab.error} /></div>}
        </Section>
      )}

      <Section title="Improved sample response & comparison" icon={<Lightbulb className="h-4 w-4" />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Your response</div>
            <div className="whitespace-pre-wrap rounded-lg bg-subtle p-3.5 font-serif text-[15px] leading-relaxed">{myText}</div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Improved version</div>
            <div className="whitespace-pre-wrap rounded-lg border border-accent/30 bg-accent/5 p-3.5 font-serif text-[15px] leading-relaxed">{ev.improved_response}</div>
          </div>
        </div>
        {ev.comparison?.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">Three most important differences</div>
            <ol className="space-y-2">
              {ev.comparison.map((c: any, i: number) => (
                <li key={i} className="rounded-lg border border-border p-3 text-[13.5px]">
                  <div className="font-medium">{i + 1}. {c.aspect}</div>
                  <div className="mt-1 grid gap-2 md:grid-cols-2">
                    <div><span className="text-muted">Yours: </span>{c.mine}</div>
                    <div><span className="text-muted">Improved: </span>{c.improved}</div>
                  </div>
                  {c.why_it_matters && <div className="mt-1 text-muted">Why it matters: {c.why_it_matters}</div>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Next steps" />
          <CardBody>
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
              {(ev.next_steps ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Retry exercise" icon={<RotateCcw className="h-4 w-4" />} />
          <CardBody>
            <p className="whitespace-pre-wrap text-[14px]">{ev.retry_exercise}</p>
            {onRetry && <Button className="mt-3" variant="primary" size="sm" onClick={onRetry}><RotateCcw className="h-3.5 w-3.5" />Start retry</Button>}
          </CardBody>
        </Card>
      </div>
      <p className="text-[12px] text-muted">Recurring problems from this evaluation were added to your Mistake Journal automatically.</p>
    </div>
  );
}

export function ObjectiveReview({ attempt, onExplain, explaining, explainError }: { attempt: any; onExplain?: () => void; explaining?: boolean; explainError?: unknown }) {
  const q = attempt.question;
  const objective = attempt.evaluations.find((e: any) => e.kind === "objective");
  const ai = [...attempt.evaluations].reverse().find((e: any) => e.kind === "ai_explanation");
  const aiById: Record<string, any> = {};
  (ai?.explanations ?? []).forEach((x: any) => (aiById[x.item_id] = x));
  const missed = (q?.items ?? []).filter((it: any) => attempt.answers[it.id] !== it.answer).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-semibold tabular-nums">{attempt.score_correct}/{attempt.score_total}</div>
              <div className="text-sm text-muted">{pct(attempt.accuracy)} objective practice accuracy · calculated from the answer key</div>
            </div>
            {missed > 0 && onExplain && (
              <Button variant="outline" onClick={onExplain} loading={explaining}><Sparkles className="h-4 w-4" />Explain my mistakes with AI</Button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted">{objective?.limitations}</p>
          {explainError ? <div className="mt-2"><ErrorBox error={explainError} /></div> : null}
          {ai?.summary && <div className="mt-3"><Notice><strong>AI coach: </strong>{ai.summary}</Notice></div>}
        </CardBody>
      </Card>
      <div className="space-y-2.5">
        {(q?.items ?? []).map((it: any, n: number) => {
          const chosen = attempt.answers[it.id];
          const ok = chosen === it.answer;
          const x = aiById[it.id];
          return (
            <Card key={it.id} className={cx(!ok && "border-bad/30")}>
              <CardBody className="pt-4">
                <div className="flex items-start gap-2">
                  {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
                  <div className="flex-1">
                    <p className="text-[14px] font-medium">{n + 1}. {it.stem} <Badge className="ml-1">{it.qtype}</Badge></p>
                    <ul className="mt-1.5 space-y-1 text-[13.5px]">
                      {it.options.map((o: string, i: number) => (
                        <li key={i} className={cx("rounded px-2 py-0.5", i === it.answer && "bg-good/10 font-medium text-good", i === chosen && i !== it.answer && "bg-bad/10 text-bad line-through")}>
                          {String.fromCharCode(65 + i)}. {o}
                        </li>
                      ))}
                    </ul>
                    {chosen === undefined || chosen === null ? <p className="mt-1 text-[12.5px] text-warn">Not answered</p> : null}
                    {it.explanation && <p className="mt-2 text-[13px] text-muted">{it.explanation}</p>}
                    {x && (
                      <div className="mt-2 rounded-md bg-accent/5 p-2 text-[13px]">
                        {x.why_chosen_wrong && <p><span className="font-medium">Why your choice was wrong: </span>{x.why_chosen_wrong}</p>}
                        {x.strategy && <p className="mt-0.5"><span className="font-medium">Strategy: </span>{x.strategy}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Eye, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { cx, fmtDate, fmtDateTime, SKILLS, SKILL_LABEL } from "../../lib/util";
import { internalPath } from "../notes/NoteEditor";
import { Badge, Button, Card, CardBody, ConfirmModal, Empty, ErrorBox, Input, Label, Modal, Progress, Select, Spinner, Textarea } from "../ui";

export const STATUSES = ["new", "learning", "familiar", "mastered"] as const;
export const STATUS_TONE: Record<string, "neutral" | "warn" | "accent" | "good"> = { new: "neutral", learning: "warn", familiar: "accent", mastered: "good" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{cap(status)}</Badge>;
}

export function ConfidenceDots({ value, onChange, label = "Confidence" }: { value: number; onChange?: (v: number) => void; label?: string }) {
  return (
    <div className="flex items-center gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${label} ${n} of 5`}
            onClick={() => onChange(n)}
            className={cx("h-3 w-3 rounded-full border border-accent/50", n <= value ? "bg-accent" : "bg-transparent hover:bg-accent/30")}
          />
        ) : (
          <span key={n} className={cx("h-2 w-2 rounded-full", n <= value ? "bg-accent" : "bg-border")} />
        ),
      )}
    </div>
  );
}

const lines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

// ------------------------------------------------------------------ add / edit
export function VocabFormModal({ open, onClose, item }: { open: boolean; onClose: () => void; item?: any }) {
  const qc = useQueryClient();
  const blank = { term: "", meaning: "", part_of_speech: "", example: "", collocations: "", synonyms: "", usage_notes: "", formality: "neutral", skills: [] as string[], tags: "", personal_example: "" };
  const [f, setF] = useState(blank);
  const [dup, setDup] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    setDup(null);
    setF(
      item
        ? {
            term: item.term, meaning: item.meaning, part_of_speech: item.part_of_speech, example: item.example,
            collocations: (item.collocations ?? []).join("\n"), synonyms: (item.synonyms ?? []).join(", "), usage_notes: item.usage_notes,
            formality: item.formality || "neutral", skills: item.skills ?? [], tags: (item.tags ?? []).join(", "), personal_example: item.personal_example,
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        term: f.term.trim(),
        collocations: lines(f.collocations),
        synonyms: lines(f.synonyms),
        tags: lines(f.tags).map((t) => t.toLowerCase()),
      };
      return item ? api.patch(`/api/vocabulary/${item.id}`, body) : api.post("/api/vocabulary", { ...body, source_type: "user" });
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["vocab"] });
      if (!item && d.duplicate) {
        setDup(d);
        return;
      }
      onClose();
    },
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={item ? `Edit “${item.term}”` : "Add vocabulary"} wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.term.trim()) save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div><Label>Word or expression</Label><Input autoFocus value={f.term} onChange={set("term")} required /></div>
          <div><Label>Part of speech</Label><Input value={f.part_of_speech} onChange={set("part_of_speech")} placeholder="phrasal verb" /></div>
          <div>
            <Label>Formality / tone</Label>
            <Select className="w-full" value={f.formality} onChange={set("formality")}>
              <option value="formal">Formal</option><option value="neutral">Neutral</option><option value="informal">Informal</option>
            </Select>
          </div>
        </div>
        <div><Label>Meaning</Label><Textarea rows={2} value={f.meaning} onChange={set("meaning")} /></div>
        <div><Label hint="include the exact term — used for fill-in-the-blank quizzes">Example sentence</Label><Textarea rows={2} value={f.example} onChange={set("example")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label hint="one per line">Common collocations</Label><Textarea rows={3} value={f.collocations} onChange={set("collocations")} /></div>
          <div><Label hint="comma-separated">Synonyms</Label><Textarea rows={3} value={f.synonyms} onChange={set("synonyms")} /></div>
        </div>
        <div><Label>Usage notes</Label><Textarea rows={2} value={f.usage_notes} onChange={set("usage_notes")} /></div>
        <div><Label hint="write your own sentence — active use beats recognition">My example sentence</Label><Textarea rows={2} value={f.personal_example} onChange={set("personal_example")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Skills</Label>
            <div className="flex flex-wrap gap-3 pt-1 text-[13px]">
              {SKILLS.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={f.skills.includes(s)} onChange={(e) => setF({ ...f, skills: e.target.checked ? [...f.skills, s] : f.skills.filter((x) => x !== s) })} />
                  {SKILL_LABEL[s]}
                </label>
              ))}
            </div>
          </div>
          <div><Label hint="comma-separated">Tags</Label><Input value={f.tags} onChange={set("tags")} placeholder="workplace, polite-requests" /></div>
        </div>
        {dup && <ErrorBox error={new Error(`“${dup.term}” is already in your vault — edit the existing entry instead.`)} />}
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!f.term.trim()}>{item ? "Save changes" : "Add to vault"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ detail
export function VocabDetailModal({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (item: any) => void }) {
  const qc = useQueryClient();
  const { data: v, error, isLoading } = useQuery({ queryKey: ["vocab", "item", id], queryFn: () => api.get(`/api/vocabulary/${id}`), enabled: !!id });
  const [confirm, setConfirm] = useState(false);
  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/api/vocabulary/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vocab"] }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/vocabulary/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vocab"] }); setConfirm(false); onClose(); },
  });
  return (
    <Modal open={!!id} onClose={onClose} title={v?.term ?? "Vocabulary"} wide>
      {isLoading && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {v && (
        <div className="space-y-4 text-[14px]">
          <div className="flex flex-wrap items-center gap-2">
            {v.part_of_speech && <Badge>{v.part_of_speech}</Badge>}
            <Badge>{cap(v.formality || "neutral")}</Badge>
            {(v.skills ?? []).map((s: string) => <Badge key={s}>{SKILL_LABEL[s] ?? s}</Badge>)}
            {(v.tags ?? []).map((t: string) => <Badge key={t} tone="accent">#{t}</Badge>)}
            <span className="ml-auto text-[12px] text-muted">Added {fmtDate(v.created_at, { month: "short", day: "numeric", year: "numeric" })}{v.source_ref ? ` · ${v.source_ref}` : ""}</span>
          </div>
          {v.meaning && <p className="text-[15px]">{v.meaning}</p>}
          {v.example && <p className="border-l-2 border-accent/40 pl-3 font-serif italic">“{v.example}”</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {v.collocations?.length > 0 && <div><div className="text-[12px] font-semibold uppercase text-muted">Collocations</div><p>{v.collocations.join(" · ")}</p></div>}
            {v.synonyms?.length > 0 && <div><div className="text-[12px] font-semibold uppercase text-muted">Synonyms</div><p>{v.synonyms.join(", ")}</p></div>}
          </div>
          {v.usage_notes && <div><div className="text-[12px] font-semibold uppercase text-muted">Usage notes</div><p>{v.usage_notes}</p></div>}
          {v.context && <div><div className="text-[12px] font-semibold uppercase text-muted">Context</div><p>{v.context}</p></div>}
          {v.regional_note && <div><div className="text-[12px] font-semibold uppercase text-muted">Regional note</div><p>{v.regional_note}</p></div>}
          {v.practice_exercise && <div className="rounded-lg bg-subtle p-3"><div className="text-[12px] font-semibold uppercase text-muted">Practice</div><p>{v.practice_exercise}</p></div>}
          <div>
            <div className="text-[12px] font-semibold uppercase text-muted">My example sentence</div>
            {v.personal_example ? <p className="font-serif">{v.personal_example}</p> : <p className="text-muted">Not written yet — writing your own sentence helps you use the word actively.</p>}
          </div>
          <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
            <div>
              <Label>Status</Label>
              <Select className="w-full" value={v.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
              </Select>
            </div>
            <div><Label>Confidence</Label><div className="pt-2"><ConfidenceDots value={v.confidence} onChange={(n) => patch.mutate({ confidence: n })} /></div></div>
            <div className="text-[12.5px] text-muted">
              Next review: <span className="text-fg">{v.due_date ? fmtDate(v.due_date) : "—"}</span><br />
              Reviews {v.review_count} · lapses {v.lapses}<br />
              Used correctly in my work: <span className="text-fg">{v.used_correctly_count}×</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Review history</div>
              {v.reviews?.length ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[12.5px]">
                  {v.reviews.slice().reverse().map((r: any) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span>{fmtDateTime(r.reviewed_at)} · {r.mode}</span>
                      <span className={cx(r.result === "again" ? "text-bad" : r.result === "hard" ? "text-warn" : "text-good")}>{r.result} → {r.interval_days}d</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-muted">Not reviewed yet.</p>}
            </div>
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase text-muted">Referenced by</div>
              {v.backlinks?.length ? (
                <ul className="space-y-0.5 text-[12.5px]">
                  {v.backlinks.map((b: any, i: number) => (
                    <li key={`${b.kind}-${b.id}-${i}`}>
                      <Link to={internalPath(b.kind, b.id)} onClick={onClose} className="hover:text-accent"><Badge>{b.kind}</Badge> {b.title}{b.mention ? " (mention)" : ""}</Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-muted">No notes or attempts reference this yet.</p>}
            </div>
          </div>
          {patch.error && <ErrorBox error={patch.error} />}
          <div className="flex justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>
            <Button variant="primary" onClick={() => onEdit(v)}>Edit</Button>
          </div>
          <ConfirmModal open={confirm} onClose={() => setConfirm(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete vocabulary item?" message={<>“{v.term}” and its review history will be permanently deleted.</>} confirmText="Delete" />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ flashcard review
const GRADES = [
  { result: "again", label: "Again", key: "1", cls: "border-bad/40 text-bad" },
  { result: "hard", label: "Hard", key: "2", cls: "border-warn/40 text-warn" },
  { result: "good", label: "Good", key: "3", cls: "border-good/40 text-good" },
  { result: "easy", label: "Easy", key: "4", cls: "border-accent/40 text-accent" },
];

export function ReviewQueue() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["vocab", "queue"], queryFn: () => api.get("/api/vocabulary/queue") });
  const queue = useMemo(() => (data ? [...data.due, ...data.new] : []), [data]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<Record<string, number>>({});
  useEffect(() => { setIdx(0); setRevealed(false); }, [data]);
  const review = useMutation({
    mutationFn: ({ id, result }: { id: number; result: string }) => api.post(`/api/vocabulary/${id}/review`, { result, mode: "card" }),
    onSuccess: (_d, v) => {
      setTally((t) => ({ ...t, [v.result]: (t[v.result] ?? 0) + 1 }));
      setIdx((i) => i + 1);
      setRevealed(false);
      qc.invalidateQueries({ queryKey: ["vocab", "list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const card = queue[idx];
  const grade = useCallback((result: string) => card && !review.isPending && review.mutate({ id: card.id, result }), [card, review]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (!card) return;
      if (e.key === " ") { e.preventDefault(); setRevealed(true); }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) grade(GRADES[Number(e.key) - 1].result);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, grade]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!queue.length)
    return <Empty icon={<CheckCircle2 className="h-8 w-8" />} title="Nothing to review right now">No items are due and there are no new items waiting. Come back tomorrow, or add new vocabulary.</Empty>;
  if (!card) {
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    return (
      <Card>
        <CardBody className="space-y-3 pt-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-good" />
          <p className="text-lg font-semibold">Review session complete — {total} cards</p>
          <p className="text-sm text-muted">{GRADES.map((g) => `${g.label}: ${tally[g.result] ?? 0}`).join(" · ")}</p>
          <Button variant="outline" onClick={() => { setTally({}); refetch(); }}><RotateCcw className="h-4 w-4" />Check for more</Button>
        </CardBody>
      </Card>
    );
  }
  const isNew = card.review_count === 0;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>Card {idx + 1} of {queue.length} · {data.due.length} due, {data.new.length} new</span>
        {isNew ? <Badge tone="accent">New</Badge> : <StatusBadge status={card.status} />}
      </div>
      <Progress value={idx / queue.length} />
      <Card className="min-h-[260px]">
        <CardBody className="flex flex-col items-center gap-4 pt-8 text-center">
          <div className="text-3xl font-semibold tracking-tight">{card.term}</div>
          {card.part_of_speech && <div className="text-sm text-muted">{card.part_of_speech}</div>}
          {!revealed ? (
            <Button variant="outline" onClick={() => setRevealed(true)}><Eye className="h-4 w-4" />Reveal <span className="text-muted">(Space)</span></Button>
          ) : (
            <div className="w-full space-y-2 border-t border-border pt-4 text-left text-[14.5px]">
              <p>{card.meaning}</p>
              {card.example && <p className="font-serif italic text-muted">“{card.example}”</p>}
              {card.collocations?.length > 0 && <p className="text-[13px]"><span className="text-muted">Collocations: </span>{card.collocations.join(" · ")}</p>}
              {card.personal_example && <p className="text-[13px]"><span className="text-muted">My sentence: </span>{card.personal_example}</p>}
            </div>
          )}
        </CardBody>
      </Card>
      {revealed && (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <button key={g.result} disabled={review.isPending} onClick={() => grade(g.result)} className={cx("rounded-lg border bg-panel py-2.5 text-sm font-medium hover:bg-subtle disabled:opacity-50", g.cls)}>
              {g.label} <span className="ml-1 text-[11px] text-muted">{g.key}</span>
            </button>
          ))}
        </div>
      )}
      {review.error && <ErrorBox error={review.error} />}
      <p className="text-center text-[12px] text-muted">Shortcuts: Space reveal · 1 Again · 2 Hard · 3 Good · 4 Easy</p>
    </div>
  );
}

// ------------------------------------------------------------------ quiz
export function Quiz() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"meaning" | "fill">("meaning");
  const [round, setRound] = useState(0);
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["vocab", "quiz", kind, round],
    queryFn: () => api.get<any[]>(`/api/vocabulary/quiz?kind=${kind}&n=10`),
    staleTime: Infinity,
  });
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  useEffect(() => { setI(0); setChosen(null); setScore(0); }, [data]);
  const record = useMutation({
    mutationFn: ({ id, ok }: { id: number; ok: boolean }) => api.post(`/api/vocabulary/${id}/review`, { result: ok ? "good" : "again", mode: kind === "fill" ? "fill" : "quiz" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vocab", "list"] }),
  });
  const q = data?.[i];
  const choose = (n: number) => {
    if (chosen !== null || !q) return;
    setChosen(n);
    const ok = n === q.answer;
    if (ok) setScore((s) => s + 1);
    record.mutate({ id: q.item_id, ok });
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Quiz type">
          <option value="meaning">Choose the meaning</option>
          <option value="fill">Fill in the blank</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => setRound((r) => r + 1)} loading={isFetching}><RotateCcw className="h-4 w-4" />New quiz</Button>
      </div>
      {isLoading && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {data && q && (
        <Card>
          <CardBody className="space-y-4 pt-5">
            <div className="flex justify-between text-[13px] text-muted"><span>Question {i + 1} of {data.length}</span><span>Score {score}</span></div>
            <p className={cx("text-center", q.kind === "fill" ? "font-serif text-[17px]" : "text-2xl font-semibold")}>{q.prompt}</p>
            <div className="space-y-2">
              {q.options.map((o: string, n: number) => (
                <button
                  key={n}
                  onClick={() => choose(n)}
                  disabled={chosen !== null}
                  className={cx(
                    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[14px]",
                    chosen === null && "border-border hover:bg-subtle",
                    chosen !== null && n === q.answer && "border-good/50 bg-good/10",
                    chosen !== null && n === chosen && n !== q.answer && "border-bad/50 bg-bad/10",
                    chosen !== null && n !== q.answer && n !== chosen && "border-border opacity-60",
                  )}
                >
                  <span className="font-medium text-muted">{String.fromCharCode(65 + n)}.</span>{o}
                  {chosen !== null && n === q.answer && <Check className="ml-auto h-4 w-4 text-good" />}
                  {chosen === n && n !== q.answer && <XCircle className="ml-auto h-4 w-4 text-bad" />}
                </button>
              ))}
            </div>
            {chosen !== null && (
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => { setI(i + 1); setChosen(null); }}>{i + 1 < data.length ? "Next" : "Finish"}</Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {data && !q && data.length > 0 && (
        <Card>
          <CardBody className="space-y-2 pt-6 text-center">
            <p className="text-lg font-semibold">Quiz complete: {score} / {data.length}</p>
            <p className="text-sm text-muted">Each answer was recorded as a review (correct → Good, wrong → Again), so missed words return sooner.</p>
            <Button variant="outline" onClick={() => setRound((r) => r + 1)}><RotateCcw className="h-4 w-4" />Another quiz</Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ active use
export function ActiveUse({ items, onOpen }: { items: any[]; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const usage = useMutation({
    mutationFn: (id: number) => api.post(`/api/vocabulary/${id}/usage`, { used_correctly: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vocab"] }),
  });
  const used = items.filter((v) => v.used_correctly_count > 0).sort((a, b) => b.used_correctly_count - a.used_correctly_count);
  const notYet = items.filter((v) => v.used_correctly_count === 0 && v.review_count > 0);
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="pt-4 text-[13.5px] text-muted">
          Recognising a word is not the same as using it. When an AI evaluation finds a saved word or phrase in your writing or speaking
          and doesn't flag the sentence it appears in, the word's <strong className="text-fg">used correctly</strong> count goes up automatically.
          You can also record a correct use yourself, for example after using it in a practice task. Writing your own example sentence for each word helps most.
        </CardBody>
      </Card>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Used in my own work ({used.length})</h3>
        {used.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {used.map((v) => (
              <button key={v.id} onClick={() => onOpen(v.id)} className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-left text-sm hover:bg-subtle">
                <span className="font-medium">{v.term}</span>
                <span className="text-[12.5px] text-muted">{v.used_correctly_count}× · last {fmtDate(v.last_used_at)}</span>
              </button>
            ))}
          </div>
        ) : <Empty title="No active uses recorded yet">Use saved words in your writing or speaking practice — evaluations will detect them.</Empty>}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Reviewed but not yet used ({notYet.length})</h3>
        {notYet.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {notYet.slice(0, 40).map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm">
                <button className="min-w-0 text-left hover:text-accent" onClick={() => onOpen(v.id)}>
                  <span className="font-medium">{v.term}</span>
                  {!v.personal_example && <span className="ml-2 text-[12px] text-warn">no personal sentence</span>}
                </button>
                <Button size="sm" variant="outline" onClick={() => usage.mutate(v.id)} disabled={usage.isPending}>I used it</Button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, RefreshCw, Shuffle, SkipForward } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmModal, ErrorBox, PageHeader, Progress, SkillBadge, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { cx, fmtDate, localISODate, practiceLink } from "../lib/util";

function SessionCard({ s, carry }: { s: any; carry?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["week"] });
  };
  const swap = useMutation({ mutationFn: () => api.post(`/api/sessions/${s.id}/swap-question`), onSuccess: refresh });
  const skip = useMutation({ mutationFn: () => api.post(`/api/sessions/${s.id}/skip`), onSuccess: refresh });
  const [confirmSkip, setConfirmSkip] = useState(false);
  const done = s.status === "completed";
  return (
    <Card className={cx(done && "opacity-80")}>
      <CardBody className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-good" /> : <Circle className="mt-0.5 h-5 w-5 text-muted" />}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <SkillBadge skill={s.skill} />
                <h3 className="text-[16px] font-semibold">{s.title}</h3>
                {carry && <Badge tone="warn">From {fmtDate(s.plan_date)}</Badge>}
              </div>
              <p className="mt-1 text-[13.5px] text-muted">{s.objective}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Clock className="h-4 w-4" />{s.duration_min} min
            <Badge tone={done ? "good" : s.status === "in_progress" ? "accent" : s.status === "skipped" ? "warn" : "neutral"}>{s.status.replace("_", " ")}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-subtle p-3 text-[13px]">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Practice question</div>
            <div className="mt-0.5 font-medium">{s.question?.title ?? "None available — generate one"}</div>
            {s.topic && <div className="text-muted">Topic: {s.topic.title}</div>}
          </div>
          <div className="rounded-lg bg-subtle p-3 text-[13px]">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Template / strategy</div>
            {s.template ? (
              <Link to={`/templates/${s.template.id}`} className="mt-0.5 block font-medium text-accent">{s.template.name}</Link>
            ) : (
              <div className="mt-0.5 text-muted">—</div>
            )}
          </div>
          <div className="rounded-lg bg-subtle p-3 text-[13px]">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Mistake to watch</div>
            {s.focus_mistake ? (
              <Link to={`/mistakes?item=${s.focus_mistake.id}`} className="mt-0.5 block font-medium text-accent">{s.focus_mistake.pattern}</Link>
            ) : (
              <div className="mt-0.5 text-muted">None recorded yet</div>
            )}
          </div>
        </div>

        <ol className="mt-4 space-y-1">
          {s.steps.map((st: any, i: number) => (
            <li key={st.key} className="flex items-center gap-2 text-[13.5px]">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold">{i + 1}</span>
              {st.label}
              <span className="text-muted">· {st.minutes} min</span>
            </li>
          ))}
        </ol>

        {s.attempts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
            {s.attempts.map((a: any) => (
              <Link key={a.id} to={`/attempts/${a.id}`} className="rounded-md border border-border px-2 py-1 hover:bg-subtle">
                Attempt #{a.id}: {a.accuracy != null ? `${Math.round(a.accuracy * 100)}%` : a.estimated_level ? `≈ L${a.estimated_level}` : a.status}
              </Link>
            ))}
          </div>
        )}

        {!done && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={practiceLink(s.skill, s.question?.id, s.id)}>
              <Button variant="primary">{s.status === "in_progress" ? "Continue module" : "Start module"}</Button>
            </Link>
            <Button variant="ghost" onClick={() => swap.mutate()} loading={swap.isPending}><Shuffle className="h-4 w-4" />Different question</Button>
            {s.status !== "skipped" && <Button variant="ghost" onClick={() => setConfirmSkip(true)}><SkipForward className="h-4 w-4" />Skip</Button>}
          </div>
        )}
        {(swap.error || skip.error) && <div className="mt-2"><ErrorBox error={swap.error || skip.error} /></div>}
        <ConfirmModal
          open={confirmSkip}
          onClose={() => setConfirmSkip(false)}
          onConfirm={() => { skip.mutate(); setConfirmSkip(false); }}
          title="Skip this module?"
          message="Skipped modules stay in your history and can still be completed later. Skipping lowers your completion rate."
          confirmText="Skip module"
        />
      </CardBody>
    </Card>
  );
}

function WeekView() {
  const [offset, setOffset] = useState(0);
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const startIso = localISODate(start);
  const { data, isLoading, error } = useQuery({ queryKey: ["week", startIso], queryFn: () => api.get<any[]>(`/api/plans/week/${startIso}`) });
  return (
    <Card>
      <CardHeader
        title="Weekly overview"
        subtitle={`Week of ${fmtDate(startIso, { month: "long", day: "numeric" })}`}
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>This week</Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <CardBody>
        {isLoading && <Spinner />}
        {error && <ErrorBox error={error} />}
        <div className="grid gap-2 sm:grid-cols-7">
          {(data ?? []).map((d) => {
            const today = d.date === localISODate();
            return (
              <div key={d.date} className={cx("min-h-[110px] rounded-lg border p-2", today ? "border-accent" : "border-border", !d.is_study_day && "bg-subtle/50")}>
                <div className="mb-1 text-[12px] font-semibold">
                  {new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                  {!d.is_study_day && <span className="ml-1 font-normal text-muted">rest</span>}
                </div>
                {d.plan?.sessions.map((s: any) => (
                  <div key={s.id} className="mb-1 flex items-center gap-1 text-[11.5px]">
                    {s.status === "completed" ? <CheckCircle2 className="h-3 w-3 shrink-0 text-good" /> : <Circle className="h-3 w-3 shrink-0 text-muted" />}
                    <span className="truncate">{s.task_type} {s.skill}</span>
                  </div>
                ))}
                {!d.plan && <div className="text-[11.5px] text-muted">{d.date > localISODate() ? "Planned on the day" : "No plan"}</div>}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function MonthCalendar() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });
  const { data } = useQuery({
    queryKey: ["calendar", localISODate(month)],
    queryFn: () => api.get<any[]>(`/api/plans/calendar?start=${localISODate(month)}&end=${localISODate(end)}`),
  });
  const byDate: Record<string, any> = {};
  (data ?? []).forEach((p) => (byDate[p.date] = p));
  const lead = (month.getDay() + 6) % 7;
  const cells = Array.from({ length: lead + end.getDate() }, (_, i) => (i < lead ? null : i - lead + 1));
  return (
    <Card>
      <CardHeader
        title="Calendar"
        subtitle={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <CardBody>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const iso = localISODate(new Date(month.getFullYear(), month.getMonth(), day));
            const p = byDate[iso];
            const total = p?.sessions.length ?? 0;
            const done = p?.sessions.filter((s: any) => s.status === "completed").length ?? 0;
            const exam = iso === settings?.exam_date;
            return (
              <div
                key={i}
                title={p ? `${done}/${total} modules completed` : undefined}
                className={cx(
                  "flex aspect-square flex-col items-center justify-center rounded-md text-[12px]",
                  exam ? "bg-bad/15 font-bold text-bad" : done && done === total ? "bg-good/20" : done ? "bg-accent/15" : total ? "bg-subtle" : "",
                  iso === localISODate() && "ring-2 ring-accent",
                )}
              >
                {day}
                {total > 0 && <span className="text-[9px] text-muted">{done}/{total}</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">Green: all modules done · tint: partly done · red: exam day.</p>
      </CardBody>
    </Card>
  );
}

export default function TodayPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"today" | "week">("today");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const { data: p, error, isLoading, refetch } = useQuery({ queryKey: ["today"], queryFn: () => api.get("/api/plans/today") });
  const regen = useMutation({
    mutationFn: () => api.post(`/api/plans/${localISODate()}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return (
    <div>
      <PageHeader
        icon={<CalendarCheck className="h-6 w-6 text-accent" />}
        title="Today's Study Plan"
        subtitle="Two primary modules a day, chosen from your weakest skills, recent performance, topic variety and recurring mistakes. A module is complete only after you submit the practice and review your mistakes."
        actions={
          <>
            <Tabs value={view} onChange={setView} tabs={[{ value: "today", label: "Today" }, { value: "week", label: "Week & calendar" }]} />
            {view === "today" && <Button variant="outline" onClick={() => setConfirmRegen(true)}><RefreshCw className="h-4 w-4" />Re-plan</Button>}
          </>
        }
      />
      {view === "week" ? (
        <div className="space-y-4">
          <WeekView />
          <MonthCalendar />
        </div>
      ) : (
        <>
          {isLoading && <Spinner />}
          {error && <ErrorBox error={error} onRetry={refetch} />}
          {p && (
            <div className="space-y-4">
              {!p.is_study_day && <Card><CardBody className="pt-4 text-sm">Today is not one of your preferred study days — the plan is optional.</CardBody></Card>}
              <Card>
                <CardBody className="pt-4">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="font-medium">{p.sessions.filter((s: any) => s.status === "completed").length} of {p.sessions.length} modules completed</span>
                    <span className="text-muted">{p.total_minutes} min planned</span>
                  </div>
                  <Progress value={p.completion} />
                  {p.rationale && <p className="mt-3 text-[13px] text-muted">{p.rationale}</p>}
                </CardBody>
              </Card>
              {p.sessions.map((s: any) => <SessionCard key={s.id} s={s} />)}
              {p.carry_over.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h2 className="text-lg font-semibold">Unfinished modules from earlier days</h2>
                  <p className="text-sm text-muted">Missed a day? Your schedule and history are kept — resume any of these when you have time.</p>
                  {p.carry_over.map((s: any) => <SessionCard key={s.id} s={s} carry />)}
                </div>
              )}
              {regen.error && <ErrorBox error={regen.error} />}
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        onConfirm={() => { regen.mutate(); setConfirmRegen(false); }}
        title="Re-plan today?"
        message="Modules you have not started will be replaced with a fresh selection. Started and completed modules are kept."
        confirmText="Re-plan"
      />
    </div>
  );
}

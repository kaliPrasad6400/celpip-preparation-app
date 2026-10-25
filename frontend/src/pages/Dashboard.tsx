import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookA, CalendarDays, CheckCircle2, Circle, Flame, Gauge, Sparkles, Target, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LevelPill } from "../components/EvaluationView";
import { Badge, Button, Card, CardBody, CardHeader, Empty, ErrorBox, Progress, SkillBadge, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { CATEGORY_LABEL, cx, fmtDate, pct, practiceLink, SKILL_COLOR_VAR, SKILL_LABEL, SKILLS } from "../lib/util";

function NextUp({ next, plan }: { next: any; plan: any }) {
  let to = "/today";
  if (next.type === "session") {
    const s = plan.sessions.find((x: any) => x.id === next.session_id);
    if (s) to = practiceLink(s.skill, s.question?.id, s.id);
  } else if (next.type === "vocab") to = "/vocabulary?tab=review";
  else if (next.type === "mistake") to = `/mistakes?item=${next.mistake_id}`;
  else if (next.type === "skill") to = practiceLink(next.skill);
  return (
    <Card className="border-accent/30 bg-gradient-to-br from-accent/8 to-transparent">
      <CardBody className="flex flex-wrap items-center justify-between gap-4 pt-5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wider text-accent">Do this next</div>
          <div className="mt-1 text-xl font-semibold">{next.label}</div>
          <div className="mt-0.5 text-sm text-muted">{next.reason}</div>
        </div>
        <Link to={to}>
          <Button variant="primary" size="lg">Start <ArrowRight className="h-4 w-4" /></Button>
        </Link>
      </CardBody>
    </Card>
  );
}

function SkillTile({ s }: { s: any }) {
  const objective = s.measure === "objective_accuracy";
  return (
    <Link to={practiceLink(s.skill)} className="block">
      <Card className="h-full transition-colors hover:border-accent/40">
        <CardBody className="pt-4">
          <div className="flex items-center justify-between">
            <SkillBadge skill={s.skill} />
            <span className="text-[12px] text-muted">{s.attempts} attempts</span>
          </div>
          <div className="mt-3 text-2xl font-semibold tabular-nums">
            {objective ? pct(s.recent_accuracy) : s.recent_ai_level != null ? `≈ ${s.recent_ai_level}` : "—"}
          </div>
          <div className="text-[12px] text-muted">
            {objective ? "recent practice accuracy (answer key)" : "recent unofficial AI-estimated level"}
          </div>
          {s.improvement != null && (
            <div className={cx("mt-1 text-[12px] font-medium", s.improvement >= 0 ? "text-good" : "text-bad")}>
              {s.improvement >= 0 ? "▲" : "▼"} {Math.abs(s.improvement)} index pts since first attempts
            </div>
          )}
          {s.scored_attempts === 0 && <div className="mt-1 text-[12px] text-warn">Not measured yet</div>}
        </CardBody>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { data: d, error, isLoading, refetch } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/api/dashboard") });
  if (isLoading) return <Spinner label="Loading your dashboard…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!d) return null;
  const plan = d.plan;
  const done = plan.sessions.filter((x: any) => x.status === "completed").length;
  const trend = d.readiness_trend.map((r: any) => ({ ...r, label: fmtDate(r.week) }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good {greeting()} — here's your plan</h1>
          <p className="mt-1 text-sm text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Exam</div>
            <div className="text-sm font-semibold">{fmtDate(d.exam_date, { month: "long", day: "numeric", year: "numeric" })}</div>
          </div>
          <div className="text-right">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Days left</div>
            <div className="text-3xl font-semibold tabular-nums leading-none">{d.days_remaining}</div>
          </div>
        </div>
      </div>

      <NextUp next={d.next} plan={plan} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            icon={<CalendarDays className="h-4 w-4" />}
            title="Today's modules"
            subtitle={`${done}/${plan.sessions.length} completed · ${plan.total_minutes} min budget`}
            action={<Link to="/today" className="text-[13px] text-accent">Open plan</Link>}
          />
          <CardBody className="space-y-2">
            <Progress value={plan.completion} />
            {plan.sessions.map((s: any) => (
              <Link key={s.id} to={practiceLink(s.skill, s.question?.id, s.id)} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-subtle">
                {s.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{s.title}</div>
                  <div className="truncate text-[12.5px] text-muted">{s.question?.title ?? "No question available"} · {s.duration_min} min{s.template ? ` · ${s.template.name}` : ""}</div>
                </div>
                <Badge tone={s.status === "completed" ? "good" : s.status === "in_progress" ? "accent" : "neutral"}>{s.status.replace("_", " ")}</Badge>
              </Link>
            ))}
            {d.carry_over.length > 0 && (
              <p className="pt-1 text-[12.5px] text-warn">
                {d.carry_over.length} unfinished module(s) from earlier days — <Link to="/today" className="underline">resume them</Link>.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<Gauge className="h-4 w-4" />} title="Readiness indicator" subtitle="Heuristic toward the Level 12 target — not a probability" />
          <CardBody className="space-y-3">
            <div className="text-3xl font-semibold tabular-nums">{d.readiness.overall}<span className="text-base text-muted">/100</span></div>
            {SKILLS.map((sk) => (
              <div key={sk}>
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span>{SKILL_LABEL[sk]}</span>
                  <span className="tabular-nums text-muted">{d.readiness.skills[sk].readiness}</span>
                </div>
                <Progress value={d.readiness.skills[sk].readiness / 100} color={SKILL_COLOR_VAR[sk]} />
              </div>
            ))}
            <Link to="/analytics" className="block text-[12.5px] text-accent">How this is calculated →</Link>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SKILLS.map((sk) => <SkillTile key={sk} s={d.skills[sk]} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<Target className="h-4 w-4" />} title="Performance trend" subtitle="Weekly performance index per skill (accuracy % for L/R; AI level ÷ 12 for W/S). Internal heuristic." />
          <CardBody>
            {trend.length < 2 ? (
              <Empty title="Not enough data yet">Complete practice across at least two weeks to see a trend.</Empty>
            ) : (
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "rgb(var(--panel))", border: "1px solid rgb(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {SKILLS.map((sk) => (
                      <Line key={sk} type="monotone" dataKey={sk} name={SKILL_LABEL[sk]} stroke={SKILL_COLOR_VAR[sk]} strokeWidth={2} dot={{ r: 4 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Flame className="h-4 w-4" />} title="This week" subtitle="Days with practice or reviews" />
          <CardBody>
            <div className="flex justify-between gap-1">
              {d.week.map((w: any) => (
                <div key={w.date} className="flex flex-1 flex-col items-center gap-1" title={`${w.date}${w.studied ? ": studied" : ""}`}>
                  <div className={cx("h-9 w-full rounded-md", w.studied ? "bg-accent" : w.planned ? "bg-subtle" : "bg-subtle/40")} />
                  <span className="text-[11px] text-muted">{new Date(w.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] text-muted">Vocabulary due</div>
                <div className="text-xl font-semibold tabular-nums">{d.vocab.due}</div>
              </div>
              <div>
                <div className="text-[12px] text-muted">New words waiting</div>
                <div className="text-xl font-semibold tabular-nums">{d.vocab.new_unreviewed}</div>
              </div>
            </div>
            <Link to="/vocabulary?tab=review"><Button variant="outline" size="sm" className="mt-3 w-full"><BookA className="h-4 w-4" />Review vocabulary</Button></Link>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Sparkles className="h-4 w-4" />} title="Recent evaluations" />
          <CardBody className="space-y-2">
            {d.recent_evaluations.length === 0 && <p className="text-sm text-muted">No evaluations yet. Submit a writing or speaking response to get AI feedback.</p>}
            {d.recent_evaluations.map((e: any) => (
              <Link key={e.id} to={`/attempts/${e.attempt_id}`} className="block rounded-lg border border-border p-3 hover:bg-subtle">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium"><SkillBadge skill={e.skill} />{e.task_name}</span>
                  {e.kind === "objective" ? <Badge>{pct(e.accuracy)} accuracy</Badge> : e.kind === "ai_rubric" ? <LevelPill level={e.estimated_level} label="AI est." /> : <Badge>AI explanation</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{e.summary}</p>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<TriangleAlert className="h-4 w-4" />} title="Most common mistakes" action={<Link to="/mistakes" className="text-[13px] text-accent">Journal</Link>} />
          <CardBody className="space-y-2">
            {d.top_mistakes.length === 0 && <p className="text-sm text-muted">Recurring mistakes from your evaluations will be tracked here.</p>}
            {d.top_mistakes.map((m: any) => (
              <Link key={m.id} to={`/mistakes?item=${m.id}`} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-subtle">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{m.pattern}</div>
                  <div className="text-[12px] text-muted">{CATEGORY_LABEL(m.category)} · {SKILL_LABEL[m.skill] ?? m.skill}</div>
                </div>
                <Badge tone={m.status === "improving" ? "accent" : "warn"}>×{m.occurrence_count}</Badge>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
      <p className="text-[12px] text-muted">{d.scoring_note}</p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

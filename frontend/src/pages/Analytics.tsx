import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { CalendarHeatmap, ChartFrame, DataTable, SimpleBars, SkillLines, WeeklySkillLines } from "../components/analytics/charts";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Empty, ErrorBox, Input, Label, Notice, PageHeader, Progress, SkillBadge, Spinner, Stat } from "../components/ui";
import { api } from "../lib/api";
import { CATEGORY_LABEL, fmtDate, pct, SKILLS, SKILL_COLOR_VAR, SKILL_LABEL } from "../lib/util";

const OBJECTIVE = ["listening", "reading"];

function SkillCard({ s }: { s: any }) {
  const objective = OBJECTIVE.includes(s.skill);
  const byTask = Object.entries(s.by_task ?? {}) as [string, any][];
  const qtypes = Object.entries(s.accuracy_by_qtype ?? {}) as [string, any][];
  const fmtImp = (v: number | null) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${objective ? `${v.toFixed(0)} pts` : (v * 12 / 100).toFixed(1) + " lvl"}`);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><SkillBadge skill={s.skill} />{SKILL_LABEL[s.skill]}</span>} subtitle={`Target: Level ${s.target_level}`} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Attempts" value={s.attempts} hint={`${s.scored_attempts} scored`} />
          <Stat label="Modules done" value={s.completion_rate === null ? "—" : pct(s.completion_rate)} hint={`${s.modules_completed}/${s.modules_planned} planned`} />
          {objective ? (
            <Stat label="Recent accuracy" value={pct(s.recent_accuracy)} hint="Objective, last 5" />
          ) : (
            <Stat label="Recent AI level" value={s.recent_ai_level ?? "—"} hint="Unofficial estimate, last 5" />
          )}
          <Stat label="First → recent" value={fmtImp(s.improvement)} hint={s.improvement === null ? "Needs 4+ scored attempts" : "vs first 3 attempts"} />
        </div>
        {byTask.length > 0 && (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-muted">
              <tr><th className="border-b border-border py-1.5 font-medium">Task</th><th className="border-b border-border py-1.5 text-right font-medium">Attempts</th><th className="border-b border-border py-1.5 text-right font-medium">{objective ? "Avg accuracy" : "Avg AI level"}</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {byTask.sort(([a], [b]) => a.localeCompare(b)).map(([k, t]) => (
                <tr key={k}>
                  <td className="border-b border-border/60 py-1.5">{k} · {t.task_name}</td>
                  <td className="border-b border-border/60 py-1.5 text-right">{t.attempts}</td>
                  <td className="border-b border-border/60 py-1.5 text-right">{t.avg_index === null ? "—" : objective ? `${t.avg_index.toFixed(0)}%` : (t.avg_index * 12 / 100).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {objective && qtypes.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Accuracy by question type</div>
            <div className="space-y-1.5">
              {qtypes.sort((a, b) => (a[1].accuracy ?? 0) - (b[1].accuracy ?? 0)).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-[12.5px]">
                  <span className="w-32 shrink-0">{CATEGORY_LABEL(k)}</span>
                  <Progress value={v.accuracy ?? 0} color={SKILL_COLOR_VAR[s.skill]} />
                  <span className="w-24 shrink-0 text-right tabular-nums text-muted">{pct(v.accuracy)} ({v.correct}/{v.total})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.attempts === 0 && <p className="text-[13px] text-muted">No attempts yet — complete a {SKILL_LABEL[s.skill].toLowerCase()} task to start tracking.</p>}
      </CardBody>
    </Card>
  );
}

function Readiness({ r }: { r: any }) {
  return (
    <Card>
      <CardHeader title="Readiness against the Level 12 target" subtitle="A transparent planning heuristic — not a probability of any score." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SKILLS.map((sk) => {
            const x = r.skills[sk];
            return (
              <div key={sk} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <SkillBadge skill={sk} />
                  <span className="text-xl font-semibold tabular-nums">{x.readiness.toFixed(0)}</span>
                </div>
                <Progress className="mt-2" value={x.readiness / 100} color={SKILL_COLOR_VAR[sk]} />
                <dl className="mt-2 space-y-0.5 text-[12px] text-muted">
                  <div className="flex justify-between"><dt>Recent performance (60%)</dt><dd className="tabular-nums">{x.components.recent_performance.toFixed(0)}</dd></div>
                  <div className="flex justify-between"><dt>Consistency (20%)</dt><dd className="tabular-nums">{x.components.consistency.toFixed(0)}</dd></div>
                  <div className="flex justify-between"><dt>Practice volume (20%)</dt><dd className="tabular-nums">{x.components.practice_volume.toFixed(0)}</dd></div>
                </dl>
                {!x.has_data && <p className="mt-1 text-[11.5px] text-warn">No scored attempts yet</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>Overall {r.overall.toFixed(0)} / 100</span>
          <span className="text-muted">· weakest: {SKILL_LABEL[r.weakest]}</span>
        </div>
        <p className="flex gap-2 rounded-lg bg-subtle p-3 text-[12.5px] text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.formula}</p>
      </CardBody>
    </Card>
  );
}

function OfficialScores({ rows }: { rows: any[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>({ test_date: "", listening: "", reading: "", writing: "", speaking: "", notes: "" });
  const [del, setDel] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api.post("/api/official-scores", {
        test_date: f.test_date,
        notes: f.notes,
        ...Object.fromEntries(SKILLS.map((s) => [s, f[s] === "" ? null : Number(f[s])])),
      }),
    onSuccess: () => {
      setF({ test_date: "", listening: "", reading: "", writing: "", speaking: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/official-scores/${id}`),
    onSuccess: () => { setDel(null); qc.invalidateQueries({ queryKey: ["analytics"] }); },
  });
  return (
    <Card>
      <CardHeader title="Official results (entered by you)" subtitle="Your actual CELPIP score reports. Kept separate from practice accuracy and AI estimates; never calculated by the app." />
      <CardBody className="space-y-4">
        {rows.length ? (
          <table className="w-full text-[13px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="border-b border-border py-1.5 font-medium">Test date</th>
                {SKILLS.map((s) => <th key={s} className="border-b border-border py-1.5 text-right font-medium">{SKILL_LABEL[s]}</th>)}
                <th className="border-b border-border py-1.5 font-medium">Notes</th><th className="border-b border-border" />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="border-b border-border/60 py-1.5">{fmtDate(o.test_date, { year: "numeric", month: "short", day: "numeric" })}</td>
                  {SKILLS.map((s) => <td key={s} className="border-b border-border/60 py-1.5 text-right">{o[s] ?? "—"}</td>)}
                  <td className="border-b border-border/60 py-1.5 text-muted">{o.notes}</td>
                  <td className="border-b border-border/60 py-1.5 text-right">
                    <button className="rounded p-1 text-muted hover:text-bad" aria-label="Delete official result" onClick={() => setDel(o.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-muted">No official results entered.</p>
        )}
        <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="lg:col-span-1"><Label>Test date</Label><Input type="date" required value={f.test_date} onChange={(e) => setF({ ...f, test_date: e.target.value })} /></div>
          {SKILLS.map((s) => (
            <div key={s}><Label>{SKILL_LABEL[s]}</Label><Input type="number" min={0} max={12} value={f[s]} onChange={(e) => setF({ ...f, [s]: e.target.value })} /></div>
          ))}
          <div><Label hint="optional">Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          <div className="flex items-end"><Button type="submit" variant="outline" loading={add.isPending}>Add result</Button></div>
        </form>
        {add.error && <ErrorBox error={add.error} />}
      </CardBody>
      <ConfirmModal open={del !== null} onClose={() => setDel(null)} onConfirm={() => del !== null && remove.mutate(del)} loading={remove.isPending} title="Delete this official result?" message="This removes the entry you recorded." confirmText="Delete" />
    </Card>
  );
}

export default function AnalyticsPage() {
  const { data: a, isLoading, error } = useQuery({ queryKey: ["analytics"], queryFn: () => api.get("/api/analytics") });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!a) return null;

  type Pt = { x: number; y: number; date: string; task: string };
  const trendSeries = (skills: string[], conv: (v: number) => number): { skill: string; points: Pt[] }[] =>
    skills
      .map((sk) => ({ skill: sk, points: (a.skills[sk].trend ?? []).map((p: any, i: number): Pt => ({ x: i + 1, y: conv(p.value), date: p.date, task: p.task_type })) }))
      .filter((s) => s.points.length);
  const objSeries = trendSeries(OBJECTIVE, (v) => v);
  const aiSeries = trendSeries(["writing", "speaking"], (v) => Math.round((v * 12) / 100 * 10) / 10);
  const mistakes: Record<string, number> = {};
  Object.values(a.mistake_categories as Record<string, Record<string, number>>).forEach((m) =>
    Object.entries(m).forEach(([k, v]) => (mistakes[k] = (mistakes[k] ?? 0) + v)),
  );
  const mistakeRows = Object.entries(mistakes).map(([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count);
  const tm = a.template_mastery;
  const tmTotal = Object.values(tm as Record<string, number>).reduce((s, v) => s + v, 0);
  const totalAttempts = SKILLS.reduce((s, sk) => s + a.skills[sk].attempts, 0);
  const TM_STEPS: [string, string, string][] = [
    ["learning", "Learning", "rgb(var(--c-listening) / 0.3)"],
    ["practicing", "Practicing", "rgb(var(--c-listening) / 0.6)"],
    ["mastered", "Mastered", "rgb(var(--c-listening))"],
    ["needs_revision", "Needs revision", "rgb(var(--warn))"],
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={<BarChart3 className="h-6 w-6 text-accent" />} title="Progress Analytics" subtitle="Everything here is computed from your saved practice data." />
      <div className="grid gap-2 md:grid-cols-3">
        <Notice><strong>Objective accuracy. </strong>{a.notes.objective}</Notice>
        <Notice><strong>AI estimates. </strong>{a.notes.ai}</Notice>
        <Notice><strong>Official results. </strong>{a.notes.official}</Notice>
      </div>

      <Readiness r={a.readiness} />

      {totalAttempts === 0 && (
        <Empty icon={<BarChart3 className="h-6 w-6" />} title="No practice data yet">Charts fill in as you submit practice. Start with today's study plan.</Empty>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Listening & reading — objective accuracy"
          subtitle="Per attempt, % correct against the answer key"
          table={<DataTable head={["Skill", "#", "Date", "Task", "Accuracy"]} rows={objSeries.flatMap((s) => s.points.map((p) => [SKILL_LABEL[s.skill], p.x, fmtDate(p.date), p.task, `${p.y.toFixed(0)}%`]))} />}
        >
          {objSeries.length ? <SkillLines series={objSeries} yDomain={[0, 100]} yFmt={(v) => `${v.toFixed(0)}%`} yLabel="Accuracy" /> : <p className="py-10 text-center text-[13px] text-muted">No scored listening or reading attempts yet.</p>}
        </ChartFrame>
        <ChartFrame
          title="Writing & speaking — AI-estimated level"
          subtitle="Per evaluated attempt, unofficial estimate on the 0–12 scale"
          table={<DataTable head={["Skill", "#", "Date", "Task", "Level"]} rows={aiSeries.flatMap((s) => s.points.map((p) => [SKILL_LABEL[s.skill], p.x, fmtDate(p.date), p.task, p.y]))} />}
        >
          {aiSeries.length ? <SkillLines series={aiSeries} yDomain={[0, 12]} yFmt={(v) => `${Number.isInteger(v) ? v : v.toFixed(1)}`} yLabel="AI level" /> : <p className="py-10 text-center text-[13px] text-muted">No AI-evaluated writing or speaking attempts yet.</p>}
        </ChartFrame>
      </div>

      <ChartFrame
        title="Weekly performance index"
        subtitle="Readiness trend: weekly average of the planning index (accuracy % for L/R; AI level ÷ 12 × 100 for W/S). A heuristic, not a score."
        table={<DataTable head={["Week", ...SKILLS.map((s) => SKILL_LABEL[s])]} rows={a.readiness_trend.map((r: any) => [fmtDate(r.week), ...SKILLS.map((s) => r[s])])} />}
      >
        {a.readiness_trend.length ? <WeeklySkillLines data={a.readiness_trend} /> : <p className="py-10 text-center text-[13px] text-muted">Weekly trends appear after your first scored attempts.</p>}
      </ChartFrame>

      <ChartFrame title="Study calendar" subtitle="Practice attempts and completed modules per day, last 120 days">
        <CalendarHeatmap data={a.calendar} />
      </ChartFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Weekly consistency" subtitle="Days studied per week (last 12 weeks)" table={<DataTable head={["Week", "Days"]} rows={a.weekly_consistency.map((w: any) => [fmtDate(w.week), w.days_studied])} />}>
          <SimpleBars data={a.weekly_consistency} x="week" y="days_studied" name="Days studied" xFmt={(w) => fmtDate(w)} yMax={7} />
        </ChartFrame>
        <ChartFrame title="Monthly consistency" subtitle="Days studied per month" table={<DataTable head={["Month", "Days"]} rows={a.monthly_consistency.map((m: any) => [m.month, m.days_studied])} />}>
          {a.monthly_consistency.length ? <SimpleBars data={a.monthly_consistency} x="month" y="days_studied" name="Days studied" /> : <p className="py-10 text-center text-[13px] text-muted">No study days recorded yet.</p>}
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Recurring mistakes by category" subtitle="Total occurrences across all skills" table={<DataTable head={["Category", "Occurrences"]} rows={mistakeRows.map((m) => [CATEGORY_LABEL(m.category), m.count])} />}>
          {mistakeRows.length ? <SimpleBars data={mistakeRows} x="category" y="count" name="Occurrences" horizontal xFmt={(c) => CATEGORY_LABEL(String(c))} color="rgb(var(--c-speaking))" /> : <p className="py-10 text-center text-[13px] text-muted">No mistakes recorded yet — they are added automatically from evaluations.</p>}
        </ChartFrame>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Template mastery" subtitle={`${tmTotal} templates`} />
            <CardBody>
              <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Template mastery distribution">
                {TM_STEPS.map(([k, , c]) => (tm[k] ? <div key={k} style={{ width: `${(tm[k] / Math.max(1, tmTotal)) * 100}%`, background: c }} title={`${k}: ${tm[k]}`} /> : null))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
                {TM_STEPS.map(([k, label, c]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                    <span className="text-muted">{label}</span>
                    <span className="ml-auto font-medium tabular-nums">{tm[k]}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Vocabulary learned & retained" />
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Saved" value={a.vocab.total} />
                <Stat label="Retained" value={a.vocab.retained} hint="Familiar + mastered" />
                <Stat label="Used in own work" value={a.vocab.used_in_own_work} hint="Active use" />
                <Stat label="Due now" value={a.vocab.due} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                {Object.entries(a.vocab.by_status as Record<string, number>).map(([k, v]) => <Badge key={k}>{CATEGORY_LABEL(k)}: {v}</Badge>)}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {SKILLS.map((sk) => <SkillCard key={sk} s={a.skills[sk]} />)}
      </div>

      <Card>
        <CardHeader title="Mock exam results" subtitle="Practice mocks only — objective accuracy and unofficial AI estimates." />
        <CardBody>
          {a.mock_results.length ? (
            <DataTable
              head={["Date", "Mock", "Section", "Objective", "AI-estimated level"]}
              rows={a.mock_results.map((m: any) => [
                fmtDate(m.date),
                `#${m.mock_exam_id}`,
                SKILL_LABEL[m.skill],
                m.objective_total ? `${m.objective_correct}/${m.objective_total} (${pct(m.objective_correct / m.objective_total)})` : "—",
                m.ai_estimated_level ?? "—",
              ])}
            />
          ) : (
            <p className="text-[13px] text-muted">No completed mock exams yet.</p>
          )}
        </CardBody>
      </Card>

      <OfficialScores rows={a.official_scores} />
    </div>
  );
}

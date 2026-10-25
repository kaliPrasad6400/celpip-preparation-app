import { ReactNode, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtDate, SKILL_COLOR_VAR, SKILL_LABEL } from "../../lib/util";

// Chart chrome comes from the app's theme tokens so light/dark both work.
export const AXIS = { stroke: "rgb(var(--border))", tick: { fill: "rgb(var(--muted))", fontSize: 12 }, tickLine: false };
export const GRID = { stroke: "rgb(var(--border))", strokeDasharray: "0", vertical: false, strokeOpacity: 0.6 };

export function ChartTooltip({ active, payload, label, fmt, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-[12.5px] shadow-lg">
      <div className="mb-1 font-medium">{labelFmt ? labelFmt(label, payload) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{fmt ? fmt(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function LegendRow({ payload }: any) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {(payload ?? []).map((p: any) => (
        <span key={p.value} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          {p.value}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({ title, subtitle, children, table }: { title: string; subtitle?: ReactNode; children: ReactNode; table?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="rounded-xl border border-border bg-panel p-5">
      <figcaption className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
        </div>
        {table && (
          <button className="shrink-0 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-subtle hover:text-fg" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </figcaption>
      {showTable && table ? <div className="max-h-72 overflow-auto">{table}</div> : children}
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number | null | undefined)[][] }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-muted"><tr>{head.map((h) => <th key={h} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
      <tbody className="tabular-nums">
        {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-border/60 px-2 py-1.5">{c ?? "—"}</td>)}</tr>)}
      </tbody>
    </table>
  );
}

/** Multi-series line by attempt sequence. Each skill keeps its own colour; one y-scale per chart. */
export function SkillLines({
  series, yDomain, yFmt, yLabel, height = 240,
}: { series: { skill: string; points: { x: number; y: number; date: string; task: string }[] }[]; yDomain: [number, number]; yFmt: (v: number) => string; yLabel: string; height?: number }) {
  const maxN = Math.max(0, ...series.map((s) => s.points.length));
  const rows = Array.from({ length: maxN }, (_, i) => {
    const r: any = { n: i + 1 };
    series.forEach((s) => {
      const p = s.points[i];
      if (p) { r[s.skill] = p.y; r[`${s.skill}_meta`] = `${fmtDate(p.date)} · ${p.task}`; }
    });
    return r;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="n" {...AXIS} label={{ value: "Attempt sequence", position: "insideBottom", offset: -2, fill: "rgb(var(--muted))", fontSize: 11 }} height={36} />
        <YAxis domain={yDomain} {...AXIS} tickFormatter={yFmt} width={44} aria-label={yLabel} />
        <Tooltip
          cursor={{ stroke: "rgb(var(--muted))", strokeDasharray: "3 3" }}
          content={<ChartTooltip fmt={(v: number, p: any) => `${yFmt(v)}  (${p.payload[`${p.dataKey}_meta`] ?? ""})`} labelFmt={(l: number) => `Attempt ${l}`} />}
        />
        {series.length > 1 && <Legend content={<LegendRow />} />}
        {series.map((s) => (
          <Line
            key={s.skill}
            type="monotone"
            dataKey={s.skill}
            name={SKILL_LABEL[s.skill]}
            stroke={SKILL_COLOR_VAR[s.skill]}
            strokeWidth={2}
            dot={{ r: 3.5, strokeWidth: 2, stroke: "rgb(var(--panel))", fill: SKILL_COLOR_VAR[s.skill] }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--panel))" }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function WeeklySkillLines({ data, height = 240 }: { data: any[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="week" {...AXIS} tickFormatter={(w) => fmtDate(w)} />
        <YAxis domain={[0, 100]} {...AXIS} width={40} />
        <Tooltip cursor={{ stroke: "rgb(var(--muted))", strokeDasharray: "3 3" }} content={<ChartTooltip labelFmt={(w: string) => `Week of ${fmtDate(w)}`} fmt={(v: number) => v.toFixed(0)} />} />
        <Legend content={<LegendRow />} />
        {["listening", "reading", "writing", "speaking"].map((s) => (
          <Line key={s} type="monotone" dataKey={s} name={SKILL_LABEL[s]} stroke={SKILL_COLOR_VAR[s]} strokeWidth={2} connectNulls
            dot={{ r: 3.5, strokeWidth: 2, stroke: "rgb(var(--panel))", fill: SKILL_COLOR_VAR[s] }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({
  data, x, y, name, color = "rgb(var(--accent))", height = 200, xFmt, horizontal, yMax,
}: { data: any[]; x: string; y: string; name: string; color?: string; height?: number; xFmt?: (v: any) => string; horizontal?: boolean; yMax?: number }) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 20)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }} barCategoryGap={6}>
          <CartesianGrid {...GRID} horizontal={false} vertical />
          <XAxis type="number" {...AXIS} allowDecimals={false} />
          <YAxis type="category" dataKey={x} {...AXIS} width={150} tickFormatter={xFmt} />
          <Tooltip cursor={{ fill: "rgb(var(--subtle))" }} content={<ChartTooltip labelFmt={(l: string) => (xFmt ? xFmt(l) : l)} />} />
          <Bar dataKey={y} name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
            <LabelList dataKey={y} position="right" style={{ fill: "rgb(var(--muted))", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }} barCategoryGap="20%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey={x} {...AXIS} tickFormatter={xFmt} />
        <YAxis {...AXIS} allowDecimals={false} domain={[0, yMax ?? "auto"]} width={40} />
        <Tooltip cursor={{ fill: "rgb(var(--subtle))" }} content={<ChartTooltip labelFmt={(l: string) => (xFmt ? xFmt(l) : l)} />} />
        <Bar dataKey={y} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** GitHub-style study calendar: one hue, light → dark by activity. */
export function CalendarHeatmap({ data, days = 120 }: { data: { date: string; attempts: number; modules_completed: number }[]; days?: number }) {
  const byDate: Record<string, { attempts: number; modules_completed: number }> = {};
  data.forEach((d) => (byDate[d.date] = d));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // align to Monday
  const cells: { iso: string; v: number; m: number; future: boolean }[] = [];
  for (let d = new Date(start); d <= today || cells.length % 7 !== 0; d.setDate(d.getDate() + 1)) {
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const r = byDate[iso];
    cells.push({ iso, v: (r?.attempts ?? 0) + (r?.modules_completed ?? 0), m: r?.modules_completed ?? 0, future: d > today });
  }
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const level = (v: number) => (v === 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : v <= 5 ? 3 : 4);
  const alpha = [0, 0.3, 0.5, 0.75, 1];
  const [hover, setHover] = useState<string | null>(null);
  const hovered = hover ? cells.find((c) => c.iso === hover) : null;
  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label="Study activity calendar">
        <div className="mr-1 flex flex-col gap-[3px] text-[10px] text-muted">
          {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, i) => <span key={i} className="h-3 leading-3">{d}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {w.map((c) => (
              <span
                key={c.iso}
                onMouseEnter={() => setHover(c.iso)}
                onMouseLeave={() => setHover(null)}
                title={`${fmtDate(c.iso, { weekday: "short", month: "short", day: "numeric" })}: ${c.v} activities`}
                className="h-3 w-3 rounded-[3px]"
                style={{
                  background: c.future ? "transparent" : level(c.v) === 0 ? "rgb(var(--subtle))" : `rgb(var(--c-listening) / ${alpha[level(c.v)]})`,
                  outline: hover === c.iso ? "2px solid rgb(var(--fg))" : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
        <span className="tabular-nums">
          {hovered ? `${fmtDate(hovered.iso, { weekday: "short", month: "short", day: "numeric" })}: ${hovered.v - hovered.m} attempts, ${hovered.m} modules completed` : "Hover a day for details"}
        </span>
        <span className="flex items-center gap-1">
          Less
          {alpha.map((a, i) => <span key={i} className="h-3 w-3 rounded-[3px]" style={{ background: i === 0 ? "rgb(var(--subtle))" : `rgb(var(--c-listening) / ${a})` }} />)}
          More
        </span>
      </div>
    </div>
  );
}

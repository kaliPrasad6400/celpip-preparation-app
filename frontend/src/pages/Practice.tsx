import { useQuery } from "@tanstack/react-query";
import { BookOpen, ClipboardList, Headphones, Mic, PenLine, Timer } from "lucide-react";
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useFormat } from "../components/QuestionPicker";
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, pct, practiceLink, SKILL_LABEL, SKILLS } from "../lib/util";

const ICON: Record<string, ReactNode> = {
  listening: <Headphones className="h-5 w-5 text-listening" />,
  reading: <BookOpen className="h-5 w-5 text-reading" />,
  writing: <PenLine className="h-5 w-5 text-writing" />,
  speaking: <Mic className="h-5 w-5 text-speaking" />,
};

export default function PracticeHub() {
  const { data: format, isLoading } = useFormat();
  const { data: qs } = useQuery({ queryKey: ["questions", "all"], queryFn: () => api.get<any[]>("/api/questions") });
  const { data: recent } = useQuery({ queryKey: ["attempts", "recent"], queryFn: () => api.get<any[]>("/api/attempts?limit=8") });
  const counts: Record<string, { total: number; done: number }> = {};
  (qs ?? []).forEach((q) => {
    const c = (counts[q.task_type] ??= { total: 0, done: 0 });
    c.total += 1;
    if (q.attempt_count) c.done += 1;
  });
  if (isLoading || !format) return <Spinner />;
  return (
    <div>
      <PageHeader
        icon={<ClipboardList className="h-6 w-6 text-accent" />}
        title="Practice"
        subtitle={`Every task type in the CELPIP-General format (format checked ${format.checked_on}). All questions are original practice material, not official test content.`}
        actions={<Link to="/mock" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3.5 py-2 text-sm font-medium hover:bg-subtle"><Timer className="h-4 w-4" />Mock exams</Link>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {SKILLS.map((sk) => {
          const comp = format.components[sk];
          return (
            <Card key={sk}>
              <CardHeader
                icon={ICON[sk]}
                title={<Link to={practiceLink(sk)} className="hover:underline">{SKILL_LABEL[sk]}</Link>}
                subtitle={`${comp.tasks.length} ${sk === "writing" || sk === "speaking" ? "tasks" : "parts"} · about ${comp.minutes} min in the test`}
              />
              <CardBody>
                <ul className="divide-y divide-border">
                  {comp.tasks.map((t: any) => (
                    <li key={t.key}>
                      <Link to={`${practiceLink(sk)}`} className="flex items-center gap-3 py-2 text-[13.5px] hover:text-accent">
                        <Badge>{t.key}</Badge>
                        <span className="flex-1">{t.name}</span>
                        <span className="text-[12px] text-muted">
                          {t.questions ? `${t.questions} Qs · ` : ""}
                          {t.minutes ? `${t.minutes} min · ` : ""}
                          {t.prep ? `${t.selection ? "60s choose + " : ""}${t.prep}s prep / ${t.response}s · ` : ""}
                          {counts[t.key] ? `${counts[t.key].done}/${counts[t.key].total} tried` : "0 sets"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent attempts" />
        <CardBody>
          {!recent?.length && <p className="text-sm text-muted">Nothing yet — pick a skill above to start.</p>}
          <ul className="divide-y divide-border">
            {(recent ?? []).map((a) => (
              <li key={a.id}>
                <Link to={`/attempts/${a.id}`} className="flex flex-wrap items-center gap-3 py-2 text-[13.5px] hover:text-accent">
                  <Badge>{a.task_type}</Badge>
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="font-medium tabular-nums">{a.accuracy != null ? pct(a.accuracy) : a.estimated_level ? `≈ L${a.estimated_level}` : a.status}</span>
                  <span className="text-[12px] text-muted">{fmtDateTime(a.submitted_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <p className="mt-4 text-[12px] text-muted">{format.scoring_note}</p>
    </div>
  );
}

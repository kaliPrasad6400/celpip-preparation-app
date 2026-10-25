import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, qs } from "../lib/api";
import { cx, pct } from "../lib/util";
import { Badge, Button, Card, CardBody, CardHeader, Empty, ErrorBox, Select, Spinner } from "./ui";

export function useFormat() {
  return useQuery({ queryKey: ["format"], queryFn: () => api.get("/api/format"), staleTime: Infinity });
}

export default function QuestionPicker({ skill, onPick }: { skill: string; onPick: (id: number) => void }) {
  const qc = useQueryClient();
  const { data: format } = useFormat();
  const [taskType, setTaskType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["questions", skill, taskType, difficulty],
    queryFn: () => api.get<any[]>(`/api/questions${qs({ skill, task_type: taskType, difficulty })}`),
  });
  const { data: topics } = useQuery({ queryKey: ["topics-lite"], queryFn: () => api.get<any[]>("/api/topics?kind=scenario") });
  const [genTask, setGenTask] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [genDiff, setGenDiff] = useState("3");
  const gen = useMutation({
    mutationFn: () =>
      api.post("/api/questions/generate", {
        skill,
        task_type: genTask || format?.components[skill].tasks[0].key,
        topic_item_id: genTopic ? Number(genTopic) : null,
        difficulty: Number(genDiff),
        mode: "auto",
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      onPick(r.question.id);
    },
  });
  const tasks = format?.components[skill]?.tasks ?? [];
  const objective = skill === "listening" || skill === "reading";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={taskType} onChange={(e) => setTaskType(e.target.value)} aria-label="Task type">
          <option value="">All task types</option>
          {tasks.map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>)}
        </Select>
        <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Difficulty {d}</option>)}
        </Select>
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && <Empty title="No questions match these filters">Generate a new one below.</Empty>}
      {data && data.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {data.map((q) => (
            <button
              key={q.id}
              onClick={() => onPick(q.id)}
              className="flex items-start gap-3 rounded-xl border border-border bg-panel p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-subtle"
            >
              {q.attempt_count ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{q.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                  <Badge>{q.task_type}</Badge>
                  <span>Difficulty {q.difficulty}</span>
                  {q.topic_title && <span>· {q.topic_title}</span>}
                  {q.source_type === "ai_generated" && <Badge tone="warn">AI-generated</Badge>}
                  {q.source_type === "user" && <Badge tone="accent">Mine</Badge>}
                  {q.attempt_count > 0 && (
                    <span className={cx("ml-auto", "font-medium text-fg")}>
                      {objective ? `Last ${pct(q.last_accuracy)}` : q.last_level ? `Last ≈ L${q.last_level}` : `${q.attempt_count} attempt(s)`}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Generate a new practice question</span>}
          subtitle={
            objective
              ? "Uses AI (requires an API key). The answer key is created and stored before you attempt the question."
              : "With a topic, writing/speaking prompts can be composed offline from the topic library; otherwise AI is used."
          }
        />
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={genTask} onChange={(e) => setGenTask(e.target.value)} aria-label="Task to generate">
              {tasks.map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>)}
            </Select>
            <Select value={genTopic} onChange={(e) => setGenTopic(e.target.value)} aria-label="Topic" className="max-w-[260px]">
              <option value="">Any topic (AI chooses)</option>
              {(topics ?? []).map((t) => <option key={t.id} value={t.id}>{t.category} — {t.title}</option>)}
            </Select>
            <Select value={genDiff} onChange={(e) => setGenDiff(e.target.value)} aria-label="Difficulty">
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Difficulty {d}</option>)}
            </Select>
            <Button variant="primary" onClick={() => gen.mutate()} loading={gen.isPending}>Generate</Button>
          </div>
          {gen.isPending && <p className="mt-2 text-[13px] text-muted">Generating… AI generation can take up to a minute.</p>}
          {gen.error && <div className="mt-3"><ErrorBox error={gen.error} /></div>}
          <p className="mt-2 text-[12px] text-muted">Generated items are original practice material — never official, past or predicted CELPIP questions.</p>
        </CardBody>
      </Card>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, Flag, Plus, Search, Sparkles, WifiOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFormat } from "../components/QuestionPicker";
import {
  Badge, Button, Card, CardBody, CardHeader, Empty, ErrorBox, Input, Notice, PageHeader, Select, SkillBadge, Spinner, SourceBadge,
} from "../components/ui";
import { api, qs } from "../lib/api";
import { practiceLink, safeHtml, SKILLS, SKILL_LABEL } from "../lib/util";

const GROUPS: { value: string; label: string }[] = [
  { value: "", label: "All groups" },
  { value: "everyday", label: "Everyday Canadian life" },
  { value: "workplace", label: "Workplace & professional" },
  { value: "society", label: "Society & community issues" },
  { value: "reference", label: "Geography, history & institutions" },
  { value: "general", label: "General topics" },
];

function Disclaimer() {
  return (
    <Notice>
      Topics are <strong>preparation themes</strong> for realistic practice — not predictions of actual exam questions. CELPIP does not test
      Canadian history or civics; reference pages exist to build familiarity and confidence when Canadian references come up.
    </Notice>
  );
}

function TopicList() {
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const { data: cats } = useQuery({ queryKey: ["topic-categories"], queryFn: () => api.get<any[]>("/api/topic-categories") });
  const { data, isLoading, error } = useQuery({
    queryKey: ["topics", group, category, skill, difficulty, kind, q],
    queryFn: () => api.get<any[]>(`/api/topics${qs({ group, category_id: category, skill, difficulty, kind, q })}`),
  });
  const visibleCats = (cats ?? []).filter((c) => !group || c.group === group);
  const reset = () => { setGroup(""); setCategory(""); setSkill(""); setDifficulty(""); setKind(""); setQ(""); };
  return (
    <div className="space-y-4">
      <Disclaimer />
      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input className="pl-8" placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search topics" />
        </div>
        <Select value={group} onChange={(e) => { setGroup(e.target.value); setCategory(""); }} aria-label="Group">
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="max-w-[220px]">
          <option value="">All categories</option>
          {visibleCats.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>)}
        </Select>
        <Select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Skill">
          <option value="">Any skill</option>
          {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
        </Select>
        <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Difficulty {d}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Scenarios & reference</option>
          <option value="scenario">Practice scenarios</option>
          <option value="reference">Reference pages</option>
        </Select>
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && (
        <Empty icon={<Flag className="h-6 w-6" />} title="No topics match these filters" action={<Button variant="outline" onClick={reset}>Clear filters</Button>} />
      )}
      {data && data.length > 0 && (
        <>
          <p className="text-[13px] text-muted">{data.length} topic{data.length === 1 ? "" : "s"} · saved locally, available offline</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((t) => (
              <Link key={t.id} to={`/canada/${t.id}`} className="group flex flex-col rounded-xl border border-border bg-panel p-4 transition-colors hover:border-accent/50 hover:bg-subtle">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={t.kind === "reference" ? "accent" : "neutral"}>{t.kind === "reference" ? "Reference" : "Scenario"}</Badge>
                  <span className="text-[12px] text-muted">{t.category}</span>
                </div>
                <div className="text-[14.5px] font-medium group-hover:text-accent">{t.title}</div>
                <p className="mt-1 line-clamp-2 text-[13px] text-muted">{t.scenario}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[12px] text-muted">
                  <span>Difficulty {t.difficulty}</span>
                  <span>· {t.question_count} question{t.question_count === 1 ? "" : "s"}</span>
                  {t.practice_count > 0 && <span>· practised {t.practice_count}×</span>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VocabList({ topic }: { topic: any }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Record<number, string>>({});
  const save = useMutation({
    mutationFn: (index: number) => api.post(`/api/topics/${topic.id}/save-vocab`, { index }),
    onSuccess: (d, index) => {
      setSaved((s) => ({ ...s, [index]: d.duplicate ? "Already saved" : "Saved" }));
      qc.invalidateQueries({ queryKey: ["vocab"] });
    },
  });
  if (!topic.key_vocabulary?.length) return null;
  return (
    <Card>
      <CardHeader title="Key vocabulary in context" subtitle="Save words to your Vocabulary Vault for spaced repetition." />
      <CardBody>
        <div className="grid gap-2 md:grid-cols-2">
          {topic.key_vocabulary.map((v: any, i: number) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{v.term}</span>
                  {v.tone && <Badge>{v.tone}</Badge>}
                </div>
                {v.meaning && <p className="mt-0.5 text-muted">{v.meaning}</p>}
                {v.example && <p className="mt-0.5 italic">“{v.example}”</p>}
                {v.collocations?.length > 0 && <p className="mt-0.5 text-[12px] text-muted">Collocations: {v.collocations.join(", ")}</p>}
                {v.usage && <p className="mt-0.5 text-[12px] text-muted">{v.usage}</p>}
                {v.exercise && <p className="mt-1 rounded bg-subtle px-2 py-1 text-[12.5px]"><span className="font-medium">Try: </span>{v.exercise}</p>}
              </div>
              <Button size="sm" variant={saved[i] ? "ghost" : "outline"} disabled={!!saved[i] || save.isPending} onClick={() => save.mutate(i)} aria-label={`Save ${v.term} to Vocabulary Vault`}>
                {saved[i] ? <><Check className="h-3.5 w-3.5" />{saved[i]}</> : <><Plus className="h-3.5 w-3.5" />Save</>}
              </Button>
            </div>
          ))}
        </div>
        {save.error && <div className="mt-2"><ErrorBox error={save.error} /></div>}
      </CardBody>
    </Card>
  );
}

function GeneratePanel({ topic }: { topic: any }) {
  const qc = useQueryClient();
  const { data: format } = useFormat();
  const [selected, setSelected] = useState<string[]>(["W1", "S7"]);
  const [useAi, setUseAi] = useState(false);
  const [difficulty, setDifficulty] = useState(String(topic.difficulty ?? 3));
  const offline: string[] = topic.offline_tasks ?? [];
  const gen = useMutation({
    mutationFn: () => api.post(`/api/topics/${topic.id}/generate`, { task_types: selected, use_ai: useAi, difficulty: Number(difficulty) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topic", topic.id] });
      qc.invalidateQueries({ queryKey: ["questions"] });
    },
  });
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length >= 8 ? s : [...s, k]));
  const needsAi = selected.some((k) => useAi || !offline.includes(k));
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Generate exercises from this topic</span>}
        subtitle="One topic → practice across all four skills, varying audience, purpose and constraints. Up to 8 at a time."
      />
      <CardBody className="space-y-3">
        {format && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SKILLS.map((sk) => (
              <fieldset key={sk} className="rounded-lg border border-border p-3">
                <legend className="px-1"><SkillBadge skill={sk} /></legend>
                <div className="space-y-1">
                  {format.components[sk].tasks.map((t: any) => (
                    <label key={t.key} className="flex items-start gap-2 text-[13px]">
                      <input type="checkbox" className="mt-0.5" checked={selected.includes(t.key)} onChange={() => toggle(t.key)} />
                      <span>
                        <span className="font-medium">{t.key}</span> {t.name}
                        {offline.includes(t.key) && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-good"><WifiOff className="h-3 w-3" />offline</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Use AI for every task (otherwise offline composer where available)
          </label>
          <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty for AI generation">
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Difficulty {d}</option>)}
          </Select>
          <Button variant="primary" disabled={!selected.length} loading={gen.isPending} onClick={() => gen.mutate()}>
            Generate {selected.length} exercise{selected.length === 1 ? "" : "s"}
          </Button>
        </div>
        <p className="text-[12px] text-muted">
          {needsAi
            ? "Some selected tasks need AI (an API key in Settings). Listening/reading items get their answer key at generation time, before you attempt them."
            : "All selected tasks can be composed offline from this topic's audiences, purposes, details and viewpoints."}{" "}
          Generated items are original practice material, never predicted exam questions.
        </p>
        {gen.isPending && <p className="text-[13px] text-muted">Generating… AI items can take up to a minute each.</p>}
        {gen.error && <ErrorBox error={gen.error} />}
        {gen.data && (
          <div className="space-y-2">
            {gen.data.created.length > 0 && (
              <ul className="space-y-1 text-[13.5px]">
                {gen.data.created.map((c: any) => {
                  const sk = SKILLS.find((s) => format?.components[s].tasks.some((t: any) => t.key === c.task_type)) ?? "writing";
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <Check className="h-4 w-4 text-good" />
                      <Badge>{c.task_type}</Badge>
                      <Link className="text-accent underline" to={practiceLink(sk, c.id)}>{c.title}</Link>
                      <span className="text-[12px] text-muted">{c.method === "ai" ? "AI-generated" : "composed offline"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {gen.data.errors.length > 0 && (
              <ul className="space-y-1 text-[13px] text-bad">
                {gen.data.errors.map((e: any, i: number) => <li key={i}><strong>{e.task_type}:</strong> {e.error}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TopicDetail({ id }: { id: number }) {
  const nav = useNavigate();
  const { data: t, isLoading, error } = useQuery({ queryKey: ["topic", id], queryFn: () => api.get(`/api/topics/${id}`) });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!t) return null;
  const isRef = t.kind === "reference";
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => nav("/canada")}><ArrowLeft className="h-4 w-4" />All topics</Button>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={isRef ? "accent" : "neutral"}>{isRef ? "Reference page" : "Practice scenario"}</Badge>
          <Badge>{t.category?.name}</Badge>
          <Badge>Difficulty {t.difficulty}/5</Badge>
          <SourceBadge source={t.source_type} />
          {(t.skills ?? []).map((s: string) => <SkillBadge key={s} skill={s} />)}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        {t.scenario && <p className="mt-2 max-w-3xl text-[15px]">{t.scenario}</p>}
      </div>
      <Disclaimer />
      {t.background && (
        <Card><CardHeader title="Background" /><CardBody><p className="text-[14px] leading-relaxed">{t.background}</p></CardBody></Card>
      )}
      {isRef && t.content_html && (
        <Card><CardBody className="pt-5"><div className="prose-app" dangerouslySetInnerHTML={safeHtml(t.content_html)} /></CardBody></Card>
      )}
      {!isRef && (t.audiences?.length || t.purposes?.length || t.details?.length) ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[["Possible audiences", t.audiences], ["Communication purposes", t.purposes], ["Details & constraints", t.details]].map(([title, list]: any) =>
            list?.length ? (
              <Card key={title}>
                <CardHeader title={title} />
                <CardBody><ul className="list-disc space-y-1 pl-5 text-[13.5px]">{list.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></CardBody>
              </Card>
            ) : null,
          )}
        </div>
      ) : null}
      {t.viewpoints?.length > 0 && (
        <Card>
          <CardHeader title="Balanced viewpoints" subtitle="Practise arguing either side — CELPIP rewards well-supported reasoning, not a particular opinion." />
          <CardBody>
            <div className="grid gap-3 md:grid-cols-2">
              {t.viewpoints.map((v: any, i: number) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="text-[14px] font-semibold">{v.label}</div>
                  {v.argument && <p className="mt-1 text-[13.5px] text-muted">{v.argument}</p>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
      <VocabList topic={t} />
      {t.references?.length > 0 && (
        <Card>
          <CardHeader title="References" subtitle="External sources for further reading." />
          <CardBody>
            <ul className="space-y-1 text-[13.5px]">
              {t.references.map((r: any, i: number) => (
                <li key={i}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline">
                    {r.title || r.url}<ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title={`Practice questions on this topic (${t.questions?.length ?? 0})`} />
        <CardBody>
          {t.questions?.length ? (
            <ul className="divide-y divide-border">
              {t.questions.map((q: any) => (
                <li key={q.id}>
                  <Link to={practiceLink(q.skill, q.id)} className="flex flex-wrap items-center gap-2 py-2 text-[13.5px] hover:text-accent">
                    <SkillBadge skill={q.skill} />
                    <Badge>{q.task_type}</Badge>
                    <span className="flex-1">{q.title}</span>
                    {q.source_type === "ai_generated" && <Badge tone="warn">AI-generated</Badge>}
                    <span className="text-[12px] text-muted">Difficulty {q.difficulty}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No questions yet — generate some below.</p>
          )}
        </CardBody>
      </Card>
      <GeneratePanel topic={t} />
    </div>
  );
}

export default function CanadaPage() {
  const { id } = useParams();
  return (
    <div>
      {!id && (
        <PageHeader
          icon={<Flag className="h-6 w-6 text-bad" />}
          title="Canadian Context"
          subtitle="Everyday life, workplace communication, community issues and reference knowledge — each topic reusable across all four skills."
        />
      )}
      {id ? <TopicDetail id={Number(id)} /> : <TopicList />}
    </div>
  );
}

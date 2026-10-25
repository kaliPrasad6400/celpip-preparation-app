import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, Newspaper, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFormat } from "../components/QuestionPicker";
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Empty, ErrorBox, Input, Label, Notice, PageHeader, Select, Spinner, Tabs, Textarea,
} from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDate, fmtDateTime, practiceLink, SKILLS, wordCount } from "../lib/util";

const SOURCE_TYPES = ["news", "government", "statistics", "educational", "official_celpip"];

function Freshness({ f }: { f: string }) {
  if (f === "historical") return <Badge tone="warn">Historical (&gt;30 days)</Badge>;
  if (f === "unverified") return <Badge tone="bad">Unverified</Badge>;
  return <Badge tone="good">Retrieved</Badge>;
}

function AiLabel() {
  return <Badge tone="warn"><Sparkles className="h-3 w-3" />AI-generated interpretation of the publisher's summary</Badge>;
}

function Sources() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["sources"], queryFn: () => api.get<any[]>("/api/sources") });
  const [form, setForm] = useState({ name: "", url: "", feed_url: "", source_type: "news", description: "" });
  const [delId, setDelId] = useState<number | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.patch(`/api/sources/${id}?enabled=${enabled}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const add = useMutation({
    mutationFn: () => api.post("/api/sources", { ...form, feed_url: form.feed_url || null }),
    onSuccess: () => {
      setForm({ name: "", url: "", feed_url: "", source_type: "news", description: "" });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/sources/${id}`),
    onSuccess: () => { setDelId(null); qc.invalidateQueries({ queryKey: ["sources"] }); },
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="space-y-4">
      <Notice>
        Only permitted public feeds are read. The app stores the headline, publisher, date, link and the feed's own short summary — never full
        articles. Failures are recorded per source and never block the app.
      </Notice>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-2 py-2.5 font-medium">Type</th>
              <th className="px-2 py-2.5 font-medium">Feed</th>
              <th className="px-2 py-2.5 font-medium">Last success</th>
              <th className="px-2 py-2.5 font-medium">Status</th>
              <th className="px-2 py-2.5 font-medium">Enabled</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data ?? []).map((s) => (
              <tr key={s.id} className="align-top">
                <td className="px-4 py-2.5">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-accent">
                    {s.name}<ExternalLink className="h-3 w-3" />
                  </a>
                  {s.description && <div className="mt-0.5 max-w-sm text-[12px] text-muted">{s.description}</div>}
                </td>
                <td className="px-2 py-2.5"><Badge>{s.source_type.replace("_", " ")}</Badge></td>
                <td className="px-2 py-2.5 text-muted">{s.feed_url ? "RSS/Atom" : "Reference only"}</td>
                <td className="px-2 py-2.5 tabular-nums text-muted">{s.last_success_at ? fmtDateTime(s.last_success_at) : s.last_checked_on ? `Checked ${fmtDate(s.last_checked_on)}` : "—"}</td>
                <td className="px-2 py-2.5">
                  {s.last_error ? <span className="text-bad" title={s.last_error}>Error: {s.last_error.slice(0, 60)}</span> : s.last_success_at ? <span className="text-good">OK</span> : <span className="text-muted">—</span>}
                </td>
                <td className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${s.name}`}
                    checked={s.enabled}
                    onChange={(e) => toggle.mutate({ id: s.id, enabled: e.target.checked })}
                  />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button className="rounded p-1 text-muted hover:bg-subtle hover:text-bad" aria-label={`Delete ${s.name}`} onClick={() => setDelId(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Add a source" subtitle="Use reputable public sources that publish an RSS/Atom feed. Respect each site's terms of use." />
        <CardBody>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
          >
            <div><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Type</Label>
              <Select className="w-full" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </Select>
            </div>
            <div><Label>Website URL</Label><Input required type="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
            <div><Label hint="optional">Feed URL</Label><Input type="url" placeholder="https://…/rss" value={form.feed_url} onChange={(e) => setForm({ ...form, feed_url: e.target.value })} /></div>
            <div className="md:col-span-2"><Label hint="optional">Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="md:col-span-2"><Button type="submit" variant="primary" loading={add.isPending}><Plus className="h-4 w-4" />Add source</Button></div>
          </form>
          {add.error && <div className="mt-3"><ErrorBox error={add.error} /></div>}
        </CardBody>
      </Card>
      <ConfirmModal
        open={delId !== null}
        onClose={() => setDelId(null)}
        onConfirm={() => delId !== null && del.mutate(delId)}
        loading={del.isPending}
        title="Delete source?"
        message="The source is removed from the registry. Items already retrieved from it are kept."
        confirmText="Delete"
      />
    </div>
  );
}

function ItemList() {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const { data: cats } = useQuery({ queryKey: ["topic-categories"], queryFn: () => api.get<any[]>("/api/topic-categories") });
  const { data: sources } = useQuery({ queryKey: ["sources"], queryFn: () => api.get<any[]>("/api/sources") });
  const { data, isLoading, error } = useQuery({
    queryKey: ["news", category, source],
    queryFn: () => api.get<any[]>(`/api/current-affairs${qs({ category_id: category, source_id: source })}`),
  });
  const refresh = useMutation({
    mutationFn: () => api.post("/api/current-affairs/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["news"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const catName = (id: number | null) => cats?.find((c) => c.id === id)?.name;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => refresh.mutate()} loading={refresh.isPending}><RefreshCw className="h-4 w-4" />Refresh feeds</Button>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {(sources ?? []).filter((s) => s.feed_url).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {refresh.error && <ErrorBox error={refresh.error} />}
      {refresh.data && (
        <Notice>
          Refresh complete:{" "}
          {Object.entries(refresh.data.added as Record<string, number>).map(([k, v]) => `${k}: ${v} new`).join(" · ") || "no enabled feeds"}.
          {(refresh.data.sources as any[]).filter((s) => s.last_error && s.enabled).length > 0 && " Some sources failed — see the Sources tab."}
        </Notice>
      )}
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && (
        <Empty icon={<Newspaper className="h-6 w-6" />} title="No current-affairs items saved yet">
          Press “Refresh feeds” while online. Retrieved items stay available offline.
        </Empty>
      )}
      {data && data.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {data.map((n) => (
              <li key={n.id}>
                <Link to={`/news/${n.id}`} className="block px-4 py-3 hover:bg-subtle">
                  <div className="text-[14.5px] font-medium">{n.headline}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    <span>{n.publisher}</span>
                    <span>· {n.published_at ? fmtDate(n.published_at, { year: "numeric", month: "short", day: "numeric" }) : "date not given"}</span>
                    <Freshness f={n.freshness} />
                    {catName(n.topic_category_id) && <Badge>{catName(n.topic_category_id)}</Badge>}
                    {n.ai_enriched && <Badge tone="accent">Study notes ready</Badge>}
                    {n.user_summary && <Badge tone="good">Summarized</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Step({ n, title, children, ai }: { n: number; title: string; children: React.ReactNode; ai?: boolean }) {
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/12 text-[12px] font-semibold text-accent">{n}</span>{title}</span>}
        action={ai ? <AiLabel /> : undefined}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function NewsDetail({ id }: { id: number }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: format } = useFormat();
  const { data: n, isLoading, error } = useQuery({ queryKey: ["news-item", id], queryFn: () => api.get(`/api/current-affairs/${id}`) });
  const [summary, setSummary] = useState<string | null>(null);
  const [evaluate, setEvaluate] = useState(true);
  const [taskType, setTaskType] = useState("W2");
  const [savedVocab, setSavedVocab] = useState<Record<number, string>>({});
  const enrich = useMutation({
    mutationFn: () => api.post(`/api/current-affairs/${id}/enrich`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["news-item", id] }),
  });
  const submitSummary = useMutation({
    mutationFn: () => api.post(`/api/current-affairs/${id}/summary`, { text: summary ?? n?.user_summary ?? "", evaluate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["news-item", id] }),
  });
  const exercise = useMutation({
    mutationFn: () => api.post(`/api/current-affairs/${id}/exercise`, { task_type: taskType }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["news-item", id] }),
  });
  const saveVocab = useMutation({
    mutationFn: ({ v }: { v: any; i: number }) =>
      api.post("/api/vocabulary", {
        term: v.term,
        meaning: v.meaning ?? "",
        example: v.example ?? "",
        collocations: v.collocations ?? [],
        formality: ["formal", "neutral", "informal"].includes(v.tone) ? v.tone : "neutral",
        context: n?.headline ?? "",
        tags: ["current-affairs"],
        source_type: "news",
        source_ref: (n?.headline ?? "").slice(0, 200),
      }),
    onSuccess: (d, { i }) => {
      setSavedVocab((s) => ({ ...s, [i]: d.duplicate ? "Already saved" : "Saved" }));
      qc.invalidateQueries({ queryKey: ["vocab"] });
    },
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!n) return null;
  const text = summary ?? n.user_summary ?? "";
  const facts: string[] = n.important_facts ?? [];
  const views: any[] = n.viewpoints ?? [];
  const questions: any[] = n.questions ?? [];
  const skillOf = (tt: string) => SKILLS.find((s) => format?.components[s].tasks.some((t: any) => t.key === tt)) ?? "writing";
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => nav("/news")}><ArrowLeft className="h-4 w-4" />All items</Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{n.headline}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span className="font-medium text-fg">{n.publisher}</span>
          <span>· published {n.published_at ? fmtDate(n.published_at, { year: "numeric", month: "long", day: "numeric" }) : "date not given in feed"}</span>
          <Freshness f={n.freshness ?? n.verification_status} />
          <span>· retrieved {fmtDateTime(n.retrieved_at)}</span>
          {n.last_verified_at && <span>· last verified in feed {fmtDateTime(n.last_verified_at)}</span>}
        </div>
      </div>
      <Notice tone="warn">
        News discussion exercises are <strong>not official CELPIP tasks</strong>. They build vocabulary and reasoning about real Canadian issues; the
        CELPIP-style exercise in step 7 follows the official task structure.
      </Notice>

      <Step n={1} title="Read the publisher's short summary">
        {n.feed_summary ? <p className="text-[15px] leading-relaxed">{n.feed_summary}</p> : <p className="text-[13px] text-muted">The feed supplied only a headline.</p>}
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13.5px] text-accent underline">
          Read the original article at {n.publisher}<ExternalLink className="h-3 w-3" />
        </a>
        <p className="mt-2 text-[12px] text-muted">Summary text is the publisher's own feed description. Full articles are not copied into the app.</p>
        {!n.ai_enriched && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => enrich.mutate()} loading={enrich.isPending}><Sparkles className="h-4 w-4" />Enrich with AI (vocabulary, issue, viewpoints, questions)</Button>
            <span className="text-[12px] text-muted">Needs an API key; works only from the summary above.</span>
          </div>
        )}
        {enrich.error && <div className="mt-2"><ErrorBox error={enrich.error} /></div>}
      </Step>

      {n.ai_enriched ? (
        <>
          <Step n={2} title="Learn the vocabulary" ai>
            {n.vocabulary?.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {n.vocabulary.map((v: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-border p-3 text-[13.5px]">
                    <div className="min-w-0">
                      <span className="font-semibold">{v.term}</span>
                      {v.tone && <Badge className="ml-1.5">{v.tone}</Badge>}
                      {v.meaning && <p className="mt-0.5 text-muted">{v.meaning}</p>}
                      {v.example && <p className="mt-0.5 italic">“{v.example}”</p>}
                      {v.collocations?.length > 0 && <p className="mt-0.5 text-[12px] text-muted">{v.collocations.join(", ")}</p>}
                    </div>
                    <Button size="sm" variant={savedVocab[i] ? "ghost" : "outline"} disabled={!!savedVocab[i]} onClick={() => saveVocab.mutate({ v, i })} aria-label={`Save ${v.term}`}>
                      {savedVocab[i] ? <><Check className="h-3.5 w-3.5" />{savedVocab[i]}</> : <><Plus className="h-3.5 w-3.5" />Save</>}
                    </Button>
                  </div>
                ))}
              </div>
            ) : <p className="text-[13px] text-muted">No vocabulary generated.</p>}
            {saveVocab.error && <div className="mt-2"><ErrorBox error={saveVocab.error} /></div>}
          </Step>
          <Step n={3} title="Identify the central issue" ai>
            <p className="text-[15px]">{n.main_issue || "—"}</p>
          </Step>
          <Step n={4} title="Arguments and supporting details" ai>
            {views.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {views.map((v, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-[13.5px]">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{v.holder}</span>
                      {v.type === "reported" ? <Badge tone="good">Reported in the summary</Badge> : <Badge>Possible perspective (not reported)</Badge>}
                    </div>
                    <p>{v.position}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-[13px] text-muted">No viewpoints identified.</p>}
          </Step>
          <Step n={5} title="Distinguish fact from opinion" ai>
            <div className="mb-2 text-[13px] font-medium">Facts stated in the publisher's summary</div>
            {facts.length ? <ul className="list-disc space-y-1 pl-5 text-[14px]">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="text-[13px] text-muted">The summary contains no clearly stated facts beyond the headline.</p>}
            {questions.filter((q) => q.kind === "fact_or_opinion" || q.kind === "comprehension").length > 0 && (
              <>
                <div className="mb-1 mt-3 text-[13px] font-medium">Check your understanding</div>
                <ul className="list-decimal space-y-1 pl-5 text-[14px]">
                  {questions.filter((q) => q.kind === "fact_or_opinion" || q.kind === "comprehension").map((q, i) => <li key={i}>{q.question}</li>)}
                </ul>
              </>
            )}
            {questions.filter((q) => q.kind === "discussion").length > 0 && (
              <>
                <div className="mb-1 mt-3 text-[13px] font-medium">Discussion prompts (good speaking practice)</div>
                <ul className="list-disc space-y-1 pl-5 text-[14px]">{questions.filter((q) => q.kind === "discussion").map((q, i) => <li key={i}>{q.question}</li>)}</ul>
              </>
            )}
          </Step>
        </>
      ) : (
        <Card><CardBody className="pt-5 text-[13.5px] text-muted">Steps 2–5 (vocabulary, central issue, arguments, fact vs opinion) appear after “Enrich with AI”. You can still summarize and generate an exercise below.</CardBody></Card>
      )}

      <Step n={6} title="Summarize the issue in your own words">
        <Textarea rows={5} value={text} onChange={(e) => setSummary(e.target.value)} placeholder="60–120 words: the central issue, who is affected, and the main viewpoints. Separate facts from opinions." />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-muted">{wordCount(text)} words</span>
          <label className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={evaluate} onChange={(e) => setEvaluate(e.target.checked)} /> Get AI feedback (step 8)
          </label>
          <Button variant="primary" onClick={() => submitSummary.mutate()} loading={submitSummary.isPending} disabled={text.trim().length < 20}>Save summary</Button>
        </div>
        {submitSummary.isPending && evaluate && <p className="mt-2 text-[13px] text-muted">Saving and evaluating… this can take up to a minute.</p>}
        {submitSummary.error && <div className="mt-2"><ErrorBox error={submitSummary.error} /></div>}
        {submitSummary.data && (
          <div className="mt-3">
            <Notice tone={submitSummary.data.error ? "warn" : "info"}>
              Summary saved.{" "}
              {submitSummary.data.evaluated
                ? <Link className="text-accent underline" to={`/attempts/${submitSummary.data.attempt_id}`}>Open your AI feedback →</Link>
                : submitSummary.data.error
                  ? <>AI feedback unavailable: {submitSummary.data.error} <Link className="text-accent underline" to={`/attempts/${submitSummary.data.attempt_id}`}>Open attempt</Link></>
                  : <Link className="text-accent underline" to={`/attempts/${submitSummary.data.attempt_id}`}>Open attempt</Link>}
            </Notice>
          </div>
        )}
      </Step>

      <Step n={7} title="Complete a CELPIP-style exercise on this issue">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={taskType} onChange={(e) => setTaskType(e.target.value)} aria-label="Task type">
            {SKILLS.flatMap((s) => (format?.components[s].tasks ?? []).map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.name}</option>))}
          </Select>
          <Button variant="outline" onClick={() => exercise.mutate()} loading={exercise.isPending}><Sparkles className="h-4 w-4" />Generate exercise</Button>
        </div>
        <p className="mt-2 text-[12px] text-muted">AI-generated original practice inspired by this issue, with neutral framing. It never adds facts beyond the summary and is not a predicted exam question.</p>
        {exercise.error && <div className="mt-2"><ErrorBox error={exercise.error} /></div>}
        {n.questions_generated?.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13.5px]">
            {n.questions_generated.map((q: any) => (
              <li key={q.id} className="flex items-center gap-2">
                <Badge>{q.task_type}</Badge>
                <Link className="text-accent underline" to={practiceLink(skillOf(q.task_type), q.id)}>{q.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step n={8} title="Review AI feedback">
        {n.summary_attempts?.length ? (
          <ul className="space-y-1 text-[13.5px]">
            {n.summary_attempts.map((a: any) => (
              <li key={a.id}>
                <Link className="text-accent underline" to={`/attempts/${a.id}`}>Summary attempt #{a.id}</Link>
                <span className="ml-2 text-muted">{fmtDateTime(a.submitted_at)} · {a.status}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted">Feedback on your summaries and exercises appears here and on each attempt page.</p>}
      </Step>
      <Step n={9} title="Save useful vocabulary and notes">
        <p className="text-[13.5px]">
          Use the Save buttons in step 2, and capture your own notes in the{" "}
          <Link className="text-accent underline" to="/notes">Notes Workspace</Link> (e.g. the “Canadian Context Notes” page).
        </p>
      </Step>
    </div>
  );
}

export default function NewsPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<"items" | "sources">("items");
  if (id) return <NewsDetail id={Number(id)} />;
  return (
    <div>
      <PageHeader
        icon={<Newspaper className="h-6 w-6 text-accent" />}
        title="Current Affairs Practice"
        subtitle="Learn from real, properly sourced Canadian news: read the summary, learn vocabulary, separate fact from opinion, summarize, and practise. News discussion exercises are not official CELPIP tasks."
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "items", label: "Saved items" }, { value: "sources", label: "Source registry" }]} />
      {tab === "items" ? <ItemList /> : <Sources />}
    </div>
  );
}

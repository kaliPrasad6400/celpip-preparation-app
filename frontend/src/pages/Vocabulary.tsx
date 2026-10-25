import { useQuery } from "@tanstack/react-query";
import { BookA, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Select, Spinner, Tabs } from "../components/ui";
import { ActiveUse, ConfidenceDots, Quiz, ReviewQueue, STATUSES, StatusBadge, VocabDetailModal, VocabFormModal } from "../components/vocab/VocabParts";
import { api, qs } from "../lib/api";
import { fmtDate, SKILLS, SKILL_LABEL } from "../lib/util";

type Tab = "vault" | "review" | "quiz" | "active";

export default function VocabularyPage() {
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item") ? Number(params.get("item")) : null;
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "vault");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [skill, setSkill] = useState("");
  const [tag, setTag] = useState("");
  const [form, setForm] = useState<{ open: boolean; item?: any }>({ open: false });

  useEffect(() => {
    const t = window.setTimeout(() => setDq(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data: all = [] } = useQuery({ queryKey: ["vocab", "list", "all"], queryFn: () => api.get<any[]>("/api/vocabulary") });
  const { data: items, isLoading, error } = useQuery({
    queryKey: ["vocab", "list", dq, status, skill, tag],
    queryFn: () => api.get<any[]>(`/api/vocabulary${qs({ q: dq, status, skill, tag })}`),
  });
  const { data: queue } = useQuery({ queryKey: ["vocab", "queue"], queryFn: () => api.get("/api/vocabulary/queue") });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });

  const tags = useMemo(() => Array.from(new Set(all.flatMap((v) => v.tags ?? []))).sort(), [all]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
    all.forEach((v) => (c[v.status] = (c[v.status] ?? 0) + 1));
    return c;
  }, [all]);
  const dueCount = (queue?.due?.length ?? 0) + (queue?.new?.length ?? 0);

  const openItem = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("item", String(id));
    else p.delete("item");
    setParams(p);
  };
  const changeTab = (t: Tab) => {
    setTab(t);
    const p = new URLSearchParams(params);
    p.set("tab", t);
    setParams(p, { replace: true });
  };

  return (
    <div>
      <PageHeader
        icon={<BookA className="h-6 w-6 text-accent" />}
        title="Vocabulary Vault"
        subtitle="Words and expressions from practice, evaluations and topics — reviewed with spaced repetition and tracked for active use."
        actions={<Button variant="primary" onClick={() => setForm({ open: true })}><Plus className="h-4 w-4" />Add word</Button>}
      />
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Card className="p-3"><div className="text-[12px] text-muted">Total</div><div className="text-xl font-semibold tabular-nums">{all.length}</div></Card>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatus(status === s ? "" : s); changeTab("vault"); }} className="text-left">
            <Card className={status === s ? "border-accent p-3" : "p-3 hover:bg-subtle"}>
              <div className="text-[12px] capitalize text-muted">{s}</div>
              <div className="text-xl font-semibold tabular-nums">{counts[s] ?? 0}</div>
            </Card>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={changeTab}
          tabs={[
            { value: "vault", label: "Vault" },
            { value: "review", label: <>Review {dueCount > 0 && <Badge tone="accent" className="ml-1">{dueCount}</Badge>}</> },
            { value: "quiz", label: "Quiz" },
            { value: "active", label: "Active use" },
          ]}
        />
        {settings && (
          <span className="text-[12px] text-muted">
            Spaced repetition: Again → tomorrow · Hard → same step · Good → next step · Easy → skip a step. Intervals (days): {settings.srs_intervals.join(", ")}
          </span>
        )}
      </div>

      {tab === "vault" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
              <Input className="pl-8" placeholder="Search words or meanings…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vocabulary" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </Select>
            <Select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Filter by skill">
              <option value="">All skills</option>
              {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
            </Select>
            <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </Select>
          </div>
          {isLoading && <Spinner />}
          {error ? <ErrorBox error={error} /> : null}
          {items && items.length === 0 && (
            <Empty icon={<BookA className="h-8 w-8" />} title={all.length ? "No items match these filters" : "Your vault is empty"}>
              Save words from AI evaluations, topic pages or news items with one click, or add them here.
            </Empty>
          )}
          {items && items.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-medium">Word / expression</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Meaning</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Confidence</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Next review</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((v) => (
                    <tr key={v.id} className="cursor-pointer hover:bg-subtle" onClick={() => openItem(v.id)}>
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-accent" onClick={(e) => { e.stopPropagation(); openItem(v.id); }}>{v.term}</button>
                        {v.part_of_speech && <span className="ml-1.5 text-[12px] text-muted">{v.part_of_speech}</span>}
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {(v.tags ?? []).slice(0, 3).map((t: string) => <span key={t} className="text-[11.5px] text-muted">#{t}</span>)}
                        </div>
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 text-muted md:table-cell"><span className="line-clamp-2">{v.meaning}</span></td>
                      <td className="px-3 py-2.5"><StatusBadge status={v.status} /></td>
                      <td className="hidden px-3 py-2.5 sm:table-cell"><ConfidenceDots value={v.confidence} /></td>
                      <td className="hidden px-3 py-2.5 text-muted lg:table-cell">{v.review_count ? fmtDate(v.due_date) : "New"}</td>
                      <td className="hidden px-3 py-2.5 tabular-nums text-muted lg:table-cell">{v.used_correctly_count}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
      {tab === "review" && <ReviewQueue />}
      {tab === "quiz" && <Quiz />}
      {tab === "active" && <ActiveUse items={all} onOpen={(id) => openItem(id)} />}

      <VocabDetailModal id={itemId} onClose={() => openItem(null)} onEdit={(item) => { setForm({ open: true, item }); openItem(null); }} />
      <VocabFormModal open={form.open} item={form.item} onClose={() => setForm({ open: false })} />
    </div>
  );
}

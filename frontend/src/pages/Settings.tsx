import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, KeyRound, Plug, Save, Settings as SettingsIcon, Trash2, XCircle } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { applyTheme } from "../components/Layout";
import DataPanel from "../components/settings/DataPanel";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmModal, ErrorBox, Input, Label, Notice, PageHeader, Select, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, SKILLS, SKILL_LABEL } from "../lib/util";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EDITABLE = [
  "exam_date", "target_levels", "daily_module_count", "daily_minutes", "study_days", "ai_provider", "ai_model", "mock_ai_provider", "mock_ai_model", "mock_model_for_speaking", "ai_effort",
  "ai_max_output_tokens", "ai_timeout_seconds", "ai_refusal_fallback", "daily_request_limit", "daily_spend_limit_usd",
  "feedback_strictness", "audio_retention", "transcription_mode", "listening_study_mode", "theme", "srs_intervals", "vocab_daily_new_limit",
] as const;

const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", gemini: "Google Gemini" };
const MODEL_HINT: Record<string, string> = {
  anthropic: "Opus is the most capable; Sonnet and Haiku cost less per evaluation.",
  gemini: "gemini-pro-latest: strongest Gemini (≈30 s per evaluation). gemini-flash-latest: faster and cheaper.",
  openai: "",
};

function ModelPicker({ s, f, setF, providerKey, modelKey }: { s: any; f: any; setF: (fn: (x: any) => any) => void; providerKey: string; modelKey: string }) {
  const provider = f[providerKey];
  const models: string[] = s.available_models[provider] ?? [];
  const custom = !models.includes(f[modelKey]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Provider" hint={s.keys[provider]?.configured ? undefined : "No key saved for this provider yet."}>
        <Select className="w-full" value={provider} onChange={(e) => {
          const p = e.target.value;
          setF((x: any) => ({ ...x, [providerKey]: p, [modelKey]: (s.available_models[p] ?? [])[0] ?? x[modelKey] }));
        }}>
          {Object.entries(PROVIDER_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Model" hint={MODEL_HINT[provider] || undefined}>
        <Select className="w-full" value={custom ? "__custom" : f[modelKey]} onChange={(e) => setF((x: any) => ({ ...x, [modelKey]: e.target.value === "__custom" ? "" : e.target.value }))}>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="__custom">Other (type a model id)…</option>
        </Select>
        {custom && <Input className="mt-2" placeholder="model id" value={f[modelKey]} onChange={(e) => setF((x: any) => ({ ...x, [modelKey]: e.target.value }))} />}
      </Field>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-[13.5px]">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function ApiKeys({ s }: { s: any }) {
  const qc = useQueryClient();
  const [keys, setKeys] = useState<Record<string, string>>({ anthropic: "", openai: "", gemini: "" });
  const [remove, setRemove] = useState<string | null>(null);
  const setKey = useMutation({
    mutationFn: (provider: string) => api.put("/api/settings/api-key", { provider, api_key: keys[provider] }),
    onSuccess: (d, provider) => {
      setKeys((k) => ({ ...k, [provider]: "" }));
      qc.setQueryData(["settings"], d);
    },
  });
  const delKey = useMutation({
    mutationFn: (provider: string) => api.del(`/api/settings/api-key/${provider}`),
    onSuccess: (d) => { setRemove(null); qc.setQueryData(["settings"], d); },
  });
  const test = useMutation({ mutationFn: (route: string) => api.post(`/api/settings/test-connection?route=${route}`) });
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />API keys</span>}
        subtitle="Keys are stored only in backend/.env on this computer (excluded from Git), used only by the local backend, and never sent to the browser or logged."
      />
      <CardBody className="space-y-4">
        {(["gemini", "anthropic", "openai"] as const).map((p) => {
          const k = s.keys[p];
          return (
            <div key={p} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium">{PROVIDER_NAME[p]}</span>
                {k.configured ? <Badge tone="good"><Check className="h-3 w-3" />Configured · {k.masked}</Badge> : <Badge>Not configured</Badge>}
                {p !== "anthropic" && <span className="text-[12px] text-muted">Also enables speech-to-text transcription{p === "gemini" ? " (used when no OpenAI key is set)" : ""}.</span>}
              </div>
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setKey.mutate(p); }}>
                <Input
                  type="password"
                  autoComplete="off"
                  className="max-w-md flex-1"
                  placeholder={k.configured ? "Enter a new key to replace it" : { anthropic: "sk-ant-…", openai: "sk-…", gemini: "Google AI Studio key" }[p]}
                  value={keys[p]}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                  aria-label={`${p} API key`}
                />
                <Button type="submit" variant="outline" disabled={keys[p].trim().length < 10} loading={setKey.isPending && setKey.variables === p}>Save key</Button>
                {k.configured && <Button type="button" variant="ghost" onClick={() => setRemove(p)}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}
              </form>
            </div>
          );
        })}
        {(setKey.error || delKey.error) && <ErrorBox error={setKey.error || delKey.error} />}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Button variant="primary" onClick={() => test.mutate("practice")} loading={test.isPending && test.variables === "practice"}><Plug className="h-4 w-4" />Test practice model</Button>
          <Button variant="outline" onClick={() => test.mutate("mock")} loading={test.isPending && test.variables === "mock"}><Plug className="h-4 w-4" />Test mock-exam model</Button>
          <span className="text-[12px] text-muted">Each sends one tiny request using the saved settings.</span>
        </div>
        {test.data && (
          <div className={test.data.ok ? "flex items-center gap-2 text-[13.5px] text-good" : "flex items-center gap-2 text-[13.5px] text-bad"} role="status">
            {test.data.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {test.data.route === "mock" ? "Mock exams: " : "Practice: "}{test.data.message} <span className="text-muted">({test.data.provider} · {test.data.model})</span>
          </div>
        )}
        {test.error && <ErrorBox error={test.error} />}
      </CardBody>
      <ConfirmModal
        open={!!remove}
        onClose={() => setRemove(null)}
        onConfirm={() => remove && delKey.mutate(remove)}
        loading={delKey.isPending}
        title="Remove API key?"
        message="AI evaluation with this provider will stop working until a key is added again. Saved evaluations are not affected."
        confirmText="Remove key"
      />
    </Card>
  );
}

function Usage() {
  const { data: u } = useQuery({ queryKey: ["usage"], queryFn: () => api.get("/api/usage") });
  if (!u) return null;
  return (
    <Card>
      <CardHeader title="AI usage & spending safeguards" subtitle={u.note} />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3 text-[13px]">
          <div className="rounded-lg bg-subtle p-3">
            <div className="text-muted">Today</div>
            <div className="text-lg font-semibold tabular-nums">{u.today.requests}{u.limits.requests ? ` / ${u.limits.requests}` : ""} requests</div>
            <div className="tabular-nums text-muted">${u.today.estimated_cost_usd.toFixed(3)}{u.limits.spend_usd ? ` of $${u.limits.spend_usd.toFixed(2)} limit` : ""}</div>
          </div>
          <div className="rounded-lg bg-subtle p-3">
            <div className="text-muted">All time</div>
            <div className="text-lg font-semibold tabular-nums">{u.all_time.requests} requests</div>
            <div className="tabular-nums text-muted">≈ ${u.all_time.estimated_cost_usd.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-subtle p-3">
            <div className="text-muted">Tokens (all time)</div>
            <div className="tabular-nums">{u.all_time.input_tokens.toLocaleString()} in</div>
            <div className="tabular-nums">{u.all_time.output_tokens.toLocaleString()} out</div>
          </div>
        </div>
        {u.recent.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[13px] font-medium">Recent requests</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-muted"><tr>{["When", "Purpose", "Model", "Result", "Tokens", "Est. cost"].map((h) => <th key={h} className="border-b border-border px-2 py-1 font-medium">{h}</th>)}</tr></thead>
                <tbody className="tabular-nums">
                  {u.recent.map((r: any) => (
                    <tr key={r.id}>
                      <td className="border-b border-border/60 px-2 py-1">{fmtDateTime(r.created_at)}</td>
                      <td className="border-b border-border/60 px-2 py-1">{r.purpose}</td>
                      <td className="border-b border-border/60 px-2 py-1">{r.model}</td>
                      <td className="border-b border-border/60 px-2 py-1">{r.success ? "ok" : <span className="text-bad">{r.error_type}</span>}</td>
                      <td className="border-b border-border/60 px-2 py-1">{r.input_tokens + r.output_tokens}</td>
                      <td className="border-b border-border/60 px-2 py-1">${r.cost_estimate_usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/api/settings") });
  const [f, setF] = useState<any>(null);
  const [srsText, setSrsText] = useState("");
  const [tab, setTab] = useState<"study" | "ai" | "audio" | "data">("study");
  const [saved, setSaved] = useState(false);
  const [delAudio, setDelAudio] = useState(false);
  useEffect(() => {
    if (s && !f) {
      setF(Object.fromEntries(EDITABLE.map((k) => [k, s[k]])));
      setSrsText((s.srs_intervals ?? []).join(", "));
    }
  }, [s, f]);
  const save = useMutation({
    mutationFn: () => {
      const intervals = srsText.split(/[,\s]+/).filter(Boolean).map(Number);
      return api.put("/api/settings", { ...f, srs_intervals: intervals });
    },
    onSuccess: (d) => {
      qc.setQueryData(["settings"], d);
      qc.invalidateQueries({ queryKey: ["header-days"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setF(Object.fromEntries(EDITABLE.map((k) => [k, d[k]])));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    },
  });
  const deleteAudio = useMutation({
    mutationFn: () => api.del("/api/audio"),
    onSuccess: () => { setDelAudio(false); qc.invalidateQueries({ queryKey: ["diagnostics"] }); },
  });
  if (isLoading || (!f && !error)) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(Object.fromEntries(EDITABLE.map((k) => [k, s[k]]))) !== JSON.stringify(f) || srsText !== (s.srs_intervals ?? []).join(", ");

  const saveBar = tab !== "data" && (
    <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel/95 px-4 py-3 backdrop-blur">
      <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}><Save className="h-4 w-4" />Save settings</Button>
      {saved && <span className="flex items-center gap-1 text-[13px] text-good"><Check className="h-4 w-4" />Saved</span>}
      {dirty && !saved && <span className="text-[12.5px] text-muted">Unsaved changes</span>}
      {save.error && <div className="w-full"><ErrorBox error={save.error} /></div>}
    </div>
  );

  return (
    <div>
      <PageHeader icon={<SettingsIcon className="h-6 w-6 text-muted" />} title="Settings" subtitle="Exam goals, study plan, AI provider, audio, and your local data." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[{ value: "study", label: "Exam & study" }, { value: "ai", label: "AI & evaluation" }, { value: "audio", label: "Audio & display" }, { value: "data", label: "Data & backup" }]}
      />

      {tab === "study" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Exam & goals" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Exam date" hint="Days remaining are calculated automatically.">
                  <Input type="date" value={f.exam_date} onChange={(e) => set("exam_date", e.target.value)} />
                </Field>
              </div>
              <div>
                <Label>Target level per skill</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {SKILLS.map((sk) => (
                    <div key={sk}>
                      <label className="text-[12px] text-muted" htmlFor={`target-${sk}`}>{SKILL_LABEL[sk]}</label>
                      <Input id={`target-${sk}`} type="number" min={1} max={12} value={f.target_levels?.[sk] ?? 12}
                        onChange={(e) => set("target_levels", { ...f.target_levels, [sk]: Number(e.target.value) })} />
                    </div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Daily study plan" subtitle="Changes apply to plans generated from now on; past plans are kept as history." />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Primary modules per day" hint="Default 2.">
                  <Select className="w-full" value={f.daily_module_count} onChange={(e) => set("daily_module_count", Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </Field>
                <Field label="Daily study time (minutes)" hint="Default 90, split between modules.">
                  <Input type="number" min={20} max={480} step={5} value={f.daily_minutes} onChange={(e) => set("daily_minutes", Number(e.target.value))} />
                </Field>
                <Field label="New vocabulary per day" hint="Cards introduced into the review queue.">
                  <Input type="number" min={0} max={100} value={f.vocab_daily_new_limit} onChange={(e) => set("vocab_daily_new_limit", Number(e.target.value))} />
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1 text-[13px] font-medium">Preferred study days</legend>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d, i) => {
                    const on = (f.study_days ?? []).includes(i);
                    return (
                      <label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${on ? "border-accent bg-accent/8" : "border-border"}`}>
                        <input type="checkbox" className="sr-only" checked={on}
                          onChange={() => set("study_days", on ? f.study_days.filter((x: number) => x !== i) : [...f.study_days, i].sort())} />
                        {on && <Check className="h-3 w-3 text-accent" />}{d}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <Field label="Spaced-repetition intervals (days)" hint="Increasing day counts, e.g. 1, 3, 7, 14, 30, 60. Good → next step, Easy → skip a step, Again → back to 1 day.">
                <Input value={srsText} onChange={(e) => setSrsText(e.target.value)} />
              </Field>
            </CardBody>
          </Card>
          {saveBar}
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-4">
          <Notice>
            The local backend calls the AI provider on your behalf; your browser never sees the key. AI levels are unofficial estimates for practice.
          </Notice>
          <ApiKeys s={s} />
          <Card>
            <CardHeader title="Practice model" subtitle="Used for daily modules, the four studios, question generation, explanations and news enrichment." />
            <CardBody><ModelPicker s={s} f={f} setF={setF} providerKey="ai_provider" modelKey="ai_model" /></CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Mock-exam model"
              subtitle={f.mock_model_for_speaking
                ? "Evaluates writing and speaking in mock exams (and when re-evaluating a mock attempt)."
                : "Evaluates writing in mock exams. Mock speaking uses the practice model, which also transcribes your recordings."}
            />
            <CardBody className="space-y-4">
              <ModelPicker s={s} f={f} setF={setF} providerKey="mock_ai_provider" modelKey="mock_ai_model" />
              <Toggle
                checked={f.mock_model_for_speaking}
                onChange={(v) => set("mock_model_for_speaking", v)}
                label="Also use this model for mock-exam speaking"
                hint="Off (recommended for your setup): the practice model both transcribes and evaluates speaking, in practice and in mock exams."
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Request settings" subtitle="Apply to every provider." />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {(f.ai_provider === "anthropic" || f.mock_ai_provider === "anthropic") && (
                  <Field label="Effort (Anthropic only)" hint="Higher effort = more thorough reasoning, more tokens.">
                    <Select className="w-full" value={f.ai_effort} onChange={(e) => set("ai_effort", e.target.value)}>
                      {["low", "medium", "high", "xhigh", "max"].map((x) => <option key={x} value={x}>{x}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Max output tokens" hint="Maximum response length per evaluation (2,000–64,000).">
                  <Input type="number" min={2000} max={64000} step={1000} value={f.ai_max_output_tokens} onChange={(e) => set("ai_max_output_tokens", Number(e.target.value))} />
                </Field>
                <Field label="Request timeout (seconds)">
                  <Input type="number" min={20} max={600} value={f.ai_timeout_seconds} onChange={(e) => set("ai_timeout_seconds", Number(e.target.value))} />
                </Field>
              </div>
              {(f.ai_provider === "anthropic" || f.mock_ai_provider === "anthropic") && (
                <Toggle checked={f.ai_refusal_fallback} onChange={(v) => set("ai_refusal_fallback", v)} label="Server-side refusal fallback"
                  hint="If the model declines a request, Anthropic retries it on a fallback model automatically (supported models only)." />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Spending safeguards" subtitle="Requests are blocked for the rest of the day once a limit is reached. Set 0 to disable a limit." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Daily request limit"><Input type="number" min={0} value={f.daily_request_limit} onChange={(e) => set("daily_request_limit", Number(e.target.value))} /></Field>
              <Field label="Daily estimated spend limit (USD)"><Input type="number" min={0} step={0.5} value={f.daily_spend_limit_usd} onChange={(e) => set("daily_spend_limit_usd", Number(e.target.value))} /></Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Evaluation preferences" />
            <CardBody>
              <Field label="Feedback style" hint="Scores aim to be accurate in every mode; this changes framing and strictness.">
                <Select value={f.feedback_strictness} onChange={(e) => set("feedback_strictness", e.target.value)}>
                  <option value="examiner">Strict examiner (recommended for a Level 12 target)</option>
                  <option value="balanced">Balanced</option>
                  <option value="encouraging">Encouraging</option>
                </Select>
              </Field>
            </CardBody>
          </Card>
          <Usage />
          {saveBar}
        </div>
      )}

      {tab === "audio" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Audio recording & transcription" />
            <CardBody className="space-y-4">
              <Toggle
                checked={f.audio_retention}
                onChange={(v) => set("audio_retention", v)}
                label="Keep my speaking recordings"
                hint="When on, recordings are saved only on this computer (data/audio) so you can replay them; delete any recording from its attempt page. When off, audio is discarded immediately after upload/transcription."
              />
              <Field label="Transcription method">
                <Select value={f.transcription_mode} onChange={(e) => set("transcription_mode", e.target.value)}>
                  <option value="manual">Manual — I type or paste what I said</option>
                  <option value="browser">Browser speech recognition (live)</option>
                  <option value="openai" disabled={!s.transcription_available}>
                    AI transcription{s.transcription_provider ? ` (${s.transcription_provider === "gemini" ? "Gemini" : "OpenAI"})` : " (needs a Gemini or OpenAI key)"}
                  </option>
                </Select>
              </Field>
              <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-muted">
                <li><strong className="text-fg">Manual:</strong> nothing leaves your computer; evaluation is text-only (no pronunciation/fluency judgement).</li>
                <li><strong className="text-fg">Browser:</strong> live recognition in Chrome/Edge/Safari; your browser vendor may process the audio on its servers.</li>
                <li><strong className="text-fg">AI transcription:</strong> the recording is sent to {s.transcription_provider === "gemini" ? "Google Gemini" : "OpenAI"} only when you click “Transcribe recording” after a task (OpenAI is used if both keys are set).</li>
              </ul>
              <div className="border-t border-border pt-3">
                <Button variant="outline" onClick={() => setDelAudio(true)}><Trash2 className="h-4 w-4" />Delete all recordings</Button>
                {deleteAudio.data && <span className="ml-3 text-[13px] text-good">Deleted {deleteAudio.data.deleted_files} file(s).</span>}
                {deleteAudio.error && <div className="mt-2"><ErrorBox error={deleteAudio.error} /></div>}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Listening" />
            <CardBody>
              <Toggle checked={f.listening_study_mode} onChange={(v) => set("listening_study_mode", v)} label="Listening study mode"
                hint="Shows the transcript and allows replays before you submit. Not exam-equivalent; answer keys stay hidden until submission." />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Appearance" />
            <CardBody>
              <Field label="Theme">
                <Select value={f.theme} onChange={(e) => { set("theme", e.target.value); applyTheme(e.target.value); }}>
                  <option value="system">Match system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
            </CardBody>
          </Card>
          {saveBar}
          <ConfirmModal open={delAudio} onClose={() => setDelAudio(false)} onConfirm={() => deleteAudio.mutate()} loading={deleteAudio.isPending}
            title="Delete all recordings?" message="Every saved speaking recording is permanently deleted from this computer. Transcripts and evaluations are kept." confirmText="Delete recordings" />
        </div>
      )}

      {tab === "data" && <DataPanel />}
    </div>
  );
}

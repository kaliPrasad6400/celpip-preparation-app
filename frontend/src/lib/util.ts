import DOMPurify from "dompurify";

export type Skill = "listening" | "reading" | "writing" | "speaking";
export const SKILLS: Skill[] = ["listening", "reading", "writing", "speaking"];
export const SKILL_LABEL: Record<string, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
  general: "General",
};
export const SKILL_TEXT: Record<string, string> = {
  listening: "text-listening",
  reading: "text-reading",
  writing: "text-writing",
  speaking: "text-speaking",
};
export const SKILL_BG: Record<string, string> = {
  listening: "bg-listening",
  reading: "bg-reading",
  writing: "bg-writing",
  speaking: "bg-speaking",
};
export const SKILL_COLOR_VAR: Record<string, string> = {
  listening: "rgb(var(--c-listening))",
  reading: "rgb(var(--c-reading))",
  writing: "rgb(var(--c-writing))",
  speaking: "rgb(var(--c-speaking))",
};
export const SKILL_ROUTE: Record<string, string> = {
  listening: "/listening",
  reading: "/reading",
  writing: "/writing",
  speaking: "/speaking",
};

export function practiceLink(skill: string, questionId?: number | null, sessionId?: number | null) {
  const p = new URLSearchParams();
  if (questionId) p.set("q", String(questionId));
  if (sessionId) p.set("session", String(sessionId));
  const s = p.toString();
  return `${SKILL_ROUTE[skill] ?? "/practice"}${s ? `?${s}` : ""}`;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function safeHtml(html: string) {
  return { __html: DOMPurify.sanitize(html ?? "", { ADD_ATTR: ["target", "data-link-type", "data-link-id", "data-type", "data-checked"] }) };
}

export function wordCount(t: string) {
  return t.trim() ? t.trim().split(/\s+/).length : 0;
}

export function fmtDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z"));
  return d.toLocaleDateString(undefined, opts);
}

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z"));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtSecs(s: number) {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function pct(v?: number | null, digits = 0) {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function localISODate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export function storageGet(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function storageSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* storage unavailable */
  }
}

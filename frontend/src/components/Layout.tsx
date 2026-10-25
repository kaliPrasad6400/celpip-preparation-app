import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, BookA, BookOpen, Brain, CalendarCheck, ClipboardList, FileText, Flag, Headphones, LayoutDashboard,
  LibraryBig, Menu, Mic, Moon, Newspaper, NotebookPen, PenLine, Search, Settings, Sun, Timer, TriangleAlert, X,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { cx, storageGet, storageSet } from "../lib/util";
import { Kbd } from "./ui";

const NAV: { to: string; label: string; icon: ReactNode; group?: string }[] = [
  { to: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/today", label: "Today's Study Plan", icon: <CalendarCheck className="h-4 w-4" /> },
  { to: "/practice", label: "Practice", icon: <ClipboardList className="h-4 w-4" />, group: "Practice" },
  { to: "/speaking", label: "Speaking Studio", icon: <Mic className="h-4 w-4" />, group: "Practice" },
  { to: "/writing", label: "Writing Studio", icon: <PenLine className="h-4 w-4" />, group: "Practice" },
  { to: "/listening", label: "Listening Practice", icon: <Headphones className="h-4 w-4" />, group: "Practice" },
  { to: "/reading", label: "Reading Practice", icon: <BookOpen className="h-4 w-4" />, group: "Practice" },
  { to: "/templates", label: "Templates Library", icon: <LibraryBig className="h-4 w-4" />, group: "Knowledge" },
  { to: "/vocabulary", label: "Vocabulary Vault", icon: <BookA className="h-4 w-4" />, group: "Knowledge" },
  { to: "/notes", label: "Notes Workspace", icon: <NotebookPen className="h-4 w-4" />, group: "Knowledge" },
  { to: "/mistakes", label: "Mistake Journal", icon: <TriangleAlert className="h-4 w-4" />, group: "Knowledge" },
  { to: "/canada", label: "Canadian Context", icon: <Flag className="h-4 w-4" />, group: "Context" },
  { to: "/news", label: "Current Affairs Practice", icon: <Newspaper className="h-4 w-4" />, group: "Context" },
  { to: "/mock", label: "Mock Exams", icon: <Timer className="h-4 w-4" />, group: "Progress" },
  { to: "/analytics", label: "Progress Analytics", icon: <BarChart3 className="h-4 w-4" />, group: "Progress" },
  { to: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" />, group: "Progress" },
];

export function applyTheme(t: string) {
  const dark = t === "dark" || (t === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", !!dark);
  storageSet("theme", t);
}

function ThemeToggle() {
  const [theme, setTheme] = useState(storageGet("theme", "system"));
  const isDark = document.documentElement.classList.contains("dark");
  return (
    <button
      className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg"
      aria-label="Toggle dark mode"
      title={`Theme: ${theme}`}
      onClick={() => {
        const next = isDark ? "light" : "dark";
        setTheme(next);
        applyTheme(next);
        api.put("/api/settings", { theme: next }).catch(() => {});
      }}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<any[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length > 1,
  });
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  if (!open) return null;
  const results = data ?? [];
  const go = (r: any) => {
    const map: Record<string, string> = {
      note: `/notes/${r.id}`, vocabulary: `/vocabulary?item=${r.id}`, template: `/templates/${r.id}`,
      mistake: `/mistakes?item=${r.id}`, topic: `/canada/${r.id}`,
    };
    nav(map[r.kind] ?? "/");
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="h-fit w-full max-w-xl overflow-hidden rounded-xl border border-border bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && results[sel]) go(results[sel]);
            }}
            placeholder="Search notes, vocabulary, templates, mistakes, topics…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none"
            aria-label="Search"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {q.trim().length < 2 && <p className="p-3 text-sm text-muted">Type at least 2 characters. Search works offline.</p>}
          {isFetching && <p className="p-3 text-sm text-muted">Searching…</p>}
          {!isFetching && q.trim().length > 1 && results.length === 0 && <p className="p-3 text-sm text-muted">No matches.</p>}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(r)}
              className={cx("flex w-full flex-col items-start rounded-lg px-3 py-2 text-left", i === sel && "bg-subtle")}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-subtle px-1.5 text-[11px] uppercase tracking-wide text-muted">{r.kind}</span>
                {r.title}
              </span>
              {r.snippet && <span className="mt-0.5 line-clamp-1 text-[12.5px] text-muted">{r.snippet}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const { data: dash } = useQuery({ queryKey: ["header-days"], queryFn: () => api.get("/api/settings"), staleTime: 60_000 });
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (dash?.theme && dash.theme !== storageGet("theme", "")) applyTheme(dash.theme);
  }, [dash?.theme]);

  const days = dash?.exam_date ? Math.round((new Date(dash.exam_date + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null;
  let lastGroup: string | undefined;
  const sidebar = (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
      {NAV.map((n) => {
        const header = n.group && n.group !== lastGroup ? n.group : null;
        lastGroup = n.group;
        return (
          <div key={n.to}>
            {header && <div className="mb-1 mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{header}</div>}
            <NavLink
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors",
                  isActive ? "bg-accent/10 font-medium text-accent" : "text-fg/80 hover:bg-subtle hover:text-fg",
                )
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:p-2">
        Skip to content
      </a>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-panel lg:flex">
        <Brand days={days} />
        <SearchButton onClick={() => setSearchOpen(true)} />
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="flex h-full w-72 flex-col border-r border-border bg-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              <Brand days={days} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-subtle">
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-panel/80 px-4 backdrop-blur lg:px-8">
          <button className="rounded-md p-1.5 hover:bg-subtle lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-[13px] text-muted lg:block">
            Target: <span className="font-medium text-fg">CELPIP Level 12</span> in all four skills
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setSearchOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-subtle lg:hidden" aria-label="Search">
              <Search className="h-4 w-4" />
            </button>
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function Brand({ days }: { days: number | null }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">12</div>
      <div>
        <div className="text-[14px] font-semibold leading-tight">CELPIP Mastery 12</div>
        <div className="text-[11.5px] text-muted">
          <Brain className="mr-1 inline h-3 w-3" />
          {days !== null ? `${days} days to exam` : "My Personal Exam Coach"}
        </div>
      </div>
    </div>
  );
}

function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-muted hover:bg-subtle"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">Search</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

export function NotFound() {
  return (
    <div className="py-20 text-center">
      <FileText className="mx-auto mb-3 h-8 w-8 text-muted" />
      <p className="font-medium">Page not found</p>
    </div>
  );
}

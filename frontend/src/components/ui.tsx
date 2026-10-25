import { AlertTriangle, Loader2, X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { ApiError } from "../lib/api";
import { cx } from "../lib/util";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-accent text-accent-fg hover:opacity-90 shadow-sm",
    secondary: "bg-subtle text-fg hover:bg-border/70",
    outline: "border border-border bg-panel hover:bg-subtle",
    ghost: "hover:bg-subtle text-fg",
    danger: "bg-bad text-white hover:opacity-90",
  };
  const s = { sm: "h-8 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-[15px]" }[size];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        v[variant],
        s,
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl border border-border bg-panel", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("px-5 pb-5 pt-2", className)}>{children}</div>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent" | "skill"; className?: string }) {
  const t = {
    neutral: "bg-subtle text-muted",
    good: "bg-good/12 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/12 text-bad",
    accent: "bg-accent/12 text-accent",
    skill: "",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", t, className)}>{children}</span>;
}

export function SkillBadge({ skill }: { skill: string }) {
  const dot: Record<string, string> = { listening: "bg-listening", reading: "bg-reading", writing: "bg-writing", speaking: "bg-speaking" };
  return (
    <Badge>
      <span className={cx("h-1.5 w-1.5 rounded-full", dot[skill] ?? "bg-muted")} aria-hidden />
      <span className="text-fg/80">{skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, [string, "neutral" | "accent" | "warn" | "good"]> = {
    original: ["Original practice material", "neutral"],
    ai_generated: ["AI-generated practice", "warn"],
    user: ["Your content", "accent"],
    official_celpip: ["Official public guidance", "good"],
    seed: ["Starter content", "neutral"],
  };
  const [label, tone] = map[source] ?? [source, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

export const Input = ({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cx(
      "h-9 w-full rounded-lg border border-border bg-panel px-3 text-sm placeholder:text-muted/80 focus:border-accent focus:outline-none",
      className,
    )}
    {...rest}
  />
);

export const Textarea = ({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cx(
      "w-full rounded-lg border border-border bg-panel px-3 py-2 text-[15px] leading-relaxed placeholder:text-muted/80 focus:border-accent focus:outline-none",
      className,
    )}
    {...rest}
  />
);

export const Select = ({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cx("h-9 rounded-lg border border-border bg-panel px-2.5 text-sm focus:border-accent focus:outline-none", className)} {...rest}>
    {children}
  </select>
);

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="mb-1 block text-[13px] font-medium">
      {children}
      {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-lg bg-subtle p-0.5", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
            value === t.value ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx("w-full rounded-xl border border-border bg-panel shadow-xl outline-none", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="rounded-md p-1 hover:bg-subtle" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open, onClose, onConfirm, title, message, confirmText = "Confirm", typeToConfirm, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmText?: string; typeToConfirm?: string; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-sm">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div>{message}</div>
        </div>
        {typeToConfirm && (
          <div>
            <Label>
              Type <code className="rounded bg-subtle px-1">{typeToConfirm}</code> to confirm
            </Label>
            <Input id="confirm-input" autoFocus />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              if (typeToConfirm) {
                const v = (document.getElementById("confirm-input") as HTMLInputElement)?.value;
                if (v !== typeToConfirm) return;
              }
              onConfirm();
            }}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  const msg = e?.message ?? String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/8 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
      <div className="flex-1">
        <p>{msg}</p>
        {e?.code === "no_key" && (
          <a className="mt-1 inline-block text-accent underline" href="/settings">Open Settings → AI</a>
        )}
      </div>
      {onRetry && (e?.retryable || e?.status === 0) && (
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-subtle", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
          {icon}
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={cx("rounded-lg border px-3 py-2 text-[13px]", tone === "warn" ? "border-warn/30 bg-warn/8 text-fg" : "border-accent/25 bg-accent/6 text-fg")}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

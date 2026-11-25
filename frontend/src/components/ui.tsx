"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, XCircle } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={clsx("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(pad && "p-5")}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "primary", loading, className, children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand text-brand-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "text-bad-ink hover:bg-surface-2",
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(field, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(field, "min-h-24", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(field, props.className)} />;
}
export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-ink-2">
      {children}
      {hint && <span className="ml-1 font-normal text-muted">({hint})</span>}
    </label>
  );
}

const statusMeta = {
  "READY": { icon: CheckCircle2, dot: "bg-good", ink: "text-good-ink" },
  "AT RISK": { icon: AlertTriangle, dot: "bg-warn", ink: "text-warn-ink" },
  "NOT READY": { icon: XCircle, dot: "bg-bad", ink: "text-bad-ink" },
} as const;

/** Status always ships icon + label - never colour alone. */
export function StatusBadge({ status, large }: { status: keyof typeof statusMeta; large?: boolean }) {
  const m = statusMeta[status] ?? statusMeta["NOT READY"];
  const Icon = m.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-semibold", m.ink,
      large ? "px-4 py-1.5 text-base" : "px-2 py-0.5 text-xs")}>
      <Icon className={large ? "h-5 w-5" : "h-3.5 w-3.5"} />
      {status}
    </span>
  );
}

const tones = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand/10 text-brand dark:text-ink",
  accent: "bg-accent-soft text-accent-ink",
  good: "bg-good/10 text-good-ink",
  warn: "bg-warn/15 text-warn-ink",
  bad: "bg-bad/10 text-bad-ink",
};
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function AiLabel() {
  return (
    <Badge tone="accent">
      <Sparkles className="h-3 w-3" /> AI-generated · verify before use
    </Badge>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: ReactNode }) {
  const Icon = tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : tone === "good" ? CheckCircle2 : Info;
  return (
    <div className={clsx("flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
      tone === "info" && "border-line bg-surface-2 text-ink-2",
      tone === "warn" && "border-warn/40 bg-warn/10 text-ink",
      tone === "bad" && "border-bad/40 bg-bad/10 text-ink",
      tone === "good" && "border-good/40 bg-good/10 text-ink")}>
      <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0",
        tone === "warn" && "text-warn-ink", tone === "bad" && "text-bad-ink", tone === "good" && "text-good-ink")} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-surface-2 p-3"><Icon className="h-6 w-6 text-muted" /></div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-ink-2">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

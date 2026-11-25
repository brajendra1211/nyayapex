import clsx from "clsx";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** Page frame for the public website. */
export function Site({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Deep royal-blue band with a faint grid and gold glow: the site's signature surface. */
export function NavyBand({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx("relative isolate overflow-hidden bg-[#071b44] text-[#cfd8ec]", className)}>
      <div className="site-grid absolute inset-0 -z-10" aria-hidden />
      <div className="site-glow absolute inset-0 -z-10" aria-hidden />
      {children}
    </section>
  );
}

export function PageHero({ eyebrow, title, children, aside }: { eyebrow?: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <NavyBand>
      <div className={clsx("mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20", aside && "lg:grid-cols-[1.15fr_1fr] lg:items-center")}>
        <div className="site-rise">
          {eyebrow && <Eyebrow light>{eyebrow}</Eyebrow>}
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl">{title}</h1>
          {children && <div className="mt-5 max-w-2xl text-lg leading-relaxed text-[#cfd8ec]/90">{children}</div>}
        </div>
        {aside && <div className="site-rise-2">{aside}</div>}
      </div>
    </NavyBand>
  );
}

export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return (
    <div className={clsx("inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]", light ? "text-[#e2c25e]" : "text-accent-ink")}>
      <span className={clsx("h-px w-6", light ? "bg-[#d4af37]" : "bg-accent")} />{children}
    </div>
  );
}

export function Section({ id, eyebrow, title, intro, children, tint, center }: {
  id?: string; eyebrow?: string; title?: string; intro?: ReactNode; children: ReactNode; tint?: boolean; center?: boolean;
}) {
  return (
    <section id={id} className={tint ? "border-y border-line bg-surface" : ""}>
      <div className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
        {(eyebrow || title || intro) && (
          <div className={clsx(center ? "mx-auto max-w-3xl text-center" : "max-w-2xl")}>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h2>}
            {intro && <div className="mt-3 text-lg leading-relaxed text-ink-2">{intro}</div>}
          </div>
        )}
        <div className={title || intro ? "mt-10" : ""}>{children}</div>
      </div>
    </section>
  );
}

export function IconCard({ icon: Icon, title, children, href }: { icon: React.ElementType; title: string; children: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand to-[#173f8a] text-[#e2c25e] shadow-sm ring-1 ring-white/10"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-4 text-[17px] font-semibold text-ink">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-ink-2">{children}</div>
      {href && <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand opacity-80 transition group-hover:gap-2 group-hover:opacity-100 dark:text-accent">Learn more<ArrowRight className="h-4 w-4" /></span>}
    </>
  );
  const cls = "group flex flex-col rounded-2xl border border-line bg-surface p-6 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_12px_32px_-12px_rgba(11,45,107,0.25)]";
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function CtaBand({ title, text, primary = { href: "/login?view=register", label: "Create account" }, secondary = { href: "/contact", label: "Talk to us" } }: {
  title: string; text: string; primary?: { href: string; label: string }; secondary?: { href: string; label: string } | null;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="relative isolate overflow-hidden rounded-3xl bg-[#071b44] px-6 py-12 sm:px-12">
        <div className="site-grid absolute inset-0 -z-10" aria-hidden />
        <div className="site-glow absolute inset-0 -z-10" aria-hidden />
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div>
            <h2 className="font-display text-3xl font-semibold text-white">{title}</h2>
            <p className="mt-2 max-w-xl text-[#cfd8ec]/90">{text}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={primary.href} className="inline-flex items-center gap-2 rounded-xl bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0b2d6b] shadow-lg shadow-black/20 hover:brightness-105">{primary.label}<ArrowRight className="h-4 w-4" /></Link>
            {secondary && <Link href={secondary.href} className="rounded-xl border border-white/25 px-6 py-3 text-sm font-medium text-white hover:bg-white/10">{secondary.label}</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line bg-surface">
      {items.map(([q, a]) => (
        <details key={q} className="faq group px-6 py-5">
          <summary className="flex items-start justify-between gap-4 text-left font-medium text-ink">
            {q}<Plus className="faq-icon mt-0.5 h-5 w-5 shrink-0 text-accent-ink transition-transform" />
          </summary>
          <div className="mt-3 text-sm leading-relaxed text-ink-2">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Long-form text pages (privacy, terms, responsible AI, about). */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl rounded-3xl border border-line bg-surface px-6 py-10 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:px-12 [&_a]:text-brand dark:[&_a]:text-accent [&_b]:text-ink [&_h2]:mt-10 [&_h2]:border-t [&_h2]:border-line [&_h2]:pt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:first-child]:border-0 [&>h2:first-child]:pt-0 [&_li]:mt-2 [&_li]:pl-1 [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-ink-2 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-ink-2 [&_ul]:marker:text-accent">
        {children}
      </div>
    </div>
  );
}

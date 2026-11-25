"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { homeFor, useAuth } from "@/lib/auth";

const LINKS = [
  { href: "/features", label: "Services" },
  { href: "/individuals", label: "For individuals" },
  { href: "/responsible-ai", label: "Responsible AI" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const cta = user?.onboarded
    ? <Link href={homeFor(user)} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-ink shadow-sm hover:opacity-90">Open Nyay Apex</Link>
    : <>
        <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">Log in</Link>
        <Link href="/login?view=register" className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-ink shadow-sm hover:opacity-90">Create account</Link>
      </>;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Logo className="h-11" />
        </Link>
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={clsx("relative rounded-lg px-3 py-2 text-sm transition hover:text-ink", pathname === l.href ? "font-medium text-ink after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-accent" : "text-ink-2")}>{l.label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">{cta}</div>
        <button className="rounded-lg p-2 text-ink lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-surface px-4 pb-4 lg:hidden">
          <nav className="flex flex-col py-2" aria-label="Main">
            {LINKS.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-ink hover:bg-surface-2">{l.label}</Link>)}
          </nav>
          <div className="flex flex-wrap gap-2">{cta}</div>
        </div>
      )}
    </header>
  );
}

import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const COLS = [
  { title: "Services", links: [["/features#research", "Legal research"], ["/features#precedent", "Precedent validator"], ["/features#hearings", "Hearings & cause lists"], ["/features#filing", "Drafting & filing"], ["/features#compliance", "Registry compliance"]] },
  { title: "For you", links: [["/features#chamber", "Advocates & chambers"], ["/features#team", "Corporate legal teams"], ["/features#team", "Law students"], ["/individuals", "Individuals"]] },
  { title: "Trust", links: [["/responsible-ai", "Responsible AI"], ["/features#security", "Security"], ["/privacy", "Privacy policy"], ["/terms", "Terms of use"]] },
  { title: "Company", links: [["/about", "About us"], ["/contact", "Contact"], ["/login", "Log in"], ["/login?view=register", "Create account"]] },
];

export function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-[#06163a] text-[#b4bfd8]">
      <div className="site-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div>
            <Logo on="dark" className="h-14" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed">
              AI-powered legal intelligence for Supreme Court of India practice, and plain-language help for people following their own case.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-[#d4af37]" />Private by default · DPDP Act, 2023
            </div>
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e2c25e]">{c.title}</div>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map(([href, label]) => <li key={label}><Link href={href} className="transition hover:text-white">{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 sm:flex-row sm:items-center">
          <p className="text-sm"><span className="font-medium text-white">Want a walk-through for your chamber?</span> We will set it up on matters like yours.</p>
          <Link href="/contact" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#e2c25e] hover:gap-2.5">Talk to us<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
      <div className="mt-12 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-[#8f9bb8] sm:px-6 lg:flex-row lg:justify-between">
          <span>© 2026 Nyay Apex. An independent service, not affiliated with the Supreme Court of India. AI output is advisory, not legal advice.</span>
          <span>Judgments: Supreme Court of India e-SCR, via the Indian Supreme Court Judgments open dataset (CC-BY-4.0).</span>
        </div>
      </div>
    </footer>
  );
}

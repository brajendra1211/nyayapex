import clsx from "clsx";
import { CalendarClock, Check, CheckCircle2, FileText, Gavel, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/** A browser-window frame around a product view. */
export function Frame({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-[0_30px_80px_-20px_rgba(3,12,35,0.55)] ring-1 ring-black/5", className)}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 flex-1 truncate rounded-md bg-surface px-3 py-1 text-[11px] text-muted">nyayapex.ai{url}</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand dark:text-ink">{children}</span>
);
const AiTag = () => (
  <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink"><Sparkles className="h-3 w-3" />AI · sources cited</span>
);

/** Research answer with its authorities (real, verifiable citations). */
export function ResearchShot() {
  return (
    <Frame url="/research">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink">
        <Search className="h-4 w-4 text-muted" />When can anticipatory bail be granted?
      </div>
      <div className="mt-4 flex items-center justify-between"><span className="text-xs font-semibold text-ink">Answer</span><AiTag /></div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        The power is not to be read restrictively; each application is judged on its own facts <Chip>Gurbaksh Singh Sibbia, (1980) 2 SCC 565</Chip>.
        Protection need not be limited to a fixed period and can last till the end of trial <Chip>Sushila Aggarwal, (2020) 5 SCC 1</Chip>.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[["BNSS s. 482", "earlier CrPC s. 438"], ["38,386 judgments", "Supreme Court, 1950–2026"]].map(([a, b]) => (
          <div key={a} className="rounded-lg border border-line px-3 py-2"><div className="text-xs font-semibold text-ink">{a}</div><div className="text-[11px] text-muted">{b}</div></div>
        ))}
      </div>
    </Frame>
  );
}

/** Chamber dashboard: today's listings and what needs attention (sample data). */
export function DeskShot() {
  const rows = [
    ["Sample v. State of Delhi", "Court 3 · Item 12", "Tomorrow", "bg-accent"],
    ["Sample Infra Ltd. v. Union of India", "Court 7 · Item 41", "18 Nov", "bg-brand/60"],
    ["Sample v. Sample", "Limitation in 3 days", "20 Nov", "bg-bad"],
  ] as const;
  return (
    <Frame url="/dashboard">
      <div className="flex items-end justify-between">
        <div><div className="text-[11px] uppercase tracking-wide text-muted">Chamber dashboard</div><div className="text-base font-semibold text-ink">Good evening</div></div>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-ink">Sample data</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[["12", "Active matters"], ["2", "Listed this week"], ["5", "Tasks due"]].map(([n, l]) => (
          <div key={l} className="rounded-lg border border-line px-3 py-2"><div className="text-lg font-semibold text-ink">{n}</div><div className="text-[11px] text-muted">{l}</div></div>
        ))}
      </div>
      <div className="mt-4 text-xs font-semibold text-ink">Coming up</div>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {rows.map(([t, d, w, dot]) => (
          <li key={t} className="flex items-center gap-3 px-3 py-2.5">
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", dot)} />
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{t}</div><div className="text-[11px] text-muted">{d}</div></div>
            <span className="text-[11px] font-medium text-ink-2">{w}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/** A matter followed through the cause list (sample data). */
export function HearingShot() {
  const rows = [
    ["14 Nov", "Listed · Court 3 · Item 12", "Advance list", true],
    ["02 Oct", "Notice issued; reply in 4 weeks", "Hearing note", false],
    ["11 Sep", "Filed; defects cured", "Registry", false],
  ] as const;
  return (
    <Frame url="/matter">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-sm font-semibold text-ink">Sample matter v. Union of India</div><div className="text-[11px] text-muted">SLP (C) · Sample · AOR: you</div></div>
        <span className="rounded-full bg-good/10 px-2 py-0.5 text-[10px] font-semibold text-good-ink">Listed tomorrow</span>
      </div>
      <ol className="mt-4 space-y-3 border-l border-line pl-4">
        {rows.map(([d, t, k, hot]) => (
          <li key={d} className="relative">
            <span className={clsx("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface", hot ? "bg-accent" : "bg-brand/50")} />
            <div className="flex items-center gap-2 text-[12px]"><b className="text-ink">{d}</b><span className="text-muted">{k}</span></div>
            <div className="text-[13px] text-ink-2">{t}</div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-2"><CalendarClock className="h-4 w-4 text-accent-ink" />Reminder sent to the team for tomorrow</div>
    </Frame>
  );
}

/** A paper explained in Hindi for an individual (sample FIR). */
export function ExplainShot() {
  return (
    <Frame url="/understand">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2"><FileText className="h-4 w-4 text-muted" /></span>
        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-ink">FIR_sample.pdf</div><div className="text-[11px] text-muted">सरल हिन्दी में समझाया गया</div></div>
        <span className="rounded-md bg-brand px-2 py-0.5 text-[11px] text-white">हिन्दी</span>
      </div>
      <div className="mt-4 space-y-3 text-[13px] leading-relaxed">
        <div><div className="font-semibold text-ink">यह दस्तावेज़ क्या है</div><p className="text-ink-2">पुलिस में दर्ज पहली सूचना रिपोर्ट (FIR), चोरी की शिकायत पर।</p></div>
        <div><div className="font-semibold text-ink">धाराएँ</div><p className="text-ink-2"><Chip>BNS धारा 303</Chip> चोरी</p></div>
        <div><div className="font-semibold text-ink">वकील से पूछें</div><p className="text-ink-2">क्या मुझे अगली तारीख़ पर हाज़िर होना है?</p></div>
      </div>
      <div className="mt-4 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[11px] text-ink">जानकारी, क़ानूनी सलाह नहीं · मुफ़्त सहायता: 15100</div>
    </Frame>
  );
}

/** Registry readiness checklist (sample). */
export function RegistryShot() {
  const checks = ["Margins and font size", "Page numbers continuous", "Annexures marked P-1 to P-9", "Limitation: within time", "Every authority verified"];
  return (
    <Frame url="/compliance">
      <div className="flex items-center justify-between"><span className="text-sm font-semibold text-ink">Registry readiness</span>
        <span className="rounded-full bg-good/10 px-2 py-0.5 text-[10px] font-semibold text-good-ink">READY</span></div>
      <ul className="mt-3 space-y-2">
        {checks.map((c) => <li key={c} className="flex items-center gap-2 text-[13px] text-ink-2"><CheckCircle2 className="h-4 w-4 text-good-ink" />{c}</li>)}
      </ul>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full w-full rounded-full bg-gradient-to-r from-brand to-accent" /></div>
    </Frame>
  );
}

/** Courtroom assistant answer (sample). */
export function CourtShot() {
  return (
    <Frame url="/courtroom">
      <div className="flex items-center gap-2 text-[12px] text-muted"><Gavel className="h-4 w-4 text-accent-ink" />Bench asks</div>
      <p className="mt-1 text-[14px] font-medium text-ink">“Is there a judgment on personal liberty under Article 21 being read widely?”</p>
      <div className="mt-3 rounded-lg border border-line p-3 text-[13px] text-ink-2">
        <b className="text-ink">Maneka Gandhi v. Union of India</b>, (1978) 1 SCC 248: procedure depriving liberty must be fair, just and reasonable.
        <div className="mt-1 text-[11px] text-muted">From the library · page reference shown</div>
      </div>
    </Frame>
  );
}

/** Line-art scales of justice with columns, in gold: decorative. */
export function ScalesArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 300" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="g-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f0d77b" /><stop offset="1" stopColor="#b8892b" /></linearGradient>
      </defs>
      <g stroke="url(#g-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* columns */}
        {[24, 268].map((x) => (
          <g key={x} opacity="0.55">
            <path d={`M${x} 70h28M${x + 3} 78h22M${x + 3} 262h22M${x} 270h28`} />
            {[0, 7, 14, 21].map((d) => <path key={d} d={`M${x + 4 + d} 80v180`} strokeWidth="1.2" />)}
          </g>
        ))}
        {/* pillar and base */}
        <path d="M160 40v216M128 256h64M116 270h88" />
        <circle cx="160" cy="34" r="7" />
        {/* beam */}
        <path d="M84 82 160 68l76 14" />
        {/* chains and pans */}
        <path d="M84 82 60 156M84 82l24 74M236 82l-24 74M236 82l24 74" strokeWidth="1.3" />
        <path d="M52 156h64c-4 18-18 26-32 26s-28-8-32-26ZM204 156h64c-4 18-18 26-32 26s-28-8-32-26Z" />
      </g>
    </svg>
  );
}

export function TickList({ items, light }: { items: ReactNode[]; light?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t, i) => (
        <li key={i} className={clsx("flex gap-2.5 text-sm", light ? "text-[#cfd8ec]" : "text-ink-2")}>
          <span className={clsx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", light ? "bg-[#d4af37]/20 text-[#e2c25e]" : "bg-good/10 text-good-ink")}><Check className="h-3 w-3" /></span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

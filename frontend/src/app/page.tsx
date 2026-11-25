import {
  ArrowRight, BookOpen, Building2, CalendarClock, FileSearch, FileSignature, Gavel, GraduationCap, HeartHandshake, Landmark, Languages, Scale,
  ShieldCheck, Sparkles, UserRound, Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, Faq, IconCard, NavyBand, Section, Site } from "@/components/site/Site";
import { DeskShot, ExplainShot, HearingShot, RegistryShot, ResearchShot, ScalesArt, TickList } from "@/components/site/Visuals";

export const metadata: Metadata = {
  title: { absolute: "Nyay Apex · AI-Powered Legal Intelligence" },
  description: "Research Supreme Court judgments, track matters in the cause lists, prepare paper-books that pass the registry, and understand legal papers in simple English or Hindi. Every AI answer is sourced and under your control.",
};

const FACTS = [
  ["38,386", "Supreme Court judgments, 1950–2026"],
  ["1,059", "sections of BNS, BNSS and BSA"],
  ["2", "languages: English and हिन्दी"],
  ["0", "case-outcome predictions, ever"],
];

const AUDIENCE = [
  { icon: UserRound, title: "Advocates & AORs", text: "Matters, research and drafts in one place, from first draft to hearing.", href: "/features#research" },
  { icon: Building2, title: "Chambers & firms", text: "Seniors, juniors and clerks on the same matters, with roles and an activity trail.", href: "/features#chamber" },
  { icon: Landmark, title: "Corporate legal", text: "Supreme Court litigation tracked with counsel, documents and deadlines.", href: "/features#team" },
  { icon: GraduationCap, title: "Law students", text: "Research and training drafts, marked as training, never as filing-ready.", href: "/features#team" },
  { icon: HeartHandshake, title: "Individuals", text: "Follow your own case and understand it in simple English or Hindi.", href: "/individuals" },
];

const SPOTLIGHTS = [
  { eyebrow: "Legal research", title: "Every answer shows the judgment and page it rests on", visual: <ResearchShot />, href: "/features#research",
    points: ["Search by issue, case name, citation or section: BNS 103 also finds the case law on IPC 302.",
      "Landmark judgments rise first, ranked by how often the library relies on them.",
      "Ask in Hindi or Hinglish; legal terms are matched to the judgments' English words."] },
  { eyebrow: "Hearings & cause lists", title: "Know the day before when your matter is listed", visual: <HearingShot />, href: "/features#hearings",
    points: ["Matters found in the daily and advance cause lists by case or diary number.",
      "Hearing notes, follow-up tasks and the next date in one timeline.",
      "A reminder before every listed date, and a calendar feed for your phone."] },
  { eyebrow: "Drafting & filing", title: "Paper-books that are ready for the registry counter", visual: <RegistryShot />, href: "/features#filing",
    points: ["SLP paper-book in Supreme Court format: index, synopsis, petition, affidavit, annexures.",
      "Margins, fonts, page numbering, annexure marking and limitation checked before filing.",
      "A draft stays a draft until an advocate approves it."] },
  { eyebrow: "For individuals", title: "Your own case, explained in words you understand", visual: <ExplainShot />, href: "/individuals",
    points: ["Upload an FIR, notice, summons or order and read it in simple English or Hindi.",
      "Keep court dates, papers and questions for your advocate together.",
      "Information, not advice: always a pointer to an advocate or free legal aid."] },
];

const SERVICES = [
  { icon: FileSearch, title: "Legal research", href: "/features#research", text: "Every reported Supreme Court judgment, searchable by issue, citation, section or bench." },
  { icon: Scale, title: "Precedent validator", href: "/features#precedent", text: "Which later judgments follow, distinguish or overrule a decision, with a citation graph." },
  { icon: BookOpen, title: "Bare acts", href: "/features#bare-acts", text: "BNS, BNSS and BSA section by section, with the IPC section each replaced, and AI to find the right section." },
  { icon: FileSignature, title: "Drafting & filing", href: "/features#filing", text: "SLP paper-books in Supreme Court format, as one paginated PDF." },
  { icon: ShieldCheck, title: "Registry compliance", href: "/features#compliance", text: "Format, page numbers, annexures and limitation checked before the counter." },
  { icon: CalendarClock, title: "Hearings & cause lists", href: "/features#hearings", text: "Listings found by case or diary number; notes, tasks and reminders." },
  { icon: Gavel, title: "Courtroom assistant", href: "/features#courtroom", text: "The brief, the last note and the authorities on one screen during the hearing." },
  { icon: Users, title: "Chamber & clients", href: "/features#chamber", text: "Team roles, tasks, registry queue and a client portal that shows only what you share." },
];

const STEPS = [
  ["Create your account", "Sign up with WhatsApp or email in a minute and pick how you will use Nyay Apex."],
  ["Add your matters and papers", "Upload records, orders or an FIR. Text, dates and citations are read on our server."],
  ["Research, prepare, follow", "Ask questions with sources, prepare filings, and get reminded before every date."],
];

const PRINCIPLES = [
  "Every AI answer is labelled and shows the sources it was given.",
  "No prediction of case outcomes and no profiling of judges.",
  "Nothing is filed automatically; an advocate approves every draft.",
  "Phone numbers, emails, Aadhaar and PAN are masked before text reaches the AI provider.",
];

const FAQ: [string, React.ReactNode][] = [
  ["Who can use Nyay Apex?", "Advocates and Advocates-on-Record, chambers and law firms, corporate legal teams, law students, and individuals who want to follow and understand their own case."],
  ["Does the AI tell me whether I will win my case?", "No. Nyay Apex never predicts outcomes, scores a case's chances or profiles judges. It finds and explains the law and the record; decisions stay with the advocate."],
  ["Where do the judgments and bare acts come from?", <>Supreme Court judgments from the Court&apos;s e-SCR reports (via an open dataset); BNS, BNSS and BSA from the Gazette of India. See <Link href="/about" className="text-brand underline dark:text-accent">About</Link>.</>],
  ["Can I use it in Hindi?", "Yes. You can ask questions in Hindi or Hinglish, and individuals can read explanations of their papers in Hindi."],
  ["Who can see my matters and documents?", "Only your account (and, in a chamber, the people on the matter). Clients see only what you share. Your documents are never used to train AI models."],
  ["Is Nyay Apex connected to the Supreme Court?", "No. It is an independent service and is not affiliated with or endorsed by the Supreme Court of India."],
];

export default function Home() {
  return (
    <Site>
      {/* Hero */}
      <NavyBand>
        <ScalesArt className="pointer-events-none absolute -right-10 top-10 hidden h-[420px] w-[420px] opacity-[0.12] lg:block" />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-28 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div className="site-rise">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#cfd8ec]">
              <Sparkles className="h-3.5 w-3.5 text-[#d4af37]" />AI-Powered Legal Intelligence for India
            </div>
            <h1 className="mt-6 font-display text-[42px] font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Your digital <span className="whitespace-nowrap bg-gradient-to-r from-[#f0d77b] to-[#d4af37] bg-clip-text text-transparent">co‑counsel</span> for the Supreme Court.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#cfd8ec]/90">
              Research every reported judgment, follow your matters through the cause lists, and prepare filings that pass the registry, with every
              AI answer sourced, labelled and under your control.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login?view=register" className="inline-flex items-center gap-2 rounded-xl bg-[#d4af37] px-6 py-3.5 text-sm font-semibold text-[#0b2d6b] shadow-lg shadow-black/25 hover:brightness-105">
                Create account<ArrowRight className="h-4 w-4" /></Link>
              <Link href="/features" className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 text-sm font-medium text-white hover:bg-white/10">Explore services</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#cfd8ec]/80">
              {["Sources on every answer", "No outcome prediction", "English & हिन्दी"].map((t) => (
                <span key={t} className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#d4af37]" />{t}</span>
              ))}
            </div>
          </div>
          <div className="site-rise-2 relative">
            <DeskShot />
            <div className="absolute -bottom-10 -left-6 hidden w-56 rounded-2xl border border-line bg-surface p-4 shadow-xl sm:block">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink"><Languages className="h-4 w-4 text-accent-ink" />अग्रिम ज़मानत</div>
              <p className="mt-1 text-[11px] leading-snug text-ink-2">Hindi questions find the same judgments as English ones.</p>
            </div>
          </div>
        </div>
      </NavyBand>

      {/* Facts */}
      <div className="relative z-10 mx-auto -mt-14 max-w-6xl px-4 sm:px-6">
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-[0_20px_50px_-20px_rgba(11,45,107,0.35)] lg:grid-cols-4">
          {FACTS.map(([big, small]) => (
            <li key={small} className="bg-surface px-6 py-6">
              <div className="font-display text-3xl font-semibold text-brand dark:text-ink">{big}</div>
              <div className="mt-1 text-sm text-ink-2">{small}</div>
            </li>
          ))}
        </ul>
      </div>

      {/* Audience */}
      <Section eyebrow="Who it is for" title="Built for everyone who works with the law" center>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {AUDIENCE.map((a) => (
            <Link key={a.title} href={a.href} className="group rounded-2xl border border-line bg-surface p-5 text-center transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-lg">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-ink transition group-hover:bg-brand group-hover:text-[#e2c25e]"><a.icon className="h-5 w-5" /></span>
              <h3 className="mt-4 font-semibold text-ink">{a.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{a.text}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* Spotlights */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6">
          {SPOTLIGHTS.map((s, i) => (
            <div key={s.title} className="grid items-center gap-12 lg:grid-cols-2">
              <div className={i % 2 ? "lg:order-2" : ""}>
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-ink"><span className="h-px w-6 bg-accent" />{s.eyebrow}</div>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-[34px] sm:leading-tight">{s.title}</h2>
                <div className="mt-6"><TickList items={s.points} /></div>
                <Link href={s.href} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:gap-2.5 dark:text-accent">Learn more<ArrowRight className="h-4 w-4" /></Link>
              </div>
              <div className="relative">
                <div className="absolute -inset-4 -z-0 rounded-[28px] bg-gradient-to-br from-brand/10 via-transparent to-accent/15" aria-hidden />
                <div className="relative">{s.visual}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* All services */}
      <Section eyebrow="Services" title="Everything a Supreme Court matter needs" intro="From the first reading of the record to the day of the hearing.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((f) => <IconCard key={f.title} icon={f.icon} title={f.title} href={f.href}>{f.text}</IconCard>)}
        </div>
      </Section>

      {/* How it works */}
      <Section tint eyebrow="How it works" title="Up and running in three steps" center>
        <ol className="relative grid gap-8 md:grid-cols-3">
          <div className="absolute left-[16%] right-[16%] top-6 hidden h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent md:block" aria-hidden />
          {STEPS.map(([t, d], i) => (
            <li key={t} className="relative text-center">
              <span className="relative mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand font-display text-lg font-semibold text-[#e2c25e] ring-8 ring-surface">{i + 1}</span>
              <h3 className="mt-5 text-lg font-semibold text-ink">{t}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Responsible AI */}
      <NavyBand>
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="relative">
            <ScalesArt className="mx-auto h-64 w-64 opacity-90" />
          </div>
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#e2c25e]"><span className="h-px w-6 bg-[#d4af37]" />Responsible AI</div>
            <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">AI that stays in its place</h2>
            <p className="mt-3 text-[#cfd8ec]/90">Built around the Supreme Court&apos;s draft rules for the use of AI in courts: disclosure, verification and a human decision at every step.</p>
            <div className="mt-6"><TickList light items={PRINCIPLES} /></div>
            <Link href="/responsible-ai" className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-[#e2c25e] hover:gap-2.5">How we use AI<ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </NavyBand>

      {/* FAQ */}
      <Section eyebrow="Questions" title="Frequently asked" center>
        <Faq items={FAQ} />
      </Section>

      <CtaBand title="Bring your practice on board" text="Create an account in a minute, or tell us about your chamber and we will set up a walk-through with you." />
    </Site>
  );
}

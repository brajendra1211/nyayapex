import { BookOpen, Briefcase, CalendarClock, FileQuestionMark, HandHeart, Languages, ListTodo, MessageCircleQuestionMark, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, Faq, IconCard, PageHero, Section, Site } from "@/components/site/Site";
import { ExplainShot, TickList } from "@/components/site/Visuals";

export const metadata: Metadata = {
  title: "For individuals",
  description: "Not a lawyer? Keep your case papers and court dates in one place, and understand FIRs, notices, orders and the law in simple English or Hindi.",
};

const TOOLS = [
  { icon: FileQuestionMark, title: "Understand a document", text: "Upload an FIR, legal notice, summons or court order. Read what it is, what it says, its dates and sections, in simple English or Hindi." },
  { icon: MessageCircleQuestionMark, title: "Ask about the law", text: "Ask in your own words. The answer explains the law simply and shows the sections and Supreme Court judgments it comes from." },
  { icon: Briefcase, title: "My cases", text: "Court, case and FIR numbers, the other party, your advocate's details and your own notes, kept together for each case." },
  { icon: CalendarClock, title: "Court dates", text: "Note what happened on each date and the next date. Get a reminder the day before." },
  { icon: ListTodo, title: "Things to do & questions", text: "Track papers to collect, and keep a list of questions for your advocate with the answers you got." },
  { icon: Languages, title: "Legal words", text: "Bail, summons, adjournment, charge sheet and more, explained in English and Hindi." },
];

const STEPS = [
  ["Create your account", "Sign up with your WhatsApp number or email and choose “Individual (not a lawyer)”. No Bar Council details needed."],
  ["Add your case and papers", "Add the basic details you know, and upload the papers you have. Everything stays private to your account."],
  ["Understand and prepare", "Read your papers in simple words, note your dates, and go to your advocate with clear questions."],
];

const FAQ: [string, React.ReactNode][] = [
  ["Will Nyay Apex tell me if I will win?", "No. It never predicts how a case will end or estimates chances. It explains your papers and the law so you can follow your case and talk to your advocate better."],
  ["Is this legal advice?", "No. It is legal information in simple words. For advice on your own case, speak to an advocate. If you cannot afford one, you may be entitled to a free lawyer: call the NALSA helpline 15100."],
  ["Can I read the explanation in Hindi?", "Yes. Every explanation and answer can be shown in English or Hindi; you can switch with one click."],
  ["Who can see my papers?", "Only you. Your papers are private to your account and are never used to train AI models. Please do not upload papers of other people without their consent."],
  ["Can I use it on my phone?", "Yes. It works in the phone's browser, and you can add it to your home screen to open it like an app."],
  ["Does Nyay Apex recommend lawyers?", "No. Bar Council rules do not allow advocates to advertise, and we do not recommend particular advocates. The Free legal help page explains how to find free legal aid and what to check when choosing an advocate."],
];

export default function IndividualsPage() {
  return (
    <Site>
      <PageHero eyebrow="For individuals" title="Your case, explained in words you understand" aside={<ExplainShot />}>
        Not a lawyer? Keep your case papers and court dates in one place, read your FIR, notice or court order in simple English or Hindi, and go
        to your advocate with the right questions.
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login?view=register" className="rounded-xl bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0b2d6b] shadow-lg shadow-black/25 hover:brightness-105">Create account</Link>
          <a href="#how" className="rounded-xl border border-white/25 px-6 py-3 text-sm font-medium text-white hover:bg-white/10">How it works</a>
        </div>
      </PageHero>

      <Section eyebrow="What you can do" title="Everything about your case, in one place">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => <IconCard key={t.title} icon={t.icon} title={t.title}>{t.text}</IconCard>)}
        </div>
      </Section>

      <Section id="how" tint eyebrow="How it works" title="Three simple steps" center>
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-line bg-bg p-6">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand font-display font-semibold text-[#e2c25e]">{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold text-ink">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-line bg-surface p-8">
            <BookOpen className="h-7 w-7 text-accent-ink" />
            <h2 className="mt-4 font-display text-2xl font-semibold text-ink">Honest about what it is</h2>
            <div className="mt-5">
              <TickList items={[
                "Legal information in simple words, not legal advice.",
                "No prediction of how your case will end, and no comments on any judge.",
                "Every explanation is marked as AI and asks you to check the original paper.",
                "Every page points you to an advocate or free legal aid for your own case.",
              ]} />
            </div>
          </div>
          <div className="relative isolate overflow-hidden rounded-3xl bg-[#071b44] p-8 text-[#cfd8ec]">
            <div className="site-glow absolute inset-0 -z-10" aria-hidden />
            <HandHeart className="h-7 w-7 text-[#d4af37]" />
            <h2 className="mt-4 font-display text-2xl font-semibold text-white">Can&apos;t afford a lawyer?</h2>
            <p className="mt-3 leading-relaxed">
              Under the Legal Services Authorities Act, 1987, women, children, SC/ST members, persons with disability, people in custody and people
              below an income limit can get a free lawyer through the District Legal Services Authority.
            </p>
            <a href="tel:15100" className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-white/10 px-5 py-3 text-white hover:bg-white/15">
              <Phone className="h-5 w-5 text-[#d4af37]" /><span><span className="block text-xs text-[#cfd8ec]">NALSA legal aid helpline</span><span className="font-display text-2xl font-semibold">15100</span></span>
            </a>
          </div>
        </div>
      </Section>

      <Section tint eyebrow="Questions" title="Frequently asked" center>
        <Faq items={FAQ} />
      </Section>

      <CtaBand title="Start with one paper" text="Create an account, upload the paper that worries you, and read it in simple words." secondary={null} />
    </Site>
  );
}

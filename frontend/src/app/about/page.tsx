import { BadgeCheck, BookOpen, Coins, FileText, Gavel, Landmark, Lock, Scale, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, IconCard, PageHero, Section, Site } from "@/components/site/Site";
import { ScalesArt, TickList } from "@/components/site/Visuals";

export const metadata: Metadata = {
  title: "About",
  description: "Why Nyay Apex exists, the principles it is built on, and where its legal material comes from.",
};

const PRINCIPLES = [
  { icon: BookOpen, title: "Sources, always", text: "An answer names the judgment and page it rests on. Where the library has nothing, it says so." },
  { icon: BadgeCheck, title: "People decide", text: "AI output is labelled and advisory. Nothing is filed automatically; a draft is not filing-ready until an advocate approves it." },
  { icon: Scale, title: "No prediction", text: "We do not forecast case outcomes, score the chances of a matter, or profile judges." },
  { icon: Coins, title: "Free where it can be", text: "Text, dates, citations and format checks run on our own server without AI; AI is used only where it adds something." },
  { icon: Lock, title: "Private by default", text: "Each account's matters and documents are private to it; clients see only what is shared with them." },
];

const SOURCES = [
  { icon: Landmark, title: "Supreme Court judgments", text: "The Court's e-SCR reports, through the Indian Supreme Court Judgments open dataset (CC-BY-4.0)." },
  { icon: ScrollText, title: "BNS, BNSS and BSA", text: "The Gazette of India; old-to-new correspondence from the official comparison tables for the new criminal laws." },
  { icon: FileText, title: "Cause lists", text: "The PDFs the Supreme Court publishes on sci.gov.in, added by users by link or upload." },
];

export default function AboutPage() {
  return (
    <Site>
      <PageHero eyebrow="About us" title="Built for the people who argue before the Supreme Court" aside={<ScalesArt className="mx-auto h-72 w-72" />}>
        Practice in the Supreme Court is document-heavy, deadline-bound and precedent-driven. Nyay Apex brings the record, the law, the cause list
        and the chamber into one place, so advocates spend their time on the argument.
      </PageHero>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-ink"><span className="h-px w-6 bg-accent" />Our mission</div>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">A co-counsel that reads, finds and checks</h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">
              A Special Leave Petition can turn on a date buried on page 600 of the record, on whether a 1978 judgment is still followed, or on a
              defect the registry flags the day before limitation runs out. Nyay Apex does that reading and checking, and shows its sources.
              The decisions stay with the advocate.
            </p>
            <p className="mt-4 leading-relaxed text-ink-2">
              We also believe the law should be understandable to the people it affects. Individuals following their own case can read their papers
              and the law in simple English or Hindi, and are always pointed to an advocate or free legal aid for advice.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[[Gavel, "For the courtroom", "Authorities and the record on one screen when the Bench asks."], [FileText, "For the record", "A thousand-page record read for dates, citations and contradictions."],
              [Landmark, "For the registry", "Paper-books checked for format and limitation before filing."], [BookOpen, "For everyone", "Papers and the law explained in plain words."]].map(([Icon, t, d]) => {
              const I = Icon as typeof Gavel;
              return (
                <div key={t as string} className="rounded-2xl border border-line bg-surface p-5">
                  <I className="h-6 w-6 text-accent-ink" />
                  <div className="mt-3 font-semibold text-ink">{t as string}</div>
                  <p className="mt-1 text-sm text-ink-2">{d as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section tint eyebrow="Principles" title="What we will and won't do">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PRINCIPLES.map((p) => <IconCard key={p.title} icon={p.icon} title={p.title}>{p.text}</IconCard>)}
        </div>
      </Section>

      <Section eyebrow="Where the law comes from" title="Official, public sources">
        <div className="grid gap-4 md:grid-cols-3">
          {SOURCES.map((s) => <IconCard key={s.title} icon={s.icon} title={s.title}>{s.text}</IconCard>)}
        </div>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <TickList items={[
            "Nyay Apex is an independent service and is not affiliated with, or endorsed by, the Supreme Court of India.",
            <>Read how we use AI on the <Link href="/responsible-ai" className="font-medium text-brand underline dark:text-accent">Responsible AI</Link> page.</>,
          ]} />
        </div>
      </Section>

      <CtaBand title="Try it on your own matters" text="We are working with advocates and chambers on a pilot. Tell us what would help, or what is missing." primary={{ href: "/contact", label: "Write to us" }}
        secondary={{ href: "/login?view=register", label: "Create account" }} />
    </Site>
  );
}

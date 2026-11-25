import { CalendarCheck, LifeBuoy, MessageSquareText, ShieldQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/site/ContactForm";
import { PageHero, Site } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Ask for a walk-through or a pilot for your chamber, get help with your account, or make a privacy request.",
};

const WAYS = [
  { icon: CalendarCheck, title: "A walk-through or pilot", text: "We will show Nyay Apex on matters like yours and set up your chamber." },
  { icon: LifeBuoy, title: "Help with your account", text: "Already signed up? Mention the email or number you sign in with." },
  { icon: ShieldQuestion, title: "Privacy and data", text: "Requests to see, correct or delete your data under the DPDP Act, 2023." },
];

const NEXT = ["We read every message ourselves.", "We reply to you by email.", "For a walk-through, we agree a time that suits you."];

export default function ContactPage() {
  return (
    <Site>
      <PageHero eyebrow="Contact" title="Talk to us">
        Whether you are a single advocate, a chamber, a company&apos;s legal team or someone following your own case, tell us what would help.
      </PageHero>
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="relative z-10 -mt-10 grid gap-8 lg:grid-cols-[1fr_1.35fr]">
          <div className="space-y-4 lg:pt-16">
            {WAYS.map((w) => (
              <div key={w.title} className="flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-[#173f8a] text-[#e2c25e]"><w.icon className="h-5 w-5" /></span>
                <div><div className="font-semibold text-ink">{w.title}</div><p className="mt-1 text-sm text-ink-2">{w.text}</p></div>
              </div>
            ))}
            <div className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-2 font-semibold text-ink"><MessageSquareText className="h-5 w-5 text-accent-ink" />What happens next</div>
              <ol className="mt-3 space-y-2 text-sm text-ink-2">
                {NEXT.map((n, i) => <li key={n} className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">{i + 1}</span>{n}</li>)}
              </ol>
            </div>
            <p className="text-sm text-ink-2">Already using Nyay Apex? <Link href="/login" className="font-medium text-brand underline dark:text-accent">Log in</Link>; you can also report a wrong AI answer from the answer itself.</p>
          </div>
          <div className="order-first lg:order-none">
            <div className="rounded-3xl border border-line bg-surface p-2 shadow-[0_24px_60px_-24px_rgba(11,45,107,0.35)]">
              <div className="px-5 pb-1 pt-5">
                <h2 className="font-display text-2xl font-semibold text-ink">Send us a message</h2>
                <p className="mt-1 text-sm text-ink-2">Fields marked optional can be left blank.</p>
              </div>
              <ContactForm />
            </div>
          </div>
        </div>
      </div>
    </Site>
  );
}

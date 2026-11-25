import {
  BookOpen, Building2, CalendarClock, FileSearch, FileSignature, FileText, Gavel, HeartHandshake, KeyRound, Library, Scale, ShieldCheck, Smartphone, Users,
} from "lucide-react";
import type { Metadata } from "next";
import { CtaBand, PageHero, Site } from "@/components/site/Site";
import { CourtShot, ExplainShot, HearingShot, RegistryShot, ResearchShot, ScalesArt, TickList } from "@/components/site/Visuals";

export const metadata: Metadata = {
  title: "Features",
  description: "Legal research, precedent validation, bare acts, document intelligence, drafting and filing, registry compliance, cause-list tracking, courtroom assistant and chamber tools for Supreme Court practice.",
};

const GROUPS: { id: string; icon: typeof FileSearch; title: string; lead: string; points: string[] }[] = [
  { id: "research", icon: FileSearch, title: "Legal research", lead: "Every reported Supreme Court judgment from 1950 to 2026, searchable the way advocates think.",
    points: ["Search by issue, case name, citation (neutral, SCR, SCC, AIR) or a statutory provision — BNS 103 also finds the case law on IPC 302.",
      "Filters for period, judge, party and section; exact phrases in quotes; results show the passage where your words appear.",
      "Landmark judgments rise first: the library's own citation graph shows how often each is relied on.",
      "Optional AI answer that cites the judgment and page for every statement, and says when the library has nothing on the point."] },
  { id: "precedent", icon: Scale, title: "Precedent validator", lead: "Is it still good law? Read what later benches said.",
    points: ["Later judgments in the library that cite a decision, with how they describe it: followed, distinguished, doubted or overruled.",
      "A precedent graph: the authorities a judgment relies on and every judgment that cites it, by decade.",
      "Mixed treatment is shown as mixed, with the count of each; a status is a pointer to the judgments, not a substitute for reading them."] },
  { id: "citations", icon: Library, title: "Citation manager", lead: "Your citations, checked and in your chosen format.",
    points: ["Paste any text: every citation in it is found and checked against the library.",
      "Parallel citations collected from later judgments; saved citations kept per chamber.",
      "Before a draft is finalised, every authority in it is listed with its status."] },
  { id: "bare-acts", icon: BookOpen, title: "Bare acts & applicable law", lead: "What the law says, word for word, old and new.",
    points: ["BNS, BNSS and BSA from the Gazette of India, section by section.",
      "IPC ↔ BNS correspondence from the official BPR&D comparison tables; CrPC ↔ BNSS and Evidence Act ↔ BSA are being added.",
      "Not sure which section applies? Describe the situation and AI suggests the sections to read, chosen only from the bare acts in the library.",
      "For a matter: every provision named in its papers, and which code governs on the date of the offence."] },
  { id: "documents", icon: FileText, title: "Document intelligence", lead: "Read a thousand-page record in minutes.",
    points: ["Text, chronology of dates, citations and repeated pages extracted on our server, without any AI cost.",
      "Optional AI brief: core issues, questions of law, contradictions in the record with page references, hearing points.",
      "Ask questions of one record; answers quote the page. Every revised file is kept as a new version."] },
  { id: "filing", icon: FileSignature, title: "Drafting & filing", lead: "Supreme Court format from the first draft.",
    points: ["SLP (Civil) paper-book: index, synopsis and list of dates, petition, certificate, affidavit, I.A.s, vakalatnama and annexures as one paginated PDF.",
      "Drafting assistant with risk flags for vague, absolute or unparticularised language, and Constitutional Articles the facts may engage.",
      "A draft is filing-ready only when no placeholder, open flag or unverified authority remains and the advocate has approved it; until then every page of the Word file says so."] },
  { id: "compliance", icon: ShieldCheck, title: "Registry compliance", lead: "Catch defects before the filing counter does.",
    points: ["Format check of the final PDF: margins, fonts, page numbering, blank pages, annexure marking.",
      "Limitation calculator with the time for obtaining certified copies, saved to the matter.",
      "Rule-based READY / AT RISK / NOT READY — a checklist, never a prediction of what the registry will decide."] },
  { id: "hearings", icon: CalendarClock, title: "Hearings & cause lists", lead: "Know when your matter is listed, and what happened after.",
    points: ["Add the day's cause list by its sci.gov.in link or as a PDF: matters are found by case number or diary number — never by party names — and the team is notified.",
      "Listings under your AOR code, including matters not yet entered.",
      "Hearing notes, typed or dictated, with the next date and suggested follow-up tasks you choose to create.",
      "Evening reminders of tomorrow's hearings, limitation 7, 3 and 1 days ahead, and tasks due; a calendar feed for Google, Outlook or Apple."] },
  { id: "courtroom", icon: Gavel, title: "Courtroom assistant", lead: "Answers in seconds, on the screen you hold up.",
    points: ["Choose the matter being heard: its listing, last hearing note, brief, authorities and open tasks on one screen.",
      "Speak or type the Bench's question: the matter's own record is searched first, then the library; the answer names the authority and page.",
      "Judgments in the library where the judges on the bench sat, on related points — research material only, no assessment of any judge."] },
  { id: "chamber", icon: Building2, title: "Chamber & client portal", lead: "One matter, one place, for everyone who works on it.",
    points: ["Roles for AOR, senior, junior and clerk; juniors see only the matters they are on, unless the chamber decides otherwise.",
      "Team discussion, tasks and document requests, activity trail; many matters updated in one step.",
      "Registry queue by stage and days in stage, physical-file movements, filing alerts.",
      "Client portal: the client sees only the matters, documents and messages you share."] },
  { id: "individuals", icon: HeartHandshake, title: "For individuals", lead: "Not a lawyer? Follow your own case and understand it.",
    points: ["Keep each of your cases in one place: court, case and FIR numbers, your advocate's details, papers, court dates and things to do.",
      "Upload an FIR, legal notice, summons or court order and read what it means in simple English or Hindi: dates, sections and legal words explained.",
      "Ask about the law in your own words; the answer shows the sections and Supreme Court judgments it comes from.",
      "A reminder the day before every court date, a list of questions for your advocate, legal words explained, and where to get free legal aid.",
      "Legal information, not legal advice: no prediction of how a case will end, and a pointer to an advocate or free legal aid every time."] },
  { id: "team", icon: Users, title: "Accounts", lead: "For advocates, chambers, corporate legal teams, students and individuals.",
    points: ["Sign in with WhatsApp code or email and password; Bar enrolment verified for advocate accounts.",
      "Student accounts produce training drafts only."] },
  { id: "security", icon: KeyRound, title: "Security & audit", lead: "Built for privileged material.",
    points: ["Uploaded files encrypted at rest (AES-256); sessions in secure, httpOnly cookies; rate limits on sign-in and AI use.",
      "Every opening, download and question on a document is logged and visible on the document.",
      "Every AI answer is kept in an AI register with its model, sources and who verified it; any user can report a wrong AI output.",
      "Nightly database backups; uploaded files inside them stay encrypted."] },
  { id: "mobile", icon: Smartphone, title: "On your phone", lead: "Works in the browser on any phone; add it to the home screen to open it like an app.",
    points: ["Nothing about your matters is stored on the phone itself."] },
];

const VISUAL: Record<string, React.ReactNode> = {
  research: <ResearchShot />, hearings: <HearingShot />, compliance: <RegistryShot />, courtroom: <CourtShot />, individuals: <ExplainShot />,
};

export default function FeaturesPage() {
  return (
    <Site>
      <PageHero eyebrow="Services" title="One workspace for Supreme Court practice" aside={<ScalesArt className="mx-auto h-72 w-72" />}>
        Research, drafting, filing, hearings and the chamber&apos;s day-to-day, plus plain-language help for individuals. Each tool keeps
        people in charge of what is relied on and filed.
      </PageHero>

      <nav aria-label="On this page" className="sticky top-[68px] z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 py-3 sm:px-6">
          {GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1.5 text-xs text-ink-2 transition hover:border-brand/40 hover:text-ink">
              <g.icon className="h-3.5 w-3.5 text-accent-ink" />{g.title}
            </a>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-14 sm:px-6">
        {GROUPS.map((g, i) => {
          const visual = VISUAL[g.id];
          return (
            <section key={g.id} id={g.id} className="scroll-mt-36 overflow-hidden rounded-3xl border border-line bg-surface">
              <div className={visual ? "grid items-center gap-10 p-6 sm:p-10 lg:grid-cols-2" : "grid gap-8 p-6 sm:p-10 md:grid-cols-[20rem_1fr]"}>
                <div className={visual && i % 2 ? "lg:order-2" : ""}>
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand to-[#173f8a] text-[#e2c25e] shadow-sm"><g.icon className="h-5 w-5" /></span>
                  <h2 className="mt-5 font-display text-2xl font-semibold text-ink sm:text-3xl">{g.title}</h2>
                  <p className="mt-2 text-ink-2">{g.lead}</p>
                  {visual && <div className="mt-6"><TickList items={g.points} /></div>}
                </div>
                {visual ? (
                  <div className="relative">
                    <div className="absolute -inset-3 rounded-[26px] bg-gradient-to-br from-brand/10 via-transparent to-accent/15" aria-hidden />
                    <div className="relative">{visual}</div>
                  </div>
                ) : <TickList items={g.points} />}
              </div>
            </section>
          );
        })}
      </div>

      <CtaBand title="See it on your own matters" text="Create an account, or ask us for a walk-through for your chamber."
        secondary={{ href: "/contact", label: "Ask for a walk-through" }} />
    </Site>
  );
}

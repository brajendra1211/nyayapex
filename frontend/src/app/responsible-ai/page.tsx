import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, Prose, Site } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Responsible AI",
  description: "How Nyay Apex uses AI: disclosure, verification, an AI register, incident reporting, no outcome prediction and human approval before anything is filed.",
};

export default function ResponsibleAIPage() {
  return (
    <Site>
      <PageHero eyebrow="Responsible AI" title="How Nyay Apex uses AI">
        Designed around the Supreme Court&apos;s draft regulations on the use of artificial intelligence in courts: AI may assist research and
        drafting, but disclosure, verification and the final decision remain with people.
      </PageHero>
      <Prose>
        <h2>Where AI is used — and where it is not</h2>
        <p>
          AI (Anthropic&apos;s Claude models) is used for research answers, briefs of a record, first drafts, follow-up tasks from a hearing note
          you ask it to read, and short courtroom answers. Text extraction, chronology, citation detection, cause-list matching, format checks,
          limitation and the citation graph run on our own server without AI.
        </p>

        <h2>What every AI answer carries</h2>
        <ul>
          <li>A visible label that it is AI-generated and must be verified.</li>
          <li>The sources it was given — judgment, citation and page — so it can be checked against the original.</li>
          <li>An entry in the chamber&apos;s AI register: feature, model, the question, the answer, its sources, and who verified it. The register can be exported, and a disclosure report for a filing can be generated on request.</li>
        </ul>

        <h2>What we do not do</h2>
        <ul>
          <li>No prediction of the outcome of a case and no scoring of a matter&apos;s chances.</li>
          <li>No profiling of judges: where the bench is shown, it is only to find judgments they sat in.</li>
          <li>No automatic filing. A paper-book or draft is a draft until an advocate approves it; drafting exports say so on every page until all checks pass.</li>
          <li>Student accounts produce training drafts only.</li>
        </ul>

        <h2>Your data and the AI provider</h2>
        <ul>
          <li>Only the passages needed for a question are sent, not the whole record.</li>
          <li>Phone numbers, email addresses, Aadhaar and PAN numbers are replaced with placeholders before text leaves our server and restored in the answer.</li>
          <li>The AI provider processes requests outside India. If your matter must not leave India, use the tools that run without AI.</li>
        </ul>

        <h2>When AI gets it wrong</h2>
        <p>
          Every AI answer has a &quot;Report&quot; button. Reports go to an incident register with the cause, consequences and the remedy taken, and
          are reviewed by the platform team.
        </p>

        <h2>Questions</h2>
        <p>If you have a question about how AI is used on your matters, <Link href="/contact" className="font-medium text-brand underline dark:text-accent">contact us</Link>.</p>
      </Prose>
    </Site>
  );
}

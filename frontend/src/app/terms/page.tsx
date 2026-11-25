import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, Prose, Site } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms on which Nyay Apex is offered: an advisory research and practice tool; the advocate remains responsible for everything relied on and filed.",
};

export default function TermsPage() {
  return (
    <Site>
      <PageHero eyebrow="Terms" title="Terms of use">Last updated 3 November 2026.</PageHero>
      <Prose>
        <h2>What Nyay Apex is</h2>
        <p>
          Nyay Apex is a research and practice-management tool for legal professionals. It is not a law firm, does not give legal advice,
          and does not file anything with any court or registry.
        </p>

        <h2>The advocate&apos;s responsibility</h2>
        <ul>
          <li>Everything produced with AI is advisory. You must verify every fact, authority and citation against the original before relying on it.</li>
          <li>You are responsible for what you file, argue or advise, and for disclosing the use of AI where a court or rule requires it.</li>
          <li>Statuses such as &quot;Good Law&quot;, &quot;READY&quot; or a cause-list listing are aids worked out from the material available; check them at the source.</li>
        </ul>

        <h2>Your account</h2>
        <ul>
          <li>Keep your sign-in details to yourself; you are responsible for activity under your account.</li>
          <li>Upload only material you are entitled to use, and keep the privilege and confidentiality of your clients.</li>
          <li>Do not attempt to access another account&apos;s data, overload the service, or use it to build a competing database.</li>
        </ul>

        <h2>Content</h2>
        <p>
          Your matters and documents remain yours. Judgments and statutes come from public sources credited on the{" "}
          <Link href="/about" className="font-medium text-brand underline dark:text-accent">About</Link> page; we do not guarantee that they are complete or current.
        </p>

        <h2>Availability and liability</h2>
        <p>
          We work to keep the service available and accurate but provide it &quot;as is&quot;. To the extent the law allows, we are not liable for
          decisions taken on the basis of its output, or for loss caused by interruptions outside our reasonable control.
        </p>

        <h2>Ending</h2>
        <p>You may close your account at any time. We may suspend accounts that break these terms or the law.</p>

        <h2>Law and disputes</h2>
        <p>These terms are governed by the laws of India.</p>

        <p>Questions about these terms: <Link href="/contact" className="font-medium text-brand underline dark:text-accent">contact us</Link>.</p>
      </Prose>
    </Site>
  );
}

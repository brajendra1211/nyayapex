import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, Prose, Site } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Nyay Apex collects, why, where it is processed, how long it is kept, and your rights under the Digital Personal Data Protection Act, 2023.",
};

export default function PrivacyPage() {
  return (
    <Site>
      <PageHero eyebrow="Privacy" title="Privacy policy">Last updated 3 November 2026.</PageHero>
      <Prose>
        <p>
          This policy explains how Nyay Apex handles personal data of advocates, chamber staff, clients invited to the client portal, and
          visitors to this website. It is written to meet the Digital Personal Data Protection Act, 2023 (&quot;DPDP Act&quot;).
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><b>Account details:</b> name, email, mobile number, Bar enrolment and AOR details you enter, role in your chamber, preferences.</li>
          <li><b>Your work:</b> matters, documents you upload, notes, tasks, messages, drafts and the results of analysis.</li>
          <li><b>Records of use:</b> sign-ins, document access, AI requests and answers (the AI register), and errors — for security, audit and billing.</li>
          <li><b>Contact form:</b> what you write to us and the details you give.</li>
        </ul>
        <p>We do not use advertising or third-party tracking. The only cookie is the one that keeps you signed in.</p>

        <h2>Why we use it</h2>
        <ul>
          <li>To provide the service you asked for: research, analysis, drafting, matter management and alerts.</li>
          <li>To keep it secure and auditable, including the records that the Supreme Court&apos;s draft AI regulations expect.</li>
          <li>To reply to you and to send the alerts you have switched on (in the app, and on WhatsApp or email if you choose).</li>
        </ul>
        <p>We ask for your consent when you create an account and you can withdraw it by closing the account.</p>

        <h2>Who processes it</h2>
        <ul>
          <li><b>Our servers</b> store your account, matters and documents. Uploaded files are encrypted at rest.</li>
          <li><b>AI provider (Anthropic):</b> when you use an AI feature, the passages needed for that request are sent, with phone numbers,
            email addresses, Aadhaar and PAN numbers replaced by placeholders. This processing takes place outside India.</li>
          <li><b>Messaging:</b> one-time codes and alerts on WhatsApp go through our WhatsApp business messaging provider; email alerts through our mail service.</li>
        </ul>
        <p>We do not sell personal data. A chamber&apos;s matters and documents are visible only to that chamber, and to a client only what the chamber shares.</p>

        <h2>How long we keep it</h2>
        <p>
          For as long as your account is active, and afterwards only as long as needed for legal, audit or security reasons. Backups are
          kept for up to 30 days.
        </p>

        <h2>Your rights</h2>
        <p>
          Under the DPDP Act you may ask to access, correct, complete or erase your personal data, withdraw consent, and nominate someone to
          exercise these rights. Write to us through the <Link href="/contact" className="font-medium text-brand underline dark:text-accent">contact page</Link> (choose
          &quot;Privacy or data request&quot;). Data in a chamber&apos;s matters may belong to the chamber; we will act on such requests with it.
          You may also complain to the Data Protection Board of India.
        </p>

        <h2>Changes</h2>
        <p>We will post any change here with a new date, and tell account holders in the app of material changes.</p>
      </Prose>
    </Site>
  );
}

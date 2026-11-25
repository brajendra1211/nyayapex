import { ExternalLink, HandHeart, Phone, ShieldAlert, UserCheck } from "lucide-react";
import { NotAdvice } from "@/components/personal/kit";
import { Card, PageHeader } from "@/components/ui";

const HELPLINES = [
  { n: "15100", t: "NALSA free legal aid helpline", d: "Free legal advice and help to get a free lawyer" },
  { n: "112", t: "Emergency (police, fire, ambulance)", d: "Any emergency, anywhere in India" },
  { n: "181", t: "Women helpline", d: "Violence, harassment or distress (in most states)" },
  { n: "1098", t: "Childline", d: "A child in danger or needing care" },
  { n: "1930", t: "Cyber crime / online fraud", d: "Report quickly; also cybercrime.gov.in" },
  { n: "1915", t: "National Consumer Helpline", d: "Complaints about goods and services" },
  { n: "14567", t: "Elderline", d: "Help for senior citizens" },
];

const ELIGIBLE = [
  "Women and children", "Members of Scheduled Castes and Scheduled Tribes", "Persons with disability",
  "Victims of trafficking or forced labour (begar)", "Victims of mass disaster, ethnic or caste violence, flood, drought, earthquake or industrial disaster",
  "Industrial workers", "Persons in custody (including protective homes and juvenile homes)",
  "Persons whose yearly income is below the limit fixed by the State (it differs from State to State)",
];

export default function LegalHelpPage() {
  return (
    <>
      <PageHeader title="Free legal help" subtitle="You may be entitled to a lawyer at no cost. Here is where to ask, and what to keep in mind." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={<span className="flex items-center gap-2"><HandHeart className="h-4 w-4 text-accent-ink" />Free legal aid</span>}>
            <p className="text-sm text-ink">Under the Legal Services Authorities Act, 1987 (section 12), these people can get a free lawyer, free court papers and free advice:</p>
            <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-ink-2">{ELIGIBLE.map((e) => <li key={e}>{e}</li>)}</ul>
            <div className="mt-4 space-y-2 text-sm text-ink">
              <p><b>Where to ask:</b> the <b>District Legal Services Authority (DLSA)</b> office in your district court, the Taluk Legal Services Committee,
                the High Court Legal Services Committee for High Court cases, and the <b>Supreme Court Legal Services Committee</b> for Supreme Court cases.</p>
              <p>Call <b>15100</b>, or apply online on the NALSA website. Free advice is also available at your nearest Common Service Centre under the <b>Tele-Law</b> scheme.</p>
              <p>Many disputes can also be settled for free at a <b>Lok Adalat</b>; its settlement is final and the court fee is refunded.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a href="https://nalsa.gov.in" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-accent"><ExternalLink className="h-3.5 w-3.5" />nalsa.gov.in</a>
              <a href="https://www.tele-law.in" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-accent"><ExternalLink className="h-3.5 w-3.5" />tele-law.in</a>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-accent-ink" />If you or a family member is arrested</span>}>
            <ul className="ml-5 list-disc space-y-1.5 text-sm text-ink">
              <li>You must be told the reasons for the arrest (Constitution, Article 22).</li>
              <li>You have the right to meet and be defended by a lawyer of your choice; if you cannot afford one, ask for free legal aid.</li>
              <li>You must be produced before a magistrate within 24 hours of arrest (travel time excluded).</li>
              <li>A family member or friend must be told about the arrest and where you are held.</li>
              <li>You can ask for a medical examination.</li>
              <li>Do not sign papers you have not read or understood. Ask for a copy of the FIR and of any memo you sign.</li>
            </ul>
          </Card>

          <Card title={<span className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-accent-ink" />Choosing and working with an advocate</span>}>
            <ul className="ml-5 list-disc space-y-1.5 text-sm text-ink">
              <li>Check that the advocate is enrolled with a State Bar Council; you can ask for the enrolment number.</li>
              <li>Agree on the fees and what they cover before starting, preferably in writing, and take receipts for payments.</li>
              <li>You appoint an advocate by signing a <b>vakalatnama</b>. Keep a copy.</li>
              <li>Give photocopies, keep the originals of your papers safe, and keep a list of what you handed over.</li>
              <li>Ask for copies of everything filed for you and of every order. Note every court date (you can do it in <b>My cases</b>).</li>
              <li>You may change your advocate at any time; the new advocate files a fresh vakalatnama (a &ldquo;no objection&rdquo; from the old advocate helps).</li>
            </ul>
            <p className="mt-3 text-xs text-muted">Nyay Apex does not recommend or advertise particular advocates; Bar Council rules do not allow advocates to advertise.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Helplines" pad={false}>
            <ul className="divide-y divide-line">
              {HELPLINES.map((h) => (
                <li key={h.n}>
                  <a href={`tel:${h.n}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink"><Phone className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{h.t}</span><span className="block text-xs text-ink-2">{h.d}</span></span>
                    <span className="text-lg font-semibold tabular-nums text-ink">{h.n}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <NotAdvice>This page gives general information. Rules and income limits can change and differ between States; your Legal Services Authority will tell you what applies to you.</NotAdvice>
        </div>
      </div>
    </>
  );
}

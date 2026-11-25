"use client";

import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Download, FileSignature, History, ListChecks, Plus, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CitationStatus } from "@/components/CitationStatus";
import { ReportAI } from "@/components/ReportAI";
import { AiLabel, Alert, Badge, Button, Card, Input, Label, Spinner, Textarea } from "@/components/ui";
import { api, download, postDownload, type FoundCitation, type MatterDoc } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";

const USD_INR = 88;

interface Party { name: string; description: string; status_below: string }
interface Annexure { label: string; description: string; document_id: number | null }
interface Inputs {
  petitioners: Party[]; respondents: Party[]; high_court: string; case_below: string; order_date: string; held: string;
  place: string; drawn_by: string; impugned_document_id?: number | null;
  deponent: { name: string; relation: string; age: string; address: string; capacity: string };
  options: { ia_exemption_cc: boolean; ia_stay: boolean; ia_delay: boolean; delay_days: number };
  annexures: Annexure[];
}
type Content = Record<string, string[]>;
interface AuditRow { event: string; who: string | null; detail: Record<string, unknown>; at: string }
interface Pkg {
  id: number; case_id: number; case_title: string; proceeding_label: string; inputs: Inputs; content: Content;
  ai_sections: string[]; ai_model: string | null; checks: Record<string, boolean>; checklist: { key: string; label: string }[];
  status: "draft" | "approved"; version: number; approved_by: string | null; approved_at: string | null; can_approve: boolean;
  aor: { name: string; aor_code: string | null }; verify_note: string; section_labels: Record<string, string>; audit: AuditRow[];
  can_convert: boolean;
  cost_usd?: number;
}
interface CheckResult { total: number; verified: number; cited: number; unknown: number; items: FoundCitation[] }

const STEPS = [
  { id: "details", label: "1 · Details" },
  { id: "content", label: "2 · Petition text" },
  { id: "verify", label: "3 · Verify & approve" },
  { id: "export", label: "4 · Export" },
] as const;
type Step = (typeof STEPS)[number]["id"];

// Paragraph sections are edited as text with a blank line between paragraphs; the list of dates one per line.
const SECTIONS: { key: string; hint: string; lines?: boolean; ai?: boolean }[] = [
  { key: "synopsis", hint: "A blank line between paragraphs", ai: true },
  { key: "list_of_dates", hint: "One per line — DD.MM.YYYY: event", lines: true },
  { key: "questions_of_law", hint: "One question per paragraph, starting “Whether …?”", ai: true },
  { key: "grounds", hint: "One ground per paragraph, starting “Because …”", ai: true },
  { key: "interim_grounds", hint: "Only if interim relief is sought", ai: true },
  { key: "main_prayer", hint: "One prayer per paragraph" },
  { key: "interim_prayer", hint: "Used when the stay I.A. is selected" },
  { key: "delay_explanation", hint: "Only if there is delay — goes into the condonation I.A.", ai: true },
];
const toText = (v: string[] | undefined, lines?: boolean) => (v ?? []).join(lines ? "\n" : "\n\n");
const fromText = (t: string, lines?: boolean) =>
  t.split(lines ? /\n/ : /\n\s*\n/).map((s) => s.trim()).filter(Boolean);

const EVENT_LABEL: Record<string, string> = {
  created: "Package created", edited: "Edited", ai_generated: "AI drafted", citations_checked: "Citations checked",
  checklist: "Checklist updated", approved: "Approved for filing", approval_revoked: "Approval withdrawn", exported: "Exported",
};

export default function FilingPage() {
  const idParam = useQueryParam("id");
  const id = idParam ? Number(idParam) : null;
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [docs, setDocs] = useState<MatterDoc[]>([]);
  const [step, setStep] = useState<Step>("details");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "warn"; text: string } | null>(null);

  const apply = useCallback((p: Pkg) => {
    setPkg(p);
    setInputs(p.inputs);
    setText(Object.fromEntries(SECTIONS.map((s) => [s.key, toText(p.content[s.key], s.lines)])));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!id) return;
    api<Pkg>(`/api/filing/${id}`).then((p) => {
      apply(p);
      api<MatterDoc[]>(`/api/matters/${p.case_id}/documents`).then(setDocs).catch(() => {});
    }).catch((e) => setMsg({ tone: "bad", text: e.message }));
  }, [id, apply]);

  if (!id) return <Alert tone="bad">No filing package selected. Open one from a matter’s “Filing” tab.</Alert>;
  if (!pkg || !inputs) return msg ? <Alert tone="bad">{msg.text}</Alert> : <Spinner />;

  const setIn = (patch: Partial<Inputs>) => { setInputs({ ...inputs, ...patch }); setDirty(true); };
  const content = (): Content => Object.fromEntries(SECTIONS.map((s) => [s.key, fromText(text[s.key] ?? "", s.lines)]));

  async function run<T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) {
    setBusy(label); setMsg(null);
    try { const r = await fn(); const m = ok?.(r); if (m) setMsg({ tone: "good", text: m }); return r; }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    finally { setBusy(null); }
  }
  const save = () => run("save", async () => {
    const p = await api<Pkg>(`/api/filing/${id}`, { method: "PATCH", json: { inputs, content: content() } });
    apply(p);
    return p;
  }, (p) => p.status === "draft" && pkg.status === "approved" ? "Saved. The edit withdrew the earlier approval — verify and approve again." : "Saved.");

  const approved = pkg.status === "approved";

  return (
    <>
      <Link href={`/matter?id=${pkg.case_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" />{pkg.case_title}</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink"><FileSignature className="h-6 w-6 text-muted" />{pkg.proceeding_label}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>Paper-book · version {pkg.version}</span>
            {approved ? <Badge tone="good"><CheckCircle2 className="h-3 w-3" />Approved by {pkg.approved_by}</Badge> : <Badge tone="warn">Draft — not yet verified</Badge>}
            {pkg.ai_sections.length > 0 && <Badge tone="accent"><Sparkles className="h-3 w-3" />AI assisted: {pkg.ai_sections.join(", ")}</Badge>}
          </div>
        </div>
        {(step === "details" || step === "content") && (
          <Button onClick={save} loading={busy === "save"} disabled={!dirty}><Save className="h-4 w-4" />{dirty ? "Save changes" : "Saved"}</Button>
        )}
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {STEPS.map((s) => (
          <button key={s.id} onClick={() => setStep(s.id)}
            className={clsx("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
              step === s.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{s.label}</button>
        ))}
      </div>

      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {dirty && step !== "details" && step !== "content" && <div className="mb-4"><Alert tone="warn">You have unsaved changes — go back and save them first.</Alert></div>}

      {step === "details" && <Details inputs={inputs} setIn={setIn} docs={docs} />}

      {step === "content" && (
        <div className="space-y-6">
          <Generate pkgId={id} busy={busy} dirty={dirty} run={run} apply={apply} />
          {SECTIONS.map((s) => {
            const label = pkg.section_labels[s.key];
            const isAi = pkg.ai_sections.includes(label);
            return (
              <Card key={s.key} title={label} actions={isAi ? <span className="flex items-center gap-3"><ReportAI feature="filing" excerpt={text[s.key]} context={{ package_id: id, section: s.key }} /><AiLabel /></span> : undefined}>
                <Textarea value={text[s.key] ?? ""} onChange={(e) => { setText({ ...text, [s.key]: e.target.value }); setDirty(true); }}
                  className={clsx(s.key === "synopsis" || s.key === "grounds" || s.key === "list_of_dates" ? "min-h-56" : "min-h-28", s.lines && "font-mono text-xs")} />
                <p className="mt-1.5 text-xs text-muted">{s.hint}</p>
              </Card>
            );
          })}
        </div>
      )}

      {step === "verify" && <Verify pkg={pkg} busy={busy} dirty={dirty} run={run} apply={apply} />}

      {step === "export" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={<span className="flex items-center gap-2"><Download className="h-4 w-4 text-muted" />Download</span>}>
            {approved
              ? <Alert tone="good">Approved version {pkg.version}. The Word file is clean, without the DRAFT mark.</Alert>
              : <Alert tone="warn">Not approved yet — the Word file will carry a “DRAFT — NOT VERIFIED” header. Complete step 3 for a clean copy.</Alert>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button loading={busy === "docx"} disabled={dirty} onClick={() => run("docx", () =>
                download(`/api/filing/${id}/docx`, `${pkg.case_title.replace(/[^A-Za-z0-9]+/g, "_")}_SLP_v${pkg.version}${approved ? "" : "_DRAFT"}.docx`))}>
                <Download className="h-4 w-4" />Paper-book (.docx)
              </Button>
              <Button variant="secondary" loading={busy === "annex"} disabled={dirty} onClick={() => run("annex", () =>
                download(`/api/filing/${id}/annexures`, `${pkg.case_title.replace(/[^A-Za-z0-9]+/g, "_")}_Annexures.pdf`))}>
                <Download className="h-4 w-4" />Annexures (.pdf)
              </Button>
              <Button variant="secondary" loading={busy === "disc"} onClick={() => run("disc", () =>
                download(`/api/filing/${id}/disclosure`, `${pkg.case_title.replace(/[^A-Za-z0-9]+/g, "_")}_AI_Disclosure.pdf`))}
                title="Which AI was used, for what, and how it was verified - for the Court if asked (Reg 43(4))">
                <Download className="h-4 w-4" />AI disclosure report (.pdf)
              </Button>
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-2">
              <li>Open the Word file and press <b>Ctrl+A, F9</b> to refresh index page numbers.</li>
              <li>Annexures are stamped “ANNEXURE P-n” and page-numbered; merge them after the petition when preparing the final PDF.</li>
              <li>Insert the copy of the impugned judgment where marked. Fill every “________” blank.</li>
              <li>{pkg.verify_note}</li>
            </ul>
          </Card>
          <FinalPdf pkg={pkg} dirty={dirty} />
          <div className="lg:col-span-2"><AuditTrail rows={pkg.audit} /></div>
        </div>
      )}
    </>
  );
}

interface FinalReport { pages: number; notes: string[]; approved: boolean; compliance: string; defects: { severity: string; issue: string }[] }

function FinalPdf({ pkg, dirty }: { pkg: Pkg; dirty: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FinalReport | null>(null);

  async function build() {
    setBusy(true); setError(null); setReport(null);
    const form = new FormData();
    if (file) form.append("petition", file);
    try {
      setReport(await postDownload<FinalReport>(`/api/filing/${pkg.id}/final-pdf`, form,
        `${pkg.case_title.replace(/[^A-Za-z0-9]+/g, "_")}_PaperBook_v${pkg.version}${pkg.status === "approved" ? "" : "_DRAFT"}.pdf`));
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-muted" />Final paper-book PDF</span>}>
      <p className="text-sm text-ink-2">
        One filing-ready PDF: the copy of the impugned judgment and the annexures are put in their places, a new index is
        made with the real page numbers, every page is numbered and bookmarked, and the Registry format check runs on the result.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-2">
        {pkg.can_convert ? <li>The server converts the Word file itself — or upload your finished version below.</li> : <>
          <li>Download the paper-book (.docx), fill the blanks and make your corrections in Word.</li>
          <li>In Word: File → Save As → PDF. Upload that PDF here.</li>
        </>}
        <li>Pick the copy of the impugned judgment in step 1 (Details) and link annexure PDFs there.</li>
      </ol>
      <div className="mt-4 space-y-3">
        <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink" />
        <Button onClick={build} loading={busy} disabled={dirty || (!file && !pkg.can_convert)}><Download className="h-4 w-4" />Build final PDF</Button>
      </div>
      {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
      {report && (
        <div className="mt-3 space-y-2">
          <Alert tone={report.compliance === "READY" ? "good" : report.compliance === "AT RISK" ? "warn" : "bad"}>
            <div className="font-medium">Downloaded · {report.pages} pages · Registry check: {report.compliance}{!report.approved && " · DRAFT watermark (not approved)"}</div>
            {report.notes.map((n, i) => <div key={i} className="text-xs">{n}</div>)}
          </Alert>
          {report.defects.length > 0 && (
            <ul className="space-y-1 text-xs">
              {report.defects.map((d, i) => <li key={i} className="flex gap-2"><Badge tone={d.severity === "critical" ? "bad" : d.severity === "major" ? "warn" : "neutral"}>{d.severity}</Badge><span className="text-ink">{d.issue}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Details({ inputs, setIn, docs }: { inputs: Inputs; setIn: (p: Partial<Inputs>) => void; docs: MatterDoc[] }) {
  const pdfs = docs.filter((d) => d.filename.toLowerCase().endsWith(".pdf"));
  const parties = (side: "petitioners" | "respondents", title: string) => (
    <Card title={title} actions={<Button variant="ghost" onClick={() => setIn({ [side]: [...inputs[side], { name: "", description: "", status_below: "" }] })}><Plus className="h-4 w-4" />Add</Button>}>
      <div className="space-y-3">
        {inputs[side].map((p, i) => {
          const set = (patch: Partial<Party>) => setIn({ [side]: inputs[side].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
              <Input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" />
              <Input value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder="S/o …, aged …, R/o … (or office address)" />
              <Button variant="ghost" disabled={inputs[side].length < 2} onClick={() => setIn({ [side]: inputs[side].filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
  const dep = (patch: Partial<Inputs["deponent"]>) => setIn({ deponent: { ...inputs.deponent, ...patch } });
  const opt = (patch: Partial<Inputs["options"]>) => setIn({ options: { ...inputs.options, ...patch } });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {parties("petitioners", "Petitioner(s)")}
      {parties("respondents", "Respondent(s)")}
      <Card title="Impugned judgment">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>High Court of</Label><Input value={inputs.high_court} onChange={(e) => setIn({ high_court: e.target.value })} placeholder="Delhi at New Delhi" /></div>
          <div><Label>Case number below</Label><Input value={inputs.case_below} onChange={(e) => setIn({ case_below: e.target.value })} placeholder="W.P.(C) No. 1234 of 2024" /></div>
          <div><Label>Date of judgment</Label><Input type="date" value={inputs.order_date} onChange={(e) => setIn({ order_date: e.target.value })} /></div>
          <div><Label hint="for the final PDF">Copy of the judgment</Label>
            <select value={inputs.impugned_document_id ?? ""} onChange={(e) => setIn({ impugned_document_id: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
              <option value="">— not uploaded —</option>
              {pdfs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select></div>
          <div className="sm:col-span-2"><Label hint="completes “whereby the High Court …”">What it held</Label>
            <Textarea value={inputs.held} onChange={(e) => setIn({ held: e.target.value })} className="min-h-16" placeholder="dismissed the writ petition filed by the Petitioner" /></div>
        </div>
      </Card>
      <Card title="Applications (I.A.s)">
        <div className="space-y-3 text-sm text-ink">
          <Check checked={inputs.options.ia_exemption_cc} onChange={(v) => opt({ ia_exemption_cc: v })}>Exemption from filing certified copy</Check>
          <Check checked={inputs.options.ia_stay} onChange={(v) => opt({ ia_stay: v })}>Ex-parte ad-interim stay</Check>
          <Check checked={inputs.options.ia_delay} onChange={(v) => opt({ ia_delay: v })}>Condonation of delay</Check>
          {inputs.options.ia_delay && (
            <div className="ml-6 max-w-40"><Label>Delay (days)</Label>
              <Input type="number" min={0} value={inputs.options.delay_days} onChange={(e) => opt({ delay_days: Number(e.target.value) })} /></div>
          )}
        </div>
      </Card>
      <Card title="Deponent (affidavit)">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Name</Label><Input value={inputs.deponent.name} onChange={(e) => dep({ name: e.target.value })} /></div>
          <div><Label>Relation</Label><Input value={inputs.deponent.relation} onChange={(e) => dep({ relation: e.target.value })} placeholder="S/o Shri …" /></div>
          <div><Label>Age</Label><Input value={inputs.deponent.age} onChange={(e) => dep({ age: e.target.value })} /></div>
          <div><Label>Capacity</Label><Input value={inputs.deponent.capacity} onChange={(e) => dep({ capacity: e.target.value })} placeholder="Petitioner / authorised representative" /></div>
          <div className="sm:col-span-2"><Label>Address</Label><Input value={inputs.deponent.address} onChange={(e) => dep({ address: e.target.value })} /></div>
          <div><Label>Place</Label><Input value={inputs.place} onChange={(e) => setIn({ place: e.target.value })} /></div>
          <div><Label>Drawn by</Label><Input value={inputs.drawn_by} onChange={(e) => setIn({ drawn_by: e.target.value })} placeholder="Advocate’s name" /></div>
        </div>
      </Card>
      <Card title="Annexures" actions={<Button variant="ghost" onClick={() => setIn({ annexures: [...inputs.annexures, { label: `P-${inputs.annexures.length + 1}`, description: "", document_id: null }] })}><Plus className="h-4 w-4" />Add</Button>}>
        <p className="mb-3 text-xs text-ink-2">Pick PDFs uploaded to this matter. They are stamped “ANNEXURE P-n” and page-numbered in the annexures file.</p>
        <div className="space-y-2">
          {inputs.annexures.map((a, i) => {
            const set = (patch: Partial<Annexure>) => setIn({ annexures: inputs.annexures.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[4.5rem_1fr_1fr_auto]">
                <Input value={a.label} onChange={(e) => set({ label: e.target.value })} />
                <Input value={a.description} onChange={(e) => set({ description: e.target.value })} placeholder="True copy of …" />
                <select value={a.document_id ?? ""} onChange={(e) => set({ document_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                  <option value="">— no file —</option>
                  {pdfs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                </select>
                <Button variant="ghost" onClick={() => setIn({ annexures: inputs.annexures.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {!inputs.annexures.length && <p className="text-xs text-muted">No annexures yet.</p>}
        </div>
      </Card>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
      <span>{children}</span>
    </label>
  );
}

type Run = <T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) => Promise<T | undefined>;

function Generate({ pkgId, busy, dirty, run, apply }: { pkgId: number; busy: string | null; dirty: boolean; run: Run; apply: (p: Pkg) => void }) {
  const [facts, setFacts] = useState("");
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-muted" />Draft with AI (optional)</span>}>
      <p className="mb-3 text-sm text-ink-2">
        Claude drafts the synopsis, questions of law, grounds and delay explanation from the list of dates, the record brief and
        your notes below. Fixed parts (prayers, affidavit, certificate, I.A. text) are never written by AI. AI-drafted sections are
        declared in the AI-use statement and must be verified line by line.
      </p>
      <Textarea value={facts} onChange={(e) => setFacts(e.target.value)} className="min-h-24"
        placeholder="Key facts, the error in the High Court’s judgment, points you want argued…" />
      {dirty && <p className="mt-2 text-xs text-warn-ink">Save your edits first — AI drafting replaces the generated sections.</p>}
      <div className="mt-3">
        <Button loading={busy === "gen"} disabled={dirty} onClick={() => run("gen", async () => {
          const p = await api<Pkg>(`/api/filing/${pkgId}/generate`, { method: "POST", json: { extra_facts: facts } });
          apply(p);
          return p;
        }, (p) => `Drafted. Cost $${(p.cost_usd ?? 0).toFixed(3)} ≈ ₹${((p.cost_usd ?? 0) * USD_INR).toFixed(2)}. Review every section below.`)}>
          <Sparkles className="h-4 w-4" />Draft sections
        </Button>
      </div>
    </Card>
  );
}

function Verify({ pkg, busy, dirty, run, apply }: { pkg: Pkg; busy: string | null; dirty: boolean; run: Run; apply: (p: Pkg) => void }) {
  const [check, setCheck] = useState<CheckResult | null>(null);
  const items = pkg.checklist.filter((c) => c.key !== "ai" || pkg.ai_sections.length > 0);
  const allDone = items.every((c) => pkg.checks[c.key]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-muted" />Citations in the petition</span>}>
        <p className="mb-3 text-xs text-ink-2">Every citation in the synopsis, grounds and prayers is matched against the Supreme Court library.</p>
        <Button variant="secondary" loading={busy === "cite"} disabled={dirty}
          onClick={() => run("cite", async () => { const r = await api<CheckResult>(`/api/filing/${pkg.id}/check-citations`, { method: "POST" }); setCheck(r); return r; })}>
          <ListChecks className="h-4 w-4" />Check citations
        </Button>
        {check && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge>{check.total} found</Badge><Badge tone="good">{check.verified} in library</Badge>
              <Badge tone="brand">{check.cited} cited elsewhere</Badge>{check.unknown > 0 && <Badge tone="warn">{check.unknown} not found</Badge>}
            </div>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {check.items.map((i) => (
                <li key={i.citation} className="rounded-md bg-surface-2 px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-ink">{i.citation}</span><CitationStatus status={i.status} /></div>
                  {i.case_name && <div className="truncate text-xs text-ink-2">{i.case_name}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted" />Advocate’s verification</span>}>
        <p className="mb-3 text-xs text-ink-2">Required by the SC draft AI Regulations: AI output is advisory and the filing advocate must verify it. Each tick is recorded in the audit trail.</p>
        <div className="space-y-3 text-sm text-ink">
          {items.map((c) => (
            <Check key={c.key} checked={!!pkg.checks[c.key]} onChange={(v) => run("chk", async () => {
              const p = await api<Pkg>(`/api/filing/${pkg.id}/checks`, { method: "POST", json: { checks: { [c.key]: v } } });
              apply(p);
              return p;
            })}>{c.label}</Check>
          ))}
        </div>
        <div className="mt-5 border-t border-line pt-4">
          {pkg.status === "approved" ? (
            <Alert tone="good">Approved by {pkg.approved_by}. Any later edit withdraws the approval automatically.</Alert>
          ) : pkg.can_approve ? (
            <Button disabled={!allDone || dirty} loading={busy === "approve"} onClick={() => run("approve", async () => {
              const p = await api<Pkg>(`/api/filing/${pkg.id}/approve`, { method: "POST" });
              apply(p);
              return p;
            }, () => "Approved. The Word export is now a clean copy.")}>
              <CheckCircle2 className="h-4 w-4" />Approve for filing
            </Button>
          ) : (
            <Alert tone="info">Only the AOR, senior or matter lead can approve. Tick the checklist and ask them to approve.</Alert>
          )}
        </div>
      </Card>
      <div className="lg:col-span-2"><AuditTrail rows={pkg.audit} /></div>
    </div>
  );
}

function AuditTrail({ rows }: { rows: AuditRow[] }) {
  const describe = (r: AuditRow) => {
    const d = r.detail ?? {};
    if (r.event === "edited") return (d.sections as string[] | undefined)?.join(", ");
    if (r.event === "ai_generated") return `${d.model} · ${(d.sections as string[]).join(", ")} · $${d.cost_usd}`;
    if (r.event === "citations_checked") return `${d.total} found · ${d.verified} in library · ${d.unknown} not found`;
    if (r.event === "checklist") return Object.entries(d).map(([k, v]) => `${k}: ${v ? "✓" : "✗"}`).join(", ");
    if (r.event === "exported") return `${d.format}${d.approved === false ? " (draft)" : ""}`;
    if (r.event === "approved") return `version ${d.version}`;
    return null;
  };
  return (
    <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-muted" />Audit trail</span>}>
      <ul className="max-h-96 space-y-2 overflow-y-auto">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-ink">{EVENT_LABEL[r.event] ?? r.event}</span>
              {describe(r) && <span className="text-ink-2"> — {describe(r)}</span>}
              <div className="text-xs text-muted">{r.who ?? "—"}</div>
            </div>
            <span className="shrink-0 text-xs text-muted">{new Date(r.at + "Z").toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

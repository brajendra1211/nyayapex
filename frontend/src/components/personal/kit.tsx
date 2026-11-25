"use client";

import clsx from "clsx";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui";
import type { CaseDetails } from "@/lib/api";

/** Shown wherever an individual reads AI output or legal material: information, not advice. */
export function NotAdvice({ children }: { children?: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-3 text-sm text-ink">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" />
      <div>
        {children ?? <>This is general legal information to help you understand your case. It is <b>not legal advice</b> and it does not say how your
          case will end. Please confirm anything important with an advocate, or with free legal aid (call <b>15100</b>).</>}
      </div>
    </div>
  );
}

export type Lang = "en" | "hi";

export function LangToggle({ value, onChange }: { value: Lang; onChange: (v: Lang) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm" role="group" aria-label="Answer language">
      {([["en", "English"], ["hi", "हिन्दी"]] as const).map(([id, label]) => (
        <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={value === id}
          className={clsx("rounded-md px-3 py-1", value === id ? "bg-brand text-brand-ink" : "text-ink-2 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Renders the AI's plain text with its light markdown (headings, lists, bold) - no HTML injection. */
export function AiText({ text }: { text: string }) {
  const bold = (line: string) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="ml-5 list-disc space-y-1">{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const head = line.match(/^#{1,4}\s+(.*)$/) ?? line.match(/^(\d+\.\s+[^a-z].{0,80})$/) ?? line.match(/^\*\*([^*]+)\*\*:?$/);
    const item = line.match(/^\s*[-*•]\s+(.*)$/);
    if (!line.trim()) { flush(); return; }
    if (item) { list.push(<li key={i}>{bold(item[1])}</li>); return; }
    flush();
    if (head) blocks.push(<h3 key={i} className="mt-4 text-[15px] font-semibold text-ink first:mt-0">{head[1].replace(/\*\*/g, "")}</h3>);
    else blocks.push(<p key={i}>{bold(line)}</p>);
  });
  flush();
  return <div className="space-y-2 text-[15px] leading-relaxed text-ink">{blocks}</div>;
}

// ------------------------------------------------------------------ case form

export const CASE_KINDS = ["Criminal (FIR / police case)", "Civil", "Property / land", "Family / divorce / maintenance", "Cheque bounce",
  "Consumer complaint", "Job / service matter", "Rent / tenancy", "Motor accident claim", "Other"];
export const MY_ROLES = ["I filed the case (petitioner / complainant / plaintiff)", "Case is against me (respondent / accused / defendant)",
  "Witness", "Family member of a party", "Other"];
export const COURTS = ["Not in court yet", "Police station (FIR stage)", "District / Sessions court", "Magistrate court", "Family court",
  "Consumer commission", "Tribunal", "High Court", "Supreme Court", "Other"];
export const STAGES = ["Not filed yet", "Police investigation", "Filed / pending", "Notice / summons stage", "Evidence", "Arguments",
  "Judgment reserved", "Decided", "In appeal", "Settled / closed"];

export interface CaseForm {
  title: string; stage: string; case_number: string; next_hearing: string; details: CaseDetails;
}

export const emptyCase: CaseForm = { title: "", stage: STAGES[2], case_number: "", next_hearing: "", details: {} };

export function CaseFields({ value, onChange }: { value: CaseForm; onChange: (v: CaseForm) => void }) {
  const d = value.details;
  const setD = (k: keyof CaseDetails, v: string) => onChange({ ...value, details: { ...d, [k]: v } });
  const pick = (k: keyof CaseDetails, label: string, options: string[], hint?: string) => (
    <div><Label hint={hint}>{label}</Label>
      <Select value={(d[k] as string) ?? ""} onChange={(e) => setD(k, e.target.value)}>
        <option value="">Select…</option>{options.map((o) => <option key={o}>{o}</option>)}
      </Select></div>
  );
  const text = (k: keyof CaseDetails, label: string, hint?: string, placeholder?: string) => (
    <div><Label hint={hint}>{label}</Label><Input value={(d[k] as string) ?? ""} onChange={(e) => setD(k, e.target.value)} placeholder={placeholder} /></div>
  );
  const criminal = (d.case_kind ?? "").startsWith("Criminal");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>A short name for your case</Label>
          <Input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="e.g. Land dispute with Ramesh, or Cheque bounce case" /></div>
        {pick("case_kind", "Type of case", CASE_KINDS)}
        {pick("my_role", "Your side in the case", MY_ROLES)}
        {text("other_party", "Other party", "optional", "Name of the person / company on the other side")}
        {pick("court", "Where is it now?", COURTS)}
        {text("city", "Court / police station city", "optional")}
        <div><Label>Stage</Label>
          <Select value={value.stage} onChange={(e) => onChange({ ...value, stage: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</Select></div>
        <div><Label hint="as written on court papers, optional">Case number</Label>
          <Input value={value.case_number} onChange={(e) => onChange({ ...value, case_number: e.target.value })} placeholder="e.g. CS 123/2025" /></div>
        <div><Label hint="optional">Next date in court</Label>
          <Input type="date" value={value.next_hearing} onChange={(e) => onChange({ ...value, next_hearing: e.target.value })} /></div>
        {criminal && text("fir_no", "FIR number", "optional", "e.g. 245/2025")}
        {criminal && text("police_station", "Police station", "optional")}
        {text("filed_on", "Case / FIR date", "optional", "e.g. 12 March 2025")}
      </div>
      <div><Label hint="in your own words, optional">What is the case about?</Label>
        <Textarea value={d.summary ?? ""} onChange={(e) => setD("summary", e.target.value)} rows={4}
          placeholder="What happened, when, and what you or the other side is asking for. This stays private to your account." /></div>
      <div>
        <div className="mb-2 text-sm font-semibold text-ink">Your advocate <span className="font-normal text-muted">(optional)</span></div>
        <div className="grid gap-4 sm:grid-cols-3">
          {text("advocate_name", "Name")}
          {text("advocate_phone", "Phone")}
          {text("advocate_email", "Email")}
        </div>
      </div>
    </div>
  );
}

/** Case form values -> the /api/cases body (common fields + details). */
export function caseBody(f: CaseForm) {
  return {
    title: f.title.trim(), stage: f.stage, case_number: f.case_number.trim() || null, next_hearing: f.next_hearing || null,
    case_type: (f.details.case_kind ?? "Other").slice(0, 40), bench: f.details.court ?? null, details: f.details,
  };
}

export const ROLE_SHORT: Record<string, string> = {
  [MY_ROLES[0]]: "You filed it", [MY_ROLES[1]]: "Against you", [MY_ROLES[2]]: "Witness", [MY_ROLES[3]]: "Family member", [MY_ROLES[4]]: "Other",
};

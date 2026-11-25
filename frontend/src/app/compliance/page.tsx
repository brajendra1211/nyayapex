"use client";

import clsx from "clsx";
import { CalendarClock, FileCheck2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, StatusBadge, fmtDate } from "@/components/ui";
import { api, upload, type Case, type Defect, type FilingStatus } from "@/lib/api";

interface Report {
  status: FilingStatus; pages: number; body_font_size: number; body_font: string;
  annexures_found: string[]; defects: Defect[]; note: string;
}
interface LimitType { id: string; label: string; days: number | null; basis: string }
interface LimitRes {
  label: string; basis: string; last_date: string | null; status: string; steps: string[]; warnings: string[];
  days_left?: number; delay_days?: number;
}

export default function CompliancePage() {
  const [cases, setCases] = useState<Case[]>([]);
  useEffect(() => { api<Case[]>("/api/cases").then(setCases).catch(() => {}); }, []);

  return (
    <>
      <PageHeader title="Registry Compliance" subtitle="Know your filing status before you reach the registry counter. Rule-based — zero AI tokens." />
      <div className="grid gap-6 xl:grid-cols-2">
        <FormatCheck cases={cases} />
        <LimitationCalc cases={cases} />
      </div>
    </>
  );
}

function FormatCheck({ cases }: { cases: Case[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caseId, setCaseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setLoading(true); setError(null);
    const form = new FormData();
    form.append("file", file);
    if (caseId) form.append("case_id", caseId);
    try { setReport(await upload<Report>("/api/compliance/check", form)); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <Card title="Paper-book format check">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <button onClick={() => input.current?.click()}
            className="flex flex-1 items-center gap-3 rounded-lg border-2 border-dashed border-line px-4 py-3 text-left hover:border-brand/50">
            <UploadCloud className="h-5 w-5 text-muted" />
            <span className="truncate text-sm text-ink">{file?.name ?? "Choose final PDF…"}</span>
            <input ref={input} type="file" accept=".pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </button>
          <div className="sm:w-44">
            <Label>Update matter</Label>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">— none —</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </div>
          <Button onClick={run} loading={loading} disabled={!file}>Check</Button>
        </div>
        {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
      </Card>

      {report ? (
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-2">Filing readiness status</div>
              <div className="mt-1.5"><StatusBadge status={report.status} large /></div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-right text-sm">
              <div><div className="text-xs text-muted">Pages</div><div className="font-medium tabular-nums text-ink">{report.pages}</div></div>
              <div><div className="text-xs text-muted">Body font</div><div className="font-medium tabular-nums text-ink">{report.body_font_size} pt</div></div>
              <div><div className="text-xs text-muted">Annexures</div><div className="font-medium tabular-nums text-ink">{report.annexures_found.length}</div></div>
            </div>
          </div>
          {report.defects.length ? (
            <ul className="divide-y divide-line">
              {report.defects.map((d) => (
                <li key={d.code} className="flex gap-3 px-5 py-3.5">
                  <Badge tone={d.severity === "critical" ? "bad" : d.severity === "major" ? "warn" : "neutral"}>{d.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{d.issue}</p>
                    <p className="mt-0.5 text-sm text-ink-2">Fix: {d.fix}</p>
                    {d.pages.length > 0 && <p className="mt-0.5 text-xs text-muted">Pages: {d.pages.join(", ")}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="p-5"><Alert tone="good">No defects found by the automated check.</Alert></div>}
          <p className="border-t border-line px-5 py-3 text-xs text-muted">{report.note}</p>
        </Card>
      ) : <Card><Empty icon={FileCheck2} title="Upload the final paper-book">Checks A4 size, font, margins, pagination, index, synopsis, prayer, affidavit and annexure marking.</Empty></Card>}
    </div>
  );
}

function LimitationCalc({ cases }: { cases: Case[] }) {
  const [types, setTypes] = useState<LimitType[]>([]);
  const [f, setF] = useState({ kind: "slp_judgment", order_date: "", copy_applied: "", copy_ready: "", filing_date: "", case_id: "" });
  const [res, setRes] = useState<LimitRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<LimitType[]>("/api/compliance/limitation/types").then(setTypes).catch(() => {}); }, []);

  async function calc() {
    setError(null);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
    try { setRes(await api<LimitRes>("/api/compliance/limitation", { method: "POST", json: { ...body, case_id: f.case_id ? Number(f.case_id) : undefined } })); }
    catch (e) { setError((e as Error).message); }
  }

  const barred = res?.status === "TIME-BARRED";
  return (
    <div className="space-y-6">
      <Card title="Limitation calculator">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Proceeding</Label>
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.days ? ` — ${t.days} days` : ""}</option>)}
            </Select>
          </div>
          <div><Label>Date of judgment / order</Label><Input type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} /></div>
          <div><Label hint="default today">Intended filing date</Label><Input type="date" value={f.filing_date} onChange={(e) => setF({ ...f, filing_date: e.target.value })} /></div>
          <div><Label hint="optional">Certified copy applied</Label><Input type="date" value={f.copy_applied} onChange={(e) => setF({ ...f, copy_applied: e.target.value })} /></div>
          <div><Label hint="optional">Certified copy ready</Label><Input type="date" value={f.copy_ready} onChange={(e) => setF({ ...f, copy_ready: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <Label hint="saves expiry date">Matter</Label>
            <Select value={f.case_id} onChange={(e) => setF({ ...f, case_id: e.target.value })}>
              <option value="">— none —</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </div>
        </div>
        {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
        <Button className="mt-4 w-full" onClick={calc} disabled={!f.order_date}><CalendarClock className="h-4 w-4" />Calculate</Button>
      </Card>

      {res && (
        <Card>
          <div className={clsx("rounded-lg border-2 p-4", barred ? "border-bad/60" : "border-good/50")}>
            <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{res.label}</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{res.last_date ? fmtDate(res.last_date) : "No fixed period"}</div>
            <div className={clsx("mt-1 text-sm font-medium", barred ? "text-bad-ink" : "text-good-ink")}>
              {res.status}{res.days_left != null && ` · ${res.days_left} day(s) left`}{res.delay_days != null && ` · delay of ${res.delay_days} day(s)`}
            </div>
          </div>
          {barred && <div className="mt-3"><Alert tone="bad">An application for condonation of delay under Section 5 is required. Use the Drafting Assistant to prepare it.</Alert></div>}
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-2">Working</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">{res.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="mt-3 text-xs text-muted">Basis: {res.basis}</p>
          {res.warnings.map((w, i) => <div key={i} className="mt-2"><Alert tone="warn">{w}</Alert></div>)}
        </Card>
      )}
    </div>
  );
}

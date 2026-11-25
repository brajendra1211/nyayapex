"use client";

import clsx from "clsx";
import { FileText, Loader2, MessageSquareText, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiLabel, Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Spinner, fmtDate } from "@/components/ui";
import { ReportAI } from "@/components/ReportAI";
import { api, upload, type Case, type Doc } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";

const TABS = ["Brief", "Chronology", "Citations", "Ask the record", "Token savings", "Access log"] as const;
type Tab = (typeof TABS)[number];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const urlId = useQueryParam("id");
  const [picked, setSelected] = useState<number | null>(null);
  const selected = picked ?? (urlId ? Number(urlId) : null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<Doc[]>("/api/documents").then(setDocs).catch((e) => setError(e.message)), []);

  useEffect(() => {
    load();
    api<Case[]>("/api/cases").then(setCases).catch(() => {});
  }, [load]);

  // Poll while anything is processing
  const busy = docs.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  return (
    <>
      <PageHeader title="Document Intelligence"
        subtitle="Upload a case record (PDF/DOCX, 1,000+ pages). Chronology and citations are extracted in Python at zero AI cost; Claude only writes the brief." />
      {error && <div className="mb-4"><Alert tone="bad">{error}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <UploadCard cases={cases} onUploaded={(d) => { load(); setSelected(d.id); }} />
          <Card title={`Records (${docs.length})`} pad={false}>
            {docs.length ? (
              <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button onClick={() => setSelected(d.id)}
                      className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60", selected === d.id && "bg-surface-2")}>
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{d.filename}</div>
                        <div className="text-xs text-muted">{d.pages || "–"} pages · {fmtDate(d.created_at)}</div>
                      </div>
                      <DocStatus status={d.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={FileText} title="No records uploaded" />}
          </Card>
        </div>

        {selected ? <DocDetail id={selected} key={selected} onDeleted={() => { setSelected(null); load(); }} />
          : <Card><Empty icon={FileText} title="Select a record">Upload a record or pick one from the list to see its brief, chronology and citations.</Empty></Card>}
      </div>
    </>
  );
}

function DocStatus({ status }: { status: Doc["status"] }) {
  if (status === "done") return <Badge tone="good">done</Badge>;
  if (status === "failed") return <Badge tone="bad">failed</Badge>;
  return <Badge><Loader2 className="h-3 w-3 animate-spin" />{status}</Badge>;
}

function UploadCard({ cases, onUploaded }: { cases: Case[]; onUploaded: (d: Doc) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caseId, setCaseId] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [batch, setBatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function submit() {
    if (!file) return;
    setLoading(true); setError(null);
    const form = new FormData();
    form.append("file", file);
    if (caseId) form.append("case_id", caseId);
    form.append("use_ai", String(useAi));
    form.append("use_batch", String(batch));
    try {
      onUploaded(await upload<Doc>("/api/documents", form));
      setFile(null);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  return (
    <Card title="Upload record">
      <div
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        className={clsx("cursor-pointer rounded-lg border-2 border-dashed px-4 py-6 text-center transition",
          drag ? "border-brand bg-brand/5" : "border-line hover:border-brand/50")}
      >
        <UploadCloud className="mx-auto h-7 w-7 text-muted" />
        <p className="mt-2 text-sm font-medium text-ink">{file ? file.name : "Drop PDF / DOCX here"}</p>
        <p className="text-xs text-muted">{file ? `${(file.size / 1048576).toFixed(1)} MB` : "or click to browse · up to 200 MB"}</p>
        <input ref={input} type="file" accept=".pdf,.docx,.txt" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <Label>Link to matter</Label>
          <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">— none —</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
          <span>AI brief<span className="block text-xs text-muted">Off = only free Python extraction</span></span>
        </label>
        <label className={clsx("flex items-start gap-2 text-sm text-ink", !useAi && "opacity-50")}>
          <input type="checkbox" checked={batch} disabled={!useAi} onChange={(e) => setBatch(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
          <span>Overnight batch mode<span className="block text-xs text-muted">50% cheaper; ready within a few hours</span></span>
        </label>
        {error && <Alert tone="bad">{error}</Alert>}
        <Button className="w-full" onClick={submit} disabled={!file} loading={loading}>Analyse record</Button>
      </div>
    </Card>
  );
}

function DocDetail({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [tab, setTab] = useState<Tab>("Brief");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const fetchDoc = () => api<Doc>(`/api/documents/${id}`).then((d) => {
      if (stop) return;
      setDoc(d);
      if (d.status === "queued" || d.status === "processing") setTimeout(fetchDoc, 3000);
    }).catch((e) => setError(e.message));
    fetchDoc();
    return () => { stop = true; };
  }, [id]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!doc) return <Card><Spinner /></Card>;

  return (
    <Card pad={false}
      title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted" />{doc.filename}</span>}
      actions={<Button variant="danger" onClick={async () => { if (confirm("Delete this record?")) { await api(`/api/documents/${id}`, { method: "DELETE" }); onDeleted(); } }}>
        <Trash2 className="h-4 w-4" /></Button>}>
      {doc.status !== "done" ? (
        <div className="p-5">
          {doc.status === "failed" ? <Alert tone="bad">Processing failed: {doc.error}</Alert>
            : <Spinner label="Extracting text, removing noise, building chronology… large records take a few minutes." />}
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={clsx("whitespace-nowrap border-b-2 px-3 py-3 text-sm transition",
                  tab === t ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{t}</button>
            ))}
          </div>
          <div className="p-5">
            {doc.error && <div className="mb-4"><Alert tone="warn">{doc.error}</Alert></div>}
            {tab === "Brief" && <BriefView doc={doc} />}
            {tab === "Chronology" && <ChronologyView doc={doc} />}
            {tab === "Citations" && <CitationsView doc={doc} />}
            {tab === "Ask the record" && <AskView id={doc.id} />}
            {tab === "Token savings" && <SavingsView doc={doc} />}
            {tab === "Access log" && <AccessView id={doc.id} />}
          </div>
        </>
      )}
    </Card>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function BriefView({ doc }: { doc: Doc }) {
  const b = doc.brief;
  if (!b) return <Alert tone="info">No AI brief for this record (AI was off or no API key). Chronology and citations are still available.</Alert>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><AiLabel /><ReportAI feature="brief" excerpt={b.summary} context={{ document_id: doc.id }} logId={doc.brief_ai_log_id} /></div>
      <p className="text-sm leading-relaxed text-ink">{b.summary}</p>
      <div className="grid gap-5 md:grid-cols-2">
        <List title="Core issues" items={b.core_issues} />
        <List title="Ancillary issues" items={b.ancillary_issues} />
        <List title="Questions of law" items={b.questions_of_law} />
        <List title="Points for hearing" items={b.hearing_points} />
      </div>
      {b.articles?.length > 0 && <div className="flex flex-wrap gap-1.5">{b.articles.map((a) => <Badge key={a} tone="brand">{a}</Badge>)}</div>}
      {b.contradictions?.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Contradictions in the record</h3>
          <div className="space-y-2">
            {b.contradictions.map((c, i) => (
              <Alert key={i} tone="warn">{c.point} <span className="text-muted">— pp. {c.pages.join(", ")}</span></Alert>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChronologyView({ doc }: { doc: Doc }) {
  const [q, setQ] = useState("");
  const events = (doc.chronology ?? []).filter((e) => !q || e.event.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Input placeholder="Filter events…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <span className="text-xs text-muted">{events.length} events</span>
      </div>
      {events.length ? (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-ink">{e.date ? fmtDate(e.date) : "Undated"}</span>
                <span className="text-xs text-muted">p. {e.pages.filter(Boolean).join(", ")}</span>
                {e.source === "ai" && <Badge tone="accent">AI</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-ink-2">{e.event}</p>
            </li>
          ))}
        </ol>
      ) : <Empty icon={FileText} title="No dated events found" />}
    </div>
  );
}

function CitationsView({ doc }: { doc: Doc }) {
  const cites = doc.citations ?? [];
  if (!cites.length) return <Empty icon={FileText} title="No citations detected" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-2">
          <tr className="border-b border-line"><th className="py-2 pr-3 font-medium">Citation</th><th className="py-2 pr-3 font-medium">Case</th>
            <th className="py-2 pr-3 font-medium">Reporter</th><th className="py-2 font-medium">Pages</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {cites.map((c) => (
            <tr key={c.citation}>
              <td className="py-2.5 pr-3 font-mono text-xs text-ink">{c.citation}</td>
              <td className="py-2.5 pr-3 text-ink-2">{c.case_name || "—"}</td>
              <td className="py-2.5 pr-3"><Badge>{c.reporter}</Badge></td>
              <td className="py-2.5 text-xs text-muted">{c.pages.slice(0, 8).join(", ")}{c.pages.length > 8 ? "…" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AskView({ id }: { id: number }) {
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<{ answer: string; sources: { pages: number[] }[]; ai_log_id?: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setLoading(true); setError(null);
    try { setRes(await api(`/api/documents/${id}/ask`, { method: "POST", json: { question: q, deep } })); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(); }} className="flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. When was the notice under Section 4 issued?" />
        <Button type="submit" loading={loading} disabled={!q.trim()}><MessageSquareText className="h-4 w-4" />Ask</Button>
      </form>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="accent-[var(--brand)]" />
        Deep answer (smarter model, costs more)
      </label>
      {error && <Alert tone="bad">{error}</Alert>}
      {res && (
        <div className="space-y-2 rounded-lg bg-surface-2 p-4">
          <AiLabel />
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{res.answer}</p>
          <p className="text-xs text-muted">Searched pages: {res.sources.map((s) => `${s.pages[0]}–${s.pages[1]}`).join(", ")}</p>
          <ReportAI feature="doc_qa" excerpt={res.answer} context={{ document_id: id, question: q }} logId={res.ai_log_id} />
        </div>
      )}
    </div>
  );
}

function SavingsView({ doc }: { doc: Doc }) {
  const s = doc.stats;
  if (!s) return null;
  const sent = (s.tokens_sent_est ?? 0) + (s.brief_input_tokens_est ?? 0);
  const rows: [string, string | number][] = [
    ["Pages", s.pages],
    ["Scanned pages OCR'd locally", s.ocr_pages],
    ["Duplicate pages removed", s.duplicate_pages_removed],
    ["Header/footer noise removed", `${s.noise_removed_pct}%`],
    ["Chunks / sent to AI", `${s.chunks} / ${s.chunks_sent_to_ai ?? 0}`],
    ["Raw record (est. tokens)", s.tokens_raw_est.toLocaleString("en-IN")],
    ["Sent to cheap model (est.)", (s.tokens_sent_est ?? 0).toLocaleString("en-IN")],
    ["Sent to smart model for brief (est.)", (s.brief_input_tokens_est ?? 0).toLocaleString("en-IN")],
  ];
  return (
    <div className="space-y-4">
      {s.reused_from && <Alert tone="good">Same file was analysed before (record #{s.reused_from}) — results reused, 0 tokens spent.</Alert>}
      {s.tokens_raw_est > 0 && s.brief_input_tokens_est != null && (
        <Alert tone="info">
          The smart model read <b>{s.brief_input_tokens_est.toLocaleString("en-IN")}</b> tokens instead of the full{" "}
          <b>{s.tokens_raw_est.toLocaleString("en-IN")}</b> — about{" "}
          <b>{Math.round(100 - (100 * s.brief_input_tokens_est) / s.tokens_raw_est)}%</b> less. Total sent to any model: {sent.toLocaleString("en-IN")}.
        </Alert>
      )}
      <dl className="divide-y divide-line rounded-lg border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5 text-sm"><dt className="text-ink-2">{k}</dt><dd className="font-medium tabular-nums text-ink">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

interface AccessRow { id: number; action: string; at: string; who: string; client: boolean; question: string | null; document_id: number }

/** Who opened, downloaded or questioned this record (all versions), newest first. */
function AccessView({ id }: { id: number }) {
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<AccessRow[]>(`/api/documents/${id}/access`).then(setRows).catch((e) => setError(e.message)); }, [id]);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="text-sm text-muted">No access recorded yet.</p>;
  return (
    <ol className="divide-y divide-line text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span className="text-ink"><b className="font-medium">{r.who}</b>{r.client && " (client)"} {r.action}{r.document_id !== id && " an earlier version"}
            {r.question && <span className="block text-xs text-ink-2">“{r.question}”</span>}</span>
          <span className="text-xs text-muted">{new Date(r.at + (r.at.endsWith("Z") ? "" : "Z")).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </li>
      ))}
    </ol>
  );
}

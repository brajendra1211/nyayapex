"use client";

import clsx from "clsx";
import { Download, FileText, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportAI } from "@/components/ReportAI";
import { Alert, Badge, Button, Spinner, fmtDate } from "@/components/ui";
import { api, download, upload } from "@/lib/api";
import { AiText, LangToggle, NotAdvice, type Lang } from "./kit";

export interface Paper { id: number; filename: string; pages: number; status: "queued" | "processing" | "done" | "failed"; error: string | null; case_id: number | null; created_at: string }

/** The account's papers (or one case's), with upload; polls while files are being read. */
export function usePapers(caseId?: number | null) {
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Paper[]>(`/api/documents${caseId ? `?case_id=${caseId}` : ""}`).then(setPapers).catch((e) => setError(e.message));
  }, [caseId]);
  useEffect(() => { load(); }, [load]);
  const busy = papers?.some((p) => p.status === "queued" || p.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [busy, load]);
  return { papers, error, reload: load };
}

export function UploadPaper({ caseId, onDone }: { caseId?: number | null; onDone: (p: Paper) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(file: File) {
    setLoading(true); setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("use_ai", "false"); // only the text is read here; the explanation is asked for separately
    if (caseId) form.append("case_id", String(caseId));
    try { onDone(await upload<Paper>("/api/documents", form)); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
    if (input.current) input.current.value = "";
  }
  return (
    <div>
      <button type="button" onClick={() => input.current?.click()} disabled={loading}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 text-center transition hover:border-brand/50 disabled:opacity-60">
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted" /> : <Upload className="h-6 w-6 text-muted" />}
        <span className="text-sm font-medium text-ink">{loading ? "Uploading…" : "Upload a paper"}</span>
        <span className="text-xs text-muted">PDF, Word (.docx) or text file · FIR, notice, summons, order, agreement…</span>
      </button>
      <input ref={input} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      {error && <div className="mt-2"><Alert tone="bad">{error}</Alert></div>}
    </div>
  );
}

export function PaperRow({ p, active, onOpen, onDeleted }: { p: Paper; active?: boolean; onOpen: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const reading = p.status === "queued" || p.status === "processing";
  async function remove() {
    if (!confirm(`Delete "${p.filename}"? This cannot be undone.`)) return;
    setDeleting(true);
    try { await api(`/api/documents/${p.id}`, { method: "DELETE" }); onDeleted(); } catch (e) { alert((e as Error).message); setDeleting(false); }
  }
  return (
    <div className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2.5", active ? "border-brand bg-brand/5" : "border-line")}>
      <FileText className="h-4 w-4 shrink-0 text-muted" />
      <button onClick={onOpen} disabled={p.status !== "done"} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <div className="truncate text-sm font-medium text-ink">{p.filename}</div>
        <div className="text-xs text-muted">{fmtDate(p.created_at)}{p.pages ? ` · ${p.pages} page${p.pages > 1 ? "s" : ""}` : ""}</div>
      </button>
      {reading && <Badge><Loader2 className="h-3 w-3 animate-spin" />Reading</Badge>}
      {p.status === "failed" && <Badge tone="bad">Could not read</Badge>}
      {p.status === "done" && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={onOpen}><Sparkles className="h-3.5 w-3.5" />Explain</Button>}
      <button title="Download" onClick={() => download(`/api/documents/${p.id}/file`, p.filename)} className="rounded p-1 text-muted hover:text-ink"><Download className="h-4 w-4" /></button>
      <button title="Delete" onClick={remove} disabled={deleting} className="rounded p-1 text-muted hover:text-bad-ink"><Trash2 className="h-4 w-4" /></button>
    </div>
  );
}

interface Explained { answer: string; ai_log_id?: number; partial: boolean; disclaimer: string }

/** "Explain in simple words" for one paper, in English or Hindi. Give it key={paper.id} so a new paper starts fresh. */
export function ExplainPaper({ paper, defaultLang = "en" }: { paper: Paper; defaultLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [res, setRes] = useState<Partial<Record<Lang, Explained>>>({});
  const [errors, setErrors] = useState<Partial<Record<Lang, string>>>({});
  const [busy, setBusy] = useState(false);
  const shown = res[lang];
  const error = errors[lang];
  const loading = busy || (!shown && !error);

  useEffect(() => {
    if (res[lang] || errors[lang]) return;
    let gone = false;
    api<Explained>("/api/personal/explain", { method: "POST", json: { document_id: paper.id, lang } })
      .then((r) => { if (!gone) setRes((x) => ({ ...x, [lang]: r })); })
      .catch((e) => { if (!gone) setErrors((x) => ({ ...x, [lang]: (e as Error).message })); });
    return () => { gone = true; };
  }, [lang, res, errors, paper.id]);

  async function moreDetail() {
    setBusy(true);
    try {
      const r = await api<Explained>("/api/personal/explain", { method: "POST", json: { document_id: paper.id, lang, detailed: true } });
      setRes((x) => ({ ...x, [lang]: r }));
    } catch (e) { setErrors((x) => ({ ...x, [lang]: (e as Error).message })); }
    setBusy(false);
  }
  const retry = () => setErrors((x) => ({ ...x, [lang]: undefined }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{paper.filename}</div>
          <div className="text-xs text-muted">Explained in simple words</div>
        </div>
        <LangToggle value={lang} onChange={setLang} />
      </div>
      {loading && <Spinner label={lang === "hi" ? "सरल भाषा में समझा रहे हैं…" : "Reading your paper and explaining it…"} />}
      {error && !busy && <Alert tone="bad">{error} <button onClick={retry} className="ml-1 font-medium underline">Try again</button></Alert>}
      {shown && !loading && (
        <>
          <div className="mb-3"><Badge tone="accent"><Sparkles className="h-3 w-3" />AI explanation · check with the original paper</Badge></div>
          {shown.partial && <div className="mb-3"><Alert tone="warn">This is a long document; the explanation covers its first part (about 25 pages).</Alert></div>}
          <AiText text={shown.answer} />
          <div className="mt-5 space-y-3 border-t border-line pt-4">
            <NotAdvice>{shown.disclaimer}</NotAdvice>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" className="text-xs" onClick={moreDetail}>Explain again in more detail</Button>
              <ReportAI feature="explain" excerpt={shown.answer} context={{ document: paper.filename }} logId={shown.ai_log_id} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

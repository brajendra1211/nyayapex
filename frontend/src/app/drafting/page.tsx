"use client";

import { AlertTriangle, CheckCircle2, Circle, Download, FileDown, Landmark, PenLine, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DraftCitations } from "@/components/DraftCitations";
import { ReportAI } from "@/components/ReportAI";
import { AiLabel, Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Textarea } from "@/components/ui";
import { api, postDownload, type Doc, type LintFlag } from "@/lib/api";

interface Template { id: string; label: string; sections: string[] }
interface DraftRes { draft: string; flags: LintFlag[]; disclaimer: string; ai_log_id?: number | null }
interface Readiness { ready: boolean; checks: { key: string; ok: boolean; label: string; detail: string }[]; flags: number; citations: { total: number; unknown: number } }
interface ArticleHint { article: string; title: string; because: string[]; already_cited: boolean }
const flagKey = (f: LintFlag) => `${f.line}:${f.match}`;

export default function DraftingPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [form, setForm] = useState({ template: "slp_civil", document_id: "", impugned_order: "", facts: "", statutes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [flags, setFlags] = useState<LintFlag[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const [citesChecked, setCitesChecked] = useState(false);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [hints, setHints] = useState<ArticleHint[] | null>(null);

  useEffect(() => {
    api<Template[]>("/api/drafting/templates").then(setTemplates).catch((e) => setError(e.message));
    api<Doc[]>("/api/documents").then((d) => setDocs(d.filter((x) => x.status === "done"))).catch(() => {});
  }, []);

  const tpl = templates.find((t) => t.id === form.template);

  const [logId, setLogId] = useState<number | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const r = await api<DraftRes>("/api/drafting/generate", {
        method: "POST",
        json: { ...form, document_id: form.document_id ? Number(form.document_id) : null },
      });
      setDraft(r.draft); setFlags(r.flags); setDisclaimer(r.disclaimer); setLogId(r.ai_log_id ?? null);
      setKept(new Set()); setReviewed(false); setCitesChecked(false); setReady(null); setHints(null);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  async function recheck() {
    setFlags(await api<LintFlag[]>("/api/drafting/lint", { method: "POST", json: { text: draft } }));
    setReady(null);
  }

  const gate = () => ({ text: draft, acknowledged: [...kept], reviewed, citations_checked: citesChecked });

  async function checkReady() {
    setChecking(true); setError(null);
    try { setReady(await api<Readiness>("/api/drafting/readiness", { method: "POST", json: gate() })); }
    catch (e) { setError((e as Error).message); }
    setChecking(false);
  }

  async function exportWord() {
    setError(null);
    try {
      const r = await postDownload<{ ready: boolean }>("/api/drafting/export", { ...gate(), title: tpl?.label ?? "Draft", ai_log_id: logId }, `${tpl?.label ?? "Draft"}.docx`);
      if (r && !r.ready) checkReady();
    } catch (e) { setError((e as Error).message); }
  }

  async function suggestArticles() {
    try { setHints(await api<ArticleHint[]>("/api/drafting/articles", { method: "POST", json: { text: `${form.facts}\n${form.impugned_order}\n${draft}` } })); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Drafting Assistant" subtitle="Supreme Court–format first drafts from your record. Every draft is editable and non-binding." />

      <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
        <div className="space-y-6">
          <Card title="Draft inputs">
            <div className="space-y-3">
              <div>
                <Label>Petition type</Label>
                <Select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label hint="recommended">Analysed record</Label>
                <Select value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })}>
                  <option value="">— none —</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                </Select>
                <p className="mt-1 text-xs text-muted">Only the extracted chronology &amp; issues are sent — not the whole record.</p>
              </div>
              <div><Label>Impugned order</Label><Input value={form.impugned_order} onChange={(e) => setForm({ ...form, impugned_order: e.target.value })} placeholder="Final judgment dated … passed by the High Court of … in …" /></div>
              <div><Label>Additional facts</Label><Textarea value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} className="min-h-28" /></div>
              <div><Label hint="if known">Statutes</Label><Input value={form.statutes} onChange={(e) => setForm({ ...form, statutes: e.target.value })} placeholder="e.g. Land Acquisition Act, 1894 – s. 4, 6" /></div>
              {error && <Alert tone="bad">{error}</Alert>}
              <Button className="w-full" onClick={generate} loading={loading}><PenLine className="h-4 w-4" />Generate first draft</Button>
              {loading && <p className="text-center text-xs text-muted">Drafting with the smart model — this can take a minute.</p>}
            </div>
          </Card>
          {tpl && (
            <Card title="Structure">
              <ol className="space-y-1.5 text-xs text-ink-2">{tpl.sections.map((s, i) => <li key={i} className="flex gap-2"><span className="text-muted">{i + 1}.</span>{s}</li>)}</ol>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {draft ? (
            <>
              <Card title={<span className="flex items-center gap-2">Draft <AiLabel /></span>}
                actions={<div className="flex gap-1">
                  <Button variant="ghost" onClick={recheck} title="Re-check risks"><RefreshCw className="h-4 w-4" /></Button>
                  <Button variant="ghost" onClick={exportWord} title="Download as Word (marked DRAFT until every readiness check passes)"><Download className="h-4 w-4" /></Button>
                </div>}>
                <Alert tone="warn">{disclaimer}</Alert>
                <textarea ref={editor} value={draft} onChange={(e) => { setDraft(e.target.value); setReady(null); }}
                  className="prose-draft mt-4 h-[36rem] w-full resize-y rounded-lg border border-line bg-surface p-5 text-ink focus:border-brand focus:outline-none" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <ReportAI feature="drafting" excerpt={draft.slice(0, 4000)} logId={logId} />
                  <Link href="/compliance" className="inline-flex items-center gap-2 text-sm font-medium text-brand dark:text-accent"><ShieldCheck className="h-4 w-4" />Run registry compliance before filing</Link>
                </div>
              </Card>

              <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warn-ink" />Risk &amp; ambiguity flags ({flags.length})</span>} pad={false}>
                {flags.length ? (
                  <ul className="divide-y divide-line">
                    {flags.map((f, i) => (
                      <li key={i} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">{f.risk}</Badge><span className="text-xs text-muted">line {f.line}</span>
                          {f.risk !== "Placeholder left in draft" && (
                            <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
                              <input type="checkbox" checked={kept.has(flagKey(f))} onChange={(e) => { const n = new Set(kept); if (e.target.checked) n.add(flagKey(f)); else n.delete(flagKey(f)); setKept(n); setReady(null); }} />
                              Keep as written
                            </label>
                          )}</div>
                        <p className="mt-1.5 text-sm text-ink">
                          {f.sentence.split(f.match).map((part, j, arr) => (
                            <span key={j}>{part}{j < arr.length - 1 && <mark className="rounded bg-warn/30 px-0.5 text-ink">{f.match}</mark>}</span>
                          ))}
                        </p>
                        <p className="mt-1 text-xs text-ink-2">→ {f.fix}</p>
                      </li>
                    ))}
                  </ul>
                ) : <Empty icon={ShieldCheck} title="No risky language detected" />}
              </Card>

              <DraftCitations draft={draft} setDraft={setDraft} editor={editor} />

              <Card title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-muted" />Constitutional Articles to consider</span>}
                actions={<Button variant="secondary" onClick={suggestArticles}>{hints ? "Refresh" : "Suggest"}</Button>}>
                {hints === null ? <p className="text-sm text-ink-2">Reads the facts and the draft for words that usually engage an Article (zero AI cost). Suggestions only — you judge relevance.</p>
                  : hints.length ? (
                    <ul className="divide-y divide-line">
                      {hints.map((h) => (
                        <li key={h.article} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                          <span className="w-16 font-semibold text-ink">Art. {h.article}</span>
                          <span className="min-w-0 flex-1 text-ink">{h.title}<span className="block text-xs text-muted">because the text mentions: {h.because.join(", ")}</span></span>
                          {h.already_cited ? <Badge tone="good">already cited</Badge> : <Badge>not cited yet</Badge>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">No Article suggested by these words.</p>}
              </Card>

              <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted" />Filing-ready?</span>}
                actions={<Button onClick={checkReady} loading={checking}>Check</Button>}>
                <div className="space-y-2 text-sm">
                  <label className="flex items-start gap-2 text-ink"><input type="checkbox" className="mt-1" checked={citesChecked} onChange={(e) => { setCitesChecked(e.target.checked); setReady(null); }} />I have checked every authority not found in the library against its report</label>
                  <label className="flex items-start gap-2 text-ink"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); setReady(null); }} />I have read the whole draft and approve it as the advocate responsible</label>
                </div>
                {ready && (
                  <ul className="mt-4 space-y-1.5">
                    {ready.checks.map((c) => (
                      <li key={c.key} className="flex items-start gap-2 text-sm">
                        {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-bad-ink" />}
                        <span className={c.ok ? "text-ink-2" : "text-ink"}>{c.label}{c.detail && <span className="block text-xs text-muted">{c.detail}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {ready && <div className="mt-4"><Alert tone={ready.ready ? "good" : "warn"}>{ready.ready ? "Filing-ready. The Word export carries no draft marking; still run Registry Compliance on the final paper-book PDF." : "Not filing-ready. A Word export is headed “DRAFT – NOT FILING-READY” on every page until all checks pass."}</Alert></div>}
                <div className="mt-4"><Button variant="secondary" onClick={exportWord}><FileDown className="h-4 w-4" />Download Word</Button></div>
              </Card>
            </>
          ) : (
            <Card><Empty icon={PenLine} title="No draft yet">Pick a petition type, select an analysed record or type the facts, then generate.</Empty></Card>
          )}
        </div>
      </div>
    </>
  );
}

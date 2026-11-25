"use client";

import { Check, Copy, Download, ExternalLink, Library, Plus, RefreshCw, Scale, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CitationStatus } from "@/components/CitationStatus";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Textarea, fmtDate } from "@/components/ui";
import { api, download, type FoundCitation, type SavedCitation } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function CopyButton({ text: value, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button title={`Copy: ${value}`} onClick={() => { navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-brand/40 hover:text-ink">
      {done ? <Check className="h-3.5 w-3.5 text-good-ink" /> : <Copy className="h-3.5 w-3.5" />}{label ?? "Copy"}
    </button>
  );
}

export default function CitationsPage() {
  const { user } = useAuth();
  const pref = user?.citation_pref ?? "SCC";
  const [items, setItems] = useState<SavedCitation[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ citation: "", case_name: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<FoundCitation[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => api<SavedCitation[]>(`/api/citations?q=${encodeURIComponent(search)}`).then(setItems)
    .catch((e) => setMsg({ tone: "bad", text: e.message })), [search]);
  useEffect(() => { load(); }, [load]);

  async function save(c: { citation: string; case_name?: string; note?: string }) {
    setSaving(true); setMsg(null);
    try {
      const r = await api<SavedCitation>("/api/citations", { method: "POST", json: { case_name: "", note: "", ...c } });
      setMsg(r.duplicate
        ? { tone: "info", text: `${r.case_name || r.citation} is already in your library${r.citation !== c.citation ? ` as ${r.citation}` : ""}.` }
        : { tone: "good", text: `Saved ${r.citation}${r.case_name ? ` — ${r.case_name}` : ""}.` });
      setForm({ citation: "", case_name: "", note: "" });
      setParsed((p) => p?.map((x) => x.citation === c.citation ? { ...x, saved: true } : x) ?? null);
      load();
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setSaving(false);
  }

  async function extract() {
    setParsing(true);
    try { setParsed(await api<FoundCitation[]>("/api/citations/parse", { method: "POST", json: { text } })); }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setParsing(false);
  }

  async function reverify(id: number) {
    setBusyId(id);
    try { await api(`/api/citations/${id}/verify`, { method: "POST" }); load(); } catch {}
    setBusyId(null);
  }

  const counts = { verified: items.filter((i) => i.status === "verified").length, unknown: items.filter((i) => i.status === "unknown").length };

  return (
    <>
      <PageHeader title="Citation Manager"
        subtitle={`Every citation is checked against the Supreme Court judgment library and linked to its parallel citations. Copy uses your preferred format (${pref}).`}
        actions={<Button variant="secondary" onClick={() => download("/api/citations/export", "citations.csv").catch((e) => setMsg({ tone: "bad", text: e.message }))}>
          <Download className="h-4 w-4" />Export CSV</Button>} />

      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card pad={false}
          title={<span className="flex items-center gap-2">My library ({items.length})
            {counts.unknown > 0 && <Badge tone="warn">{counts.unknown} unverified</Badge>}</span>}
          actions={<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, citation, note…" className="w-52 py-1.5" />}>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((c) => {
                const preferredText = c.case_name ? `${c.case_name}, ${c.preferred}` : c.preferred;
                return (
                  <li key={c.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{c.case_name || <span className="text-muted">Case name unknown</span>}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm text-ink">{c.citation}</span>
                          <Badge>{c.reporter}</Badge>
                          <CitationStatus status={c.status} citedIn={c.cited_in} />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <CopyButton text={preferredText} label={c.preferred !== c.citation ? `Copy (${pref})` : "Copy"} />
                        <Button variant="ghost" title="Re-check against the library" onClick={() => reverify(c.id)} loading={busyId === c.id}>
                          {busyId !== c.id && <RefreshCw className="h-4 w-4" />}</Button>
                        <Button variant="danger" title="Delete" onClick={async () => { await api(`/api/citations/${c.id}`, { method: "DELETE" }); load(); }}>
                          <Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    {c.parallels.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted">Parallel:</span>
                        {c.parallels.map((p) => (
                          <button key={p.citation} title={`Seen together in ${p.seen} citing passage(s) — click to copy`}
                            onClick={() => navigator.clipboard.writeText(c.case_name ? `${c.case_name}, ${p.citation}` : p.citation)}
                            className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-2 hover:text-ink">{p.citation}</button>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {c.judgment?.decision_date && <span className="text-ink-2">Decided {fmtDate(c.judgment.decision_date)}</span>}
                      {c.judgment?.source_url && (
                        <a href={c.judgment.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-accent">
                          <ExternalLink className="h-3 w-3" />Judgment PDF</a>
                      )}
                      <Link href={`/precedent?q=${encodeURIComponent(c.citation)}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-accent">
                        <Scale className="h-3 w-3" />Still good law?</Link>
                      {c.note && <span className="text-muted">Note: {c.note}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={Library} title={search ? "No citations match" : "Library is empty"}>Add a citation or extract them from a judgment or draft.</Empty>}
        </Card>

        <div className="space-y-6">
          <Card title="Add citation">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.citation.trim()) save(form); }}>
              <div><Label>Citation</Label><Input value={form.citation} onChange={(e) => setForm({ ...form, citation: e.target.value })} placeholder="(1978) 1 SCC 248" className="font-mono" /></div>
              <div><Label hint="filled from the library if left blank">Case name</Label><Input value={form.case_name} onChange={(e) => setForm({ ...form, case_name: e.target.value })} /></div>
              <div><Label hint="optional">Note</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. on Art. 21 – procedure must be fair" /></div>
              <Button type="submit" className="w-full" loading={saving} disabled={!form.citation.trim()}><Plus className="h-4 w-4" />Verify &amp; save</Button>
              <p className="text-xs text-muted">Checks the library, finds the case name and parallel citations (SCC · SCR · AIR · INSC · SCC OnLine).</p>
            </form>
          </Card>

          <Card title="Extract from text">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a paragraph from a judgment or your draft…" className="min-h-32" />
            <Button variant="secondary" className="mt-2 w-full" disabled={!text.trim()} loading={parsing} onClick={extract}>
              <Wand2 className="h-4 w-4" />Find &amp; check citations
            </Button>
            {parsed && (
              <ul className="mt-3 space-y-2">
                {parsed.length ? parsed.map((p) => (
                  <li key={p.citation} className="rounded-lg bg-surface-2 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs text-ink">{p.citation}</div>
                        {p.case_name && <div className="truncate text-xs text-ink-2">{p.case_name}</div>}
                        <div className="mt-1"><CitationStatus status={p.status} /></div>
                      </div>
                      {p.saved ? <Badge tone="good"><Check className="h-3 w-3" />saved</Badge> : (
                        <Button variant="ghost" title="Save to library" onClick={() => save({ citation: p.citation, case_name: p.case_name })}><Plus className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </li>
                )) : <p className="text-sm text-muted">No citations recognised.</p>}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

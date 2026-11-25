"use client";

import { ArrowDown, ArrowUp, BookCopy, Download } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { postDownload, type MatterDoc, type MatterRef } from "@/lib/api";

interface Pick { key: string; label: string; sub: string; reference_id?: number; document_id?: number; relied_pages: string; highlights: string }
interface ItemReport { title: string; pages: number; original: boolean; highlights: number; highlights_not_found: string[] }

/** Compilation of judgments for the Bench: index, relied pages marked, passages highlighted, continuous numbering. */
export function Compilation({ id, title, refs, docs }: { id: number; title: string; refs: MatterRef[]; docs: MatterDoc[] }) {
  const available: Pick[] = [
    ...refs.filter((r) => r.document_id).map((r) => ({
      key: `r${r.id}`, label: r.title || r.citation, sub: r.citation, reference_id: r.id, relied_pages: r.pages ?? "", highlights: "",
    })),
    ...docs.filter((d) => d.filename.toLowerCase().endsWith(".pdf")).map((d) => ({
      key: `d${d.id}`, label: d.filename, sub: "matter document", document_id: d.id, relied_pages: "", highlights: "",
    })),
  ];
  const [chosen, setChosen] = useState<Pick[]>([]);
  const [side, setSide] = useState("Petitioner");
  const [volume, setVolume] = useState("VOLUME I");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ItemReport[] | null>(null);

  const toggle = (p: Pick) => setChosen((c) => (c.some((x) => x.key === p.key) ? c.filter((x) => x.key !== p.key) : [...c, p]));
  const update = (key: string, patch: Partial<Pick>) => setChosen((c) => c.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => setChosen((c) => {
    const n = [...c];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });

  async function build() {
    setBusy(true); setError(null); setReport(null);
    try {
      const r = await postDownload<{ items: ItemReport[] }>(`/api/matters/${id}/compilation`, {
        side, volume,
        items: chosen.map((c) => ({
          reference_id: c.reference_id, document_id: c.document_id, relied_pages: c.relied_pages,
          highlights: c.highlights.split("\n").map((h) => h.trim()).filter(Boolean),
        })),
      }, `${title.replace(/[^A-Za-z0-9]+/g, "_")}_Compilation.pdf`);
      setReport(r?.items ?? []);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><BookCopy className="h-4 w-4 text-muted" />Compilation of judgments</span>}>
      <p className="mb-4 text-sm text-ink-2">
        One PDF for the Bench: cover, index with page numbers, each judgment’s official copy, relied-upon pages marked in the
        margin, the passages you quote highlighted, and bookmarks. Built on this server — no AI, no cost.
      </p>
      {!available.length ? (
        <Alert tone="info">Save judgments to this matter from Research (“Save to matter”) or upload PDFs in Documents first.</Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">Pick in the order they should appear</div>
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {available.map((p) => {
                const n = chosen.findIndex((c) => c.key === p.key);
                return (
                  <li key={p.key}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <input type="checkbox" checked={n >= 0} onChange={() => toggle(p)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{n >= 0 && <b>{n + 1}. </b>}{p.label}</span>
                        <span className="block truncate text-xs text-muted">{p.sub}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-3">
            {chosen.map((c, i) => (
              <div key={c.key} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{i + 1}. {c.label}</span>
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <div><Label hint="PDF pages">Relied pages</Label>
                    <Input value={c.relied_pages} onChange={(e) => update(c.key, { relied_pages: e.target.value })} placeholder="12-14, 20" /></div>
                  <div><Label hint="one per line, on relied pages">Highlight passages</Label>
                    <Textarea value={c.highlights} onChange={(e) => update(c.key, { highlights: e.target.value })} className="min-h-16"
                      placeholder="Copy a sentence exactly as it appears in the judgment" /></div>
                </div>
              </div>
            ))}
            {!chosen.length && <p className="text-sm text-muted">Tick judgments on the left.</p>}
            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <div><Label>On behalf of</Label>
                <Select value={side} onChange={(e) => setSide(e.target.value)}>
                  {["Petitioner", "Respondent", "Appellant", "Applicant"].map((s) => <option key={s}>{s}</option>)}
                </Select></div>
              <div className="w-36"><Label>Volume</Label><Input value={volume} onChange={(e) => setVolume(e.target.value)} /></div>
              <Button onClick={build} loading={busy} disabled={!chosen.length}><Download className="h-4 w-4" />Build compilation PDF</Button>
            </div>
            {busy && <p className="text-xs text-muted">Fetching official copies of library judgments the first time can take a few seconds each.</p>}
            {error && <Alert tone="bad">{error}</Alert>}
            {report && (
              <Alert tone={report.some((r) => !r.original || r.highlights_not_found.length) ? "warn" : "good"}>
                <div className="space-y-1">
                  <div className="font-medium">Compilation downloaded ({report.reduce((n, r) => n + r.pages, 0)} judgment pages).</div>
                  {report.map((r, i) => (
                    <div key={i} className="text-xs">
                      {i + 1}. {r.title} · {r.pages} pages {!r.original && <Badge tone="warn">text copy - attach official copy</Badge>}
                      {r.highlights_not_found.length > 0 && <span className="text-warn-ink"> · not found on relied pages: “{r.highlights_not_found.join("”, “")}”</span>}
                    </div>
                  ))}
                </div>
              </Alert>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

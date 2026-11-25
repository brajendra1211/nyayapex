"use client";

import { BookMarked, CornerDownLeft, ListChecks } from "lucide-react";
import { useState, type RefObject } from "react";
import { CitationStatus } from "@/components/CitationStatus";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { api, type FoundCitation, type SavedCitation } from "@/lib/api";

interface CheckResult { total: number; verified: number; cited: number; unknown: number; items: FoundCitation[] }

/** Citation validation before a draft is finalised (PRD 6.3) + one-click insert from the citation library. */
export function DraftCitations({ draft, setDraft, editor }: {
  draft: string; setDraft: (v: string) => void; editor: RefObject<HTMLTextAreaElement | null>;
}) {
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [lib, setLib] = useState<SavedCitation[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setChecking(true); setError(null);
    try { setCheck(await api<CheckResult>("/api/citations/check", { method: "POST", json: { text: draft } })); }
    catch (e) { setError((e as Error).message); }
    setChecking(false);
  }

  function insert(c: SavedCitation) {
    const value = c.case_name ? `${c.case_name}, ${c.preferred}` : c.preferred;
    const el = editor.current;
    const at = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    setDraft(draft.slice(0, at) + value + draft.slice(end));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + value.length, at + value.length); } });
  }

  const shown = (lib ?? []).filter((c) => !q || `${c.case_name} ${c.citation} ${c.note}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

  return (
    <Card title={<span className="flex items-center gap-2"><BookMarked className="h-4 w-4 text-muted" />Citations</span>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-medium text-ink">Check citations in this draft</div>
          <p className="mb-3 text-xs text-ink-2">Every citation is matched against the Supreme Court library. Unverified ones must be checked by hand before filing.</p>
          <Button variant="secondary" onClick={runCheck} loading={checking} disabled={!draft.trim()}><ListChecks className="h-4 w-4" />Check citations</Button>
          {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
          {check && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge>{check.total} found</Badge>
                <Badge tone="good">{check.verified} in library</Badge>
                <Badge tone="brand">{check.cited} cited elsewhere</Badge>
                {check.unknown > 0 && <Badge tone="warn">{check.unknown} not found</Badge>}
              </div>
              {check.unknown > 0 && <Alert tone="warn">Some citations were not found in the library. They may be typos, High Court reports, or judgments not yet imported. Verify each before filing.</Alert>}
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {check.items.map((i) => (
                  <li key={i.citation} className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-ink">{i.citation}</span>
                      <CitationStatus status={i.status} />
                    </div>
                    {i.case_name && <div className="truncate text-xs text-ink-2">{i.case_name}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-ink">Insert from your library</div>
          <p className="mb-3 text-xs text-ink-2">Place the cursor in the draft, then click a citation. It is inserted in your preferred reporter format.</p>
          <Input value={q} onFocus={() => { if (!lib) api<SavedCitation[]>("/api/citations").then(setLib).catch(() => setLib([])); }}
            onChange={(e) => setQ(e.target.value)} placeholder="Search your citations…" />
          <ul className="mt-2 space-y-1.5">
            {lib === null ? <li className="text-xs text-muted">Click the search box to load your library.</li>
              : shown.length ? shown.map((c) => (
                <li key={c.id}>
                  <button onClick={() => insert(c)} className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-brand/40">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-ink">{c.case_name || "—"}</div>
                      <div className="font-mono text-xs text-muted">{c.preferred}</div>
                    </div>
                    <CornerDownLeft className="h-3.5 w-3.5 text-muted" />
                  </button>
                </li>
              )) : <li className="text-xs text-muted">No matching citations. Save some in the Citation Manager.</li>}
          </ul>
        </div>
      </div>
    </Card>
  );
}

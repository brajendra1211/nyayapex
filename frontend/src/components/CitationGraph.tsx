"use client";

import { ArrowDownLeft, ArrowUpRight, Network } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

interface Node { id: number; title: string; year: string; citation: string | null; cited_by: number }
interface Graph { judgment: Node; cited_by: Node[]; cites: Node[]; unlinked_citations: number; note: string }

/** One judgment between the authorities it relies on and the later judgments that cite it. */
export function CitationGraph({ docId, onOpen }: { docId: number; onOpen: (n: Node) => void }) {
  const [g, setG] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api<Graph>(`/api/judgments/${docId}/citations`).then((r) => { if (!off) setG(r); }).catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [docId]);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!g || g.judgment.id !== docId) return <Card><Spinner label="Reading the citation graph…" /></Card>;

  // later citations per decade: how the judgment's use has run over time
  const decades = new Map<string, number>();
  for (const c of g.cited_by) if (c.year) decades.set(`${c.year.slice(0, 3)}0s`, (decades.get(`${c.year.slice(0, 3)}0s`) ?? 0) + 1);
  const rows = [...decades.entries()].sort();
  const max = Math.max(1, ...rows.map(([, n]) => n));

  return (
    <Card title={<span className="flex items-center gap-2"><Network className="h-4 w-4 text-muted" />Precedent graph · {g.judgment.title} ({g.judgment.year})</span>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <Column title={`Relies on (${g.cites.length})`} icon={ArrowDownLeft} nodes={g.cites} onOpen={onOpen} empty="No cited judgment matched in the library." />
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-accent px-5 py-4 text-center lg:w-56">
          <div className="text-sm font-semibold text-ink">{g.judgment.title}</div>
          <div className="text-xs text-ink-2">{g.judgment.year}{g.judgment.citation && ` · ${g.judgment.citation}`}</div>
          <Badge tone="accent">cited by {g.cited_by.length} in the library</Badge>
          {rows.length > 0 && (
            <ul className="mt-2 w-full space-y-1" aria-label="Later citations by decade">
              {rows.map(([d, n]) => (
                <li key={d} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2 text-xs" title={`${d}: ${n}`}>
                  <span className="text-ink-2">{d}</span>
                  <span className="h-2 rounded-r bg-surface-2"><span className="block h-full rounded-r bg-series" style={{ width: `${(100 * n) / max}%` }} /></span>
                  <span className="text-right tabular-nums text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Column title={`Cited by (${g.cited_by.length})`} icon={ArrowUpRight} nodes={g.cited_by} onOpen={onOpen} empty="Not cited by any judgment in the library." />
      </div>
      <p className="mt-4 text-xs text-muted">{g.note}{g.unlinked_citations > 0 && ` ${g.unlinked_citations} of this judgment's citations could not be matched.`}</p>
    </Card>
  );
}

function Column({ title, icon: Icon, nodes, onOpen, empty }: { title: string; icon: typeof Network; nodes: Node[]; onOpen: (n: Node) => void; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? nodes : nodes.slice(0, 12);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-2"><Icon className="h-3.5 w-3.5" />{title}</div>
      {nodes.length ? (
        <ul className="space-y-1.5">
          {shown.map((n) => (
            <li key={n.id}>
              <button onClick={() => onOpen(n)} className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-brand/40 hover:bg-surface-2/60">
                <div className="truncate text-sm text-ink">{n.title}</div>
                <div className="text-xs text-muted">{n.year}{n.citation && ` · ${n.citation}`}{n.cited_by > 0 && ` · cited ${n.cited_by}×`}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{empty}</p>}
      {nodes.length > 12 && <button onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-brand hover:underline dark:text-accent">{all ? "Show fewer" : `Show all ${nodes.length}`}</button>}
    </div>
  );
}

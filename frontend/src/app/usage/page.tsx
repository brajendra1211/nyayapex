"use client";

import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api, type Health } from "@/lib/api";

interface Row { key: string; calls: number; input: number; output: number; cache_read: number; local_hits: number; cost_usd: number }
interface Usage {
  by_feature: Row[]; by_model: Row[];
  totals: { cost_usd: number; calls: number; local_hits: number; cache_read: number };
  documents: { raw_tokens_est: number; sent_tokens_est: number };
}

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString("en-IN");

function Table({ rows, label }: { rows: Row[]; label: string }) {
  if (!rows.length) return <Empty icon={BarChart3} title="No AI calls yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs text-ink-2">
          <tr>{[label, "Calls", "Input", "Output", "Cache read", "Free hits", "Cost (USD)"].map((h, i) =>
            <th key={h} className={i ? "px-3 py-2.5 text-right font-medium" : "px-5 py-2.5 font-medium"}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-5 py-2.5 font-medium text-ink">{r.key}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{n(r.calls)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{n(r.input)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{n(r.output)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{n(r.cache_read)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{n(r.local_hits)}</td>
              <td className="px-3 py-2.5 text-right font-medium text-ink">${r.cost_usd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UsagePage() {
  const [u, setU] = useState<Usage | null>(null);
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Usage>("/api/usage").then(setU).catch((e) => setError(e.message));
    api<Health>("/api/health").then(setH).catch(() => {});
  }, []);

  const saved = u && u.documents.raw_tokens_est ? Math.round(100 - (100 * u.documents.sent_tokens_est) / u.documents.raw_tokens_est) : null;

  return (
    <>
      <PageHeader title="AI Usage & Cost" subtitle="Every Claude call is logged. Python does the heavy lifting; Claude only sees what it must." />
      {error && <Alert tone="bad">{error}</Alert>}
      {!u && !error && <Spinner />}
      {u && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Total spend", `$${u.totals.cost_usd.toFixed(2)}`],
              ["AI calls", n(u.totals.calls)],
              ["Free local-cache hits", n(u.totals.local_hits)],
              ["Record tokens avoided", saved != null ? `${saved}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface p-4">
                <div className="text-xs font-medium text-ink-2">{k}</div>
                <div className="mt-2 text-3xl font-semibold tabular-nums text-ink">{v}</div>
              </div>
            ))}
          </div>

          {h && (
            <Card title="Model routing">
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-surface-2 p-4">
                  <div className="text-xs text-muted">Bulk model — per-chunk extraction, quick Q&amp;A, courtroom</div>
                  <div className="mt-1 font-mono text-ink">{h.models.bulk}</div>
                </div>
                <div className="rounded-lg bg-surface-2 p-4">
                  <div className="text-xs text-muted">Smart model — case brief, drafting, deep research</div>
                  <div className="mt-1 font-mono text-ink">{h.models.smart}</div>
                </div>
              </div>
            </Card>
          )}

          <Card title="By feature" pad={false}><Table rows={u.by_feature} label="Feature" /></Card>
          <Card title="By model" pad={false}><Table rows={u.by_model} label="Model" /></Card>

          <Card title="How tokens are saved">
            <ul className="grid gap-3 text-sm text-ink-2 md:grid-cols-2">
              <li><b className="text-ink">Python first:</b> OCR, cleaning, chronology dates, citations, format and limitation checks cost 0 tokens.</li>
              <li><b className="text-ink">Retrieval:</b> only the top matching pages go to Claude, never the whole record.</li>
              <li><b className="text-ink">Tiered models:</b> the cheap model reads every chunk; the smart model reads only the compact summary.</li>
              <li><b className="text-ink">Prompt caching:</b> fixed system prompts are cached; repeat reads cost ~10%.</li>
              <li><b className="text-ink">Local answer cache:</b> the same question on the same material is answered from the database.</li>
              <li><b className="text-ink">Batch mode:</b> overnight analysis at 50% price.</li>
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

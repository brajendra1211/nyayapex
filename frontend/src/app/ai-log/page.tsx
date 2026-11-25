"use client";

import { CheckCircle2, Circle, Download, ScrollText, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Empty, PageHeader, Select, Spinner } from "@/components/ui";
import { api, download } from "@/lib/api";

interface Row {
  id: number; feature: string; feature_label: string; model: string; prompt: string; output: string; sources: string[];
  cached: boolean; pii_masked: number; asked_by: string | null; case_id: number | null; case_title: string | null;
  verified_by: string | null; verified_at: string | null; created_at: string;
}
interface Register { total: number; all_workspace: boolean; items: Row[] }

const FEATURES = [
  ["", "All features"], ["research", "Research"], ["courtroom", "Courtroom"], ["doc_qa", "Document Q&A"],
  ["doc_brief", "Record brief"], ["drafting", "Drafting"], ["filing", "Filing package"],
] as const;

const fmt = (iso: string) => new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** AI output register - SC AI Regulations 2026 (draft): Reg 8(3) verification, Reg 9 auditability, Reg 43(4) disclosure. */
export default function AILogPage() {
  const [feature, setFeature] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [data, setData] = useState<Register | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: "200", ...(feature ? { feature } : {}), ...(unverified ? { unverified: "true" } : {}) });
    api<Register>(`/api/ai-log?${qs}`).then(setData).catch((e) => setError(e.message));
  }, [feature, unverified]);
  useEffect(() => { load(); }, [load]);

  async function verify(r: Row) {
    await api(`/api/ai-log/${r.id}/verify`, { method: "POST", json: { verified: !r.verified_at } }).catch(() => {});
    load();
  }

  const pending = data?.items.filter((r) => !r.verified_at).length ?? 0;

  return (
    <>
      <PageHeader title="AI Register"
        subtitle="Every AI answer: who asked, which model, what it was based on, and who verified it. Produce this if a Court asks how AI was used."
        actions={<Button variant="secondary" onClick={() => download(`/api/ai-log/export.csv${feature ? `?feature=${feature}` : ""}`, "AI_output_register.csv")}><Download className="h-4 w-4" />Export CSV</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><div className="text-xs text-muted">AI answers recorded</div><div className="mt-1 text-2xl font-semibold text-ink">{data?.total ?? "—"}</div></Card>
        <Card><div className="text-xs text-muted">Not yet verified (shown)</div><div className="mt-1 text-2xl font-semibold text-warn-ink">{data ? pending : "—"}</div></Card>
        <Card><div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" />Privacy</div>
          <div className="mt-1 text-sm text-ink">Phone, e-mail, Aadhaar and PAN are masked before text reaches the AI provider.</div></Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={feature} onChange={(e) => setFeature(e.target.value)} className="sm:w-52">
          {FEATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={unverified} onChange={(e) => setUnverified(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
          Only unverified
        </label>
        {data && !data.all_workspace && <span className="text-xs text-muted">Showing the AI answers you asked for. Chamber heads see the whole chamber.</span>}
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {!data && !error && <Spinner />}
      {data && (
        <Card pad={false}>
          {data.items.length ? (
            <ul className="divide-y divide-line">
              {data.items.map((r) => (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <button onClick={() => setOpen(open === r.id ? null : r.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{r.feature_label}</Badge>
                        <span className="truncate text-sm font-medium text-ink">{r.prompt || "—"}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>#{r.id}</span><span>{fmt(r.created_at)}</span><span>{r.asked_by ?? "system"}</span>
                        {r.case_title && <span>· {r.case_title}</span>}
                        <span className="font-mono">{r.model}</span>
                        {r.cached && <span>from cache</span>}
                        {r.pii_masked > 0 && <span className="text-good-ink">{r.pii_masked} identifier(s) masked</span>}
                      </div>
                    </button>
                    <button onClick={() => verify(r)} className={r.verified_at
                      ? "inline-flex shrink-0 items-center gap-1 text-xs font-medium text-good-ink"
                      : "inline-flex shrink-0 items-center gap-1 text-xs text-warn-ink hover:text-good-ink"}>
                      {r.verified_at ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                      {r.verified_at ? `Verified · ${r.verified_by}` : "Not verified"}
                    </button>
                  </div>
                  {open === r.id && (
                    <div className="mt-3 space-y-3 rounded-lg bg-surface-2 p-3">
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink-2">Based on</div>
                        {r.sources.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink">{r.sources.map((s, i) => <li key={i}>{s}</li>)}</ul>
                          : <p className="text-xs text-muted">—</p>}
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-ink-2">AI output</div>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink">{r.output}</pre>
                      </div>
                      {r.verified_at && <p className="text-xs text-good-ink">Verified by {r.verified_by} on {fmt(r.verified_at)}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty icon={ScrollText} title="No AI answers recorded yet">Answers from Research, Courtroom, Document Q&amp;A, Drafting and Filing appear here.</Empty>}
        </Card>
      )}
    </>
  );
}

"use client";

import clsx from "clsx";
import { Briefcase, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, StatusBadge, fmtDate } from "@/components/ui";
import { api, type Case } from "@/lib/api";

const STAGES = ["Drafting", "Filed", "Defects", "Listed", "Admission", "Notice", "Final hearing", "Reserved", "Disposed"];
const TYPES = ["SLP (C)", "SLP (Crl)", "W.P. (C)", "W.P. (Crl)", "C.A.", "Crl.A.", "R.P.", "Curative", "Transfer Pet.", "Contempt"];
const PRIORITIES = ["Urgent", "High", "Normal", "Low"];

type Draft = Omit<Case, "id" | "days_left" | "file_location" | "stage_since">;
const EMPTY: Draft = { title: "", diary_no: "", case_number: "", case_type: "SLP (C)", bench: "", stage: "Drafting", priority: "Normal",
  next_hearing: null, limitation_expiry: null, filing_status: "NOT READY", defects: 0 };

export default function CasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Case | Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState(false);
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const load = useCallback(() => api<Case[]>("/api/cases").then(setCases).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => cases.filter((c) =>
    (!stage || c.stage === stage) &&
    (!q || `${c.title} ${c.diary_no ?? ""} ${c.case_number ?? ""} ${c.bench ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [cases, stage, q]);

  // Only evaluated once matters have loaded on the client (never during prerender)
  const today = shown.length ? new Date().toISOString().slice(0, 10) : "";

  return (
    <>
      <PageHeader title="Cases & Hearings" subtitle="Every matter, its bench, next date and limitation — shared across Senior, Junior and Clerk."
        actions={<Button onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />New matter</Button>} />
      {error && <div className="mb-4"><Alert tone="bad">{error}</Alert></div>}

      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, diary no., bench…" className="sm:max-w-xs" />
          <div className="flex flex-wrap gap-1.5">
            {["", ...STAGES].map((s) => (
              <button key={s || "all"} onClick={() => setStage(s)}
                className={clsx("rounded-full border px-3 py-1 text-xs transition",
                  stage === s ? "border-brand bg-brand text-brand-ink" : "border-line text-ink-2 hover:border-brand/40")}>
                {s || "All"} <span className="opacity-70">{s ? cases.filter((c) => c.stage === s).length : cases.length}</span>
              </button>
            ))}
          </div>
        </div>
        {picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft/40 px-4 py-2 text-sm">
            <span className="font-medium text-ink">{picked.size} selected</span>
            <Button variant="secondary" onClick={() => setBulk(true)}><Layers className="h-4 w-4" />Update together</Button>
            <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
        )}

        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-2">
                <tr>
                  <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all shown"
                    checked={shown.length > 0 && shown.every((c) => picked.has(c.id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((c) => c.id)) : new Set())} /></th>
                  <th className="px-3 py-2.5 font-medium">Matter</th><th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Bench</th><th className="px-3 py-2.5 font-medium">Next hearing</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Limitation</th><th className="px-3 py-2.5 font-medium">Filing</th><th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-2/60">
                    <td className="pl-4"><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} /></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-ink">
                        <Link href={`/matter?id=${c.id}`} className="hover:text-brand hover:underline dark:hover:text-accent">{c.title}</Link>
                        {(c.priority === "Urgent" || c.priority === "High") && <Badge tone={c.priority === "Urgent" ? "bad" : "warn"}>{c.priority}</Badge>}
                      </div>
                      <div className="text-xs text-muted">{c.case_number || c.case_type}{c.diary_no ? ` · Diary ${c.diary_no}` : ""}</div>
                    </td>
                    <td className="px-3 py-3"><Badge>{c.stage}</Badge></td>
                    <td className="hidden px-3 py-3 text-ink-2 lg:table-cell">{c.bench || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink">{fmtDate(c.next_hearing)}</td>
                    <td className={clsx("hidden whitespace-nowrap px-3 py-3 tabular-nums md:table-cell",
                      c.limitation_expiry && c.limitation_expiry < today ? "text-bad-ink" : "text-ink-2")}>{fmtDate(c.limitation_expiry)}</td>
                    <td className="px-3 py-3"><StatusBadge status={c.filing_status} /></td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end">
                        <Button variant="ghost" onClick={() => setEditing(c)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="danger" title="Delete" onClick={async () => { if (confirm(`Delete "${c.title}"?`)) { await api(`/api/cases/${c.id}`, { method: "DELETE" }); load(); } }}>
                          <Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Briefcase} title={cases.length ? "No matters match the filter" : "No matters yet"}>Add your first matter to start tracking hearings and limitation.</Empty>}
      </Card>

      {editing && <CaseForm value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {bulk && <BulkForm ids={[...picked]} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setPicked(new Set()); load(); }} />}
    </>
  );
}

function CaseForm({ value, onClose, onSaved }: { value: Case | Draft; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Draft>({ ...EMPTY, ...value });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = "id" in value ? value.id : null;
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value === "" && (k === "next_hearing" || k === "limitation_expiry") ? null : e.target.value });

  async function save() {
    setSaving(true); setError(null);
    try {
      await api(id ? `/api/cases/${id}` : "/api/cases", { method: id ? "PATCH" : "POST", json: { ...f, defects: Number(f.defects) } });
      onSaved();
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold text-ink">{id ? "Edit matter" : "New matter"}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-2 hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div><Label>Title</Label><Input value={f.title} onChange={set("title")} placeholder="State of X v. Y" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label><Select value={f.case_type} onChange={set("case_type")}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label hint="with year">Diary no.</Label><Input value={f.diary_no ?? ""} onChange={set("diary_no")} placeholder="34272/2026" /></div>
            <div className="col-span-2"><Label hint="tracks the cause lists">Case number</Label><Input value={f.case_number ?? ""} onChange={set("case_number")} placeholder="SLP(C) No. 30665/2026" className="font-mono" /></div>
            <div><Label>Stage</Label><Select value={f.stage} onChange={set("stage")}>{STAGES.map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label>Priority</Label><Select value={f.priority} onChange={set("priority")}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</Select></div>
          </div>
          <div><Label>Bench</Label><Input value={f.bench ?? ""} onChange={set("bench")} placeholder="Court No. 3 — Hon'ble …" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Next hearing</Label><Input type="date" value={f.next_hearing ?? ""} onChange={set("next_hearing")} /></div>
            <div><Label>Limitation expiry</Label><Input type="date" value={f.limitation_expiry ?? ""} onChange={set("limitation_expiry")} /></div>
            <div><Label>Filing status</Label><Select value={f.filing_status} onChange={set("filing_status")}>{["READY", "AT RISK", "NOT READY"].map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label>Open defects</Label><Input type="number" min={0} value={f.defects} onChange={set("defects")} /></div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!f.title.trim()}>Save</Button>
        </div>
      </div>
    </div>
  );
}

/** One change applied to many matters, e.g. every matter of a court adjourned to the same date. */
function BulkForm({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ stage: "", priority: "", bench: "", next_hearing: "", clear_hearing: false, filing_status: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const any = !!(f.stage || f.priority || f.bench.trim() || f.next_hearing || f.clear_hearing || f.filing_status);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api("/api/cases/bulk", { method: "POST", json: { ids, stage: f.stage || null, priority: f.priority || null, bench: f.bench.trim() || null,
        next_hearing: f.next_hearing || null, clear_hearing: f.clear_hearing, filing_status: f.filing_status || null } });
      onSaved();
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold text-ink">Update {ids.length} matters</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-2 hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-sm text-ink-2">Only the fields you fill are changed. A new hearing date notifies each matter&apos;s team and client.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Stage</Label><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">No change</option>{STAGES.map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label>Priority</Label><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">No change</option>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label>Next hearing</Label><Input type="date" value={f.next_hearing} disabled={f.clear_hearing} onChange={(e) => setF({ ...f, next_hearing: e.target.value })} /></div>
            <div><Label>Filing status</Label><Select value={f.filing_status} onChange={(e) => setF({ ...f, filing_status: e.target.value })}><option value="">No change</option>{["READY", "AT RISK", "NOT READY"].map((t) => <option key={t}>{t}</option>)}</Select></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.clear_hearing} onChange={(e) => setF({ ...f, clear_hearing: e.target.checked, next_hearing: "" })} />Clear the next hearing date</label>
          <div><Label>Bench</Label><Input value={f.bench} onChange={(e) => setF({ ...f, bench: e.target.value })} placeholder="No change" /></div>
          {error && <Alert tone="bad">{error}</Alert>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!any}>Apply to {ids.length}</Button>
        </div>
      </div>
    </div>
  );
}

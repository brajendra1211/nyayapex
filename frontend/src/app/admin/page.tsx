"use client";

import { BadgeCheck, Check, Download, Flag, Inbox, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Label, PageHeader, Select, Spinner, Textarea, fmtDate } from "@/components/ui";
import { TribunalOrders } from "@/components/admin/TribunalOrders";
import { api, contactOf, download } from "@/lib/api";

interface Pending {
  id: number; name: string; phone: string | null; email: string | null; role_label: string; workspace: string | null; workspace_type: string | null;
  profile: Record<string, unknown>; created_at: string;
}

const FIELDS: [string, string][] = [
  ["bar_enrolment_no", "Enrolment no."], ["state_bar_council", "State Bar Council"], ["enrolment_year", "Enrolled"],
  ["aor_code", "AOR code"], ["college", "College"], ["course", "Course"], ["year", "Year"], ["college_email", "College email"], ["student_id", "Student ID"],
];

export default function AdminPage() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Pending[]>("/api/admin/verifications").then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: "verified" | "rejected") {
    await api(`/api/admin/verifications/${id}`, { method: "POST", json: { status } });
    load();
  }

  return (
    <>
      <PageHeader title="Verifications" subtitle="Check Bar Council enrolment (advocates) and college ID (students) before approving." />
      {error && <Alert tone="bad">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items && (
        <Card pad={false}>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((u) => (
                <li key={u.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{u.name}</span>
                      <Badge>{u.workspace_type}</Badge>
                      <span className="text-xs text-muted">{contactOf(u)} · {u.workspace} · {u.role_label} · {fmtDate(u.created_at)}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                      {FIELDS.filter(([k]) => u.profile[k]).map(([k, label]) => (
                        <div key={k}><dt className="text-xs text-muted">{label}</dt><dd className="font-mono text-ink">{String(u.profile[k])}</dd></div>
                      ))}
                    </dl>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => decide(u.id, "rejected")}><X className="h-4 w-4" />Reject</Button>
                    <Button onClick={() => decide(u.id, "verified")}><Check className="h-4 w-4" />Verify</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty icon={BadgeCheck} title="Nothing waiting for verification" />}
        </Card>
      )}
      <TribunalOrders />
      <Enquiries />
      <AIIncidents />
    </>
  );
}

interface Incident {
  id: number; feature: string; category: string; description: string; excerpt: string; context: Record<string, unknown>;
  status: "open" | "reviewed" | "resolved"; reported_by: string | null; created_at: string;
  cause: string; consequences: string; remedial_measures: string; reviewed_by: string | null; reviewed_at: string | null;
  ai_model: string | null; ai_prompt: string | null; ai_output_id: number | null;
}
const CATEGORY: Record<string, string> = {
  wrong_citation: "Wrong citation", fabricated: "Fabricated", wrong_fact: "Wrong fact", harmful: "Biased / inappropriate", other: "Other",
};

/** AI incident register (SC AI Regulations 2026, Reg 39): type, cause, manner of occurrence, consequences, remedial measures. */
function AIIncidents() {
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => api<Incident[]>("/api/admin/ai-incidents").then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Flag className="h-5 w-5 text-muted" />AI incident register</h2>
        <Button variant="secondary" onClick={() => download("/api/admin/ai-incidents.csv", "AI_incident_register.csv")}><Download className="h-4 w-4" />Export CSV</Button>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {!rows && !error && <Spinner />}
      {rows && (
        <Card pad={false}>
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === "open" ? "warn" : r.status === "resolved" ? "good" : "neutral"}>{r.status}</Badge>
                      <span className="font-medium text-ink">{CATEGORY[r.category] ?? r.category}</span>
                      <span className="text-xs text-muted">#{r.id} · {r.feature} · {r.reported_by ?? "—"} · {fmtDate(r.created_at)}{r.ai_model && ` · ${r.ai_model}`}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-ink">{r.description}</p>
                  </button>
                  {open === r.id && <IncidentReview r={r} onSaved={load} />}
                </li>
              ))}
            </ul>
          ) : <Empty icon={Flag} title="No AI issues reported" />}
        </Card>
      )}
    </div>
  );
}

function IncidentReview({ r, onSaved }: { r: Incident; onSaved: () => void }) {
  const [f, setF] = useState({ status: r.status, cause: r.cause, consequences: r.consequences, remedial_measures: r.remedial_measures });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await api(`/api/admin/ai-incidents/${r.id}`, { method: "PATCH", json: f }); onSaved(); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const field = (k: "cause" | "consequences" | "remedial_measures", label: string, ph: string) => (
    <div><Label>{label}</Label><Textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="min-h-16" placeholder={ph} /></div>
  );
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-2 p-3">
      {r.ai_prompt && <p className="text-xs text-ink-2"><b>Question asked:</b> {r.ai_prompt}</p>}
      {r.excerpt && <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface px-2.5 py-1.5 text-xs text-ink-2">{r.excerpt}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {field("cause", "Cause", "e.g. retrieval returned a different judgment with a similar name")}
        {field("consequences", "Consequences", "e.g. none - caught before filing")}
        {field("remedial_measures", "Remedial measures", "e.g. citation check made mandatory before export")}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Incident["status"] })} className="w-40">
          <option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option>
        </Select>
        <Button onClick={save} loading={busy}>Save review</Button>
        {r.reviewed_by && <span className="text-xs text-muted">Last reviewed by {r.reviewed_by} · {fmtDate(r.reviewed_at)}</span>}
      </div>
    </div>
  );
}

interface EnquiryRow { id: number; name: string; email: string; phone: string; organisation: string; topic: string; message: string; status: "new" | "replied" | "closed"; created_at: string }

/** Messages from the website's contact form. */
function Enquiries() {
  const [rows, setRows] = useState<EnquiryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<EnquiryRow[]>("/api/admin/enquiries").then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const mark = (id: number, status: EnquiryRow["status"]) => api(`/api/admin/enquiries/${id}`, { method: "PATCH", json: { status } }).then(load);
  return (
    <div className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><Inbox className="h-5 w-5 text-muted" />Website enquiries
        {rows && rows.some((r) => r.status === "new") && <Badge tone="warn">{rows.filter((r) => r.status === "new").length} new</Badge>}</h2>
      {error && <Alert tone="bad">{error}</Alert>}
      {!rows && !error && <Spinner />}
      {rows && (
        <Card pad={false}>
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.name}</span><Badge>{r.topic}</Badge>
                    <Badge tone={r.status === "new" ? "warn" : r.status === "replied" ? "good" : "neutral"}>{r.status}</Badge>
                    <span className="text-xs text-muted">{r.organisation && `${r.organisation} · `}<a href={`mailto:${r.email}`} className="underline">{r.email}</a>{r.phone && ` · ${r.phone}`} · {fmtDate(r.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{r.message}</p>
                  <div className="mt-2 flex gap-2">
                    {r.status !== "replied" && <Button variant="secondary" onClick={() => mark(r.id, "replied")}>Mark replied</Button>}
                    {r.status !== "closed" && <Button variant="ghost" onClick={() => mark(r.id, "closed")}>Close</Button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty icon={Inbox} title="No enquiries yet" />}
        </Card>
      )}
    </div>
  );
}

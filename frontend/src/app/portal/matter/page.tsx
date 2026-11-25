"use client";

import clsx from "clsx";
import { ArrowLeft, CalendarClock, CheckCircle2, Download, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "@/components/Chat";
import { Alert, Badge, Button, Card, Empty, Spinner, fmtDate } from "@/components/ui";
import { api, download, upload, type MatterTask, type Person } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

interface PortalDetail {
  case: { id: number; title: string; case_type: string; diary_no: string | null; stage: string; bench: string | null; next_hearing: string | null };
  firm: string;
  advocates: Person[];
  documents: { id: number; filename: string; pages: number; created_at: string; from_me: boolean }[];
  requests: MatterTask[];
}

export default function PortalMatter() {
  const idParam = useQueryParam("id");
  const id = idParam ? Number(idParam) : null;
  const { user } = useAuth();
  const [d, setD] = useState<PortalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "documents" | "messages">("overview");

  const load = useCallback(() => {
    if (id) api<PortalDetail>(`/api/portal/matters/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!id) return <Alert tone="bad">No matter selected.</Alert>;
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!d || !user) return <Spinner />;
  const open = d.requests.filter((r) => r.status === "open");

  return (
    <>
      <Link href="/portal" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" />My matters</Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{d.case.title}</h1>
      <p className="mt-1 text-sm text-ink-2">{d.case.case_type}{d.case.diary_no ? ` · Diary ${d.case.diary_no}` : ""} · {d.firm}</p>

      <div className="my-5 flex gap-1 border-b border-line">
        {(["overview", "documents", "messages"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx("border-b-2 px-3 py-2.5 text-sm capitalize",
            tab === t ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
            {t === "messages" ? "Message your advocate" : t}
            {t === "overview" && open.length > 0 && <span className="ml-1.5"><Badge tone="warn">{open.length}</Badge></span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Status">
            <div className="flex items-center gap-3">
              <CalendarClock className="h-8 w-8 text-accent" />
              <div>
                <div className="text-xs text-muted">Next hearing</div>
                <div className="text-xl font-semibold text-ink">{d.case.next_hearing ? fmtDate(d.case.next_hearing) : "Not fixed yet"}</div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Stage</dt><dd className="text-ink">{d.case.stage}</dd></div>
              <div><dt className="text-xs text-muted">Bench</dt><dd className="text-ink">{d.case.bench || "—"}</dd></div>
            </dl>
            {d.advocates.length > 0 && <p className="mt-4 text-sm text-ink-2">Your advocate: {d.advocates.map((a) => a.name).join(", ")}</p>}
          </Card>
          <Card title="Requests from your advocate">
            {d.requests.length ? (
              <ul className="space-y-3">{d.requests.map((r) => <Request key={r.id} caseId={id} r={r} onDone={load} />)}</ul>
            ) : <p className="text-sm text-muted">Nothing pending.</p>}
          </Card>
          <Alert tone="info">
            This portal shows the updates and documents your advocate shares with you. For legal advice about your matter, speak to your advocate directly.
          </Alert>
        </div>
      )}

      {tab === "documents" && (
        <Card title="Shared documents" pad={false}>
          {d.documents.length ? (
            <ul className="divide-y divide-line">
              {d.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="h-4 w-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{doc.filename}</div>
                    <div className="text-xs text-muted">{fmtDate(doc.created_at)}{doc.from_me ? " · uploaded by you" : ""}</div>
                  </div>
                  <Button variant="ghost" onClick={() => download(`/api/portal/documents/${doc.id}/file`, doc.filename)}><Download className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          ) : <Empty icon={FileText} title="No documents shared yet" />}
        </Card>
      )}

      {tab === "messages" && (
        <Card pad={false}>
          <Chat listUrl={`/api/portal/matters/${id}/messages`} postUrl={`/api/portal/matters/${id}/messages`} myId={user.id}
            onOpenAttachment={(a) => {
              if (a.type === "document" && a.id) download(`/api/portal/documents/${a.id}/file`, a.label).catch(() => {});
            }}
            placeholder="Write to your advocate…" />
        </Card>
      )}
    </>
  );
}

function Request({ caseId, r, onDone }: { caseId: number; r: MatterTask; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(f: File) {
    setBusy(true); setError(null);
    const form = new FormData();
    form.append("file", f); form.append("task_id", String(r.id));
    try { await upload(`/api/portal/matters/${caseId}/documents`, form); onDone(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex items-start gap-3">
        {r.status === "done" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-good-ink" /> : <Upload className="mt-0.5 h-5 w-5 text-warn-ink" />}
        <div className="flex-1">
          <div className={clsx("text-sm font-medium", r.status === "done" ? "text-muted line-through" : "text-ink")}>{r.title}</div>
          {r.details && <p className="text-xs text-ink-2">{r.details}</p>}
          {r.due_date && r.status === "open" && <p className="text-xs text-muted">Please send by {fmtDate(r.due_date)}</p>}
        </div>
        {r.status === "open" && (
          <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            Upload<input ref={input} type="file" hidden accept=".pdf,.docx,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
          </Button>
        )}
      </div>
      {error && <div className="mt-2"><Alert tone="bad">{error}</Alert></div>}
    </li>
  );
}

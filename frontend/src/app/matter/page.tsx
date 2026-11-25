"use client";

import clsx from "clsx";
import {
  ArrowLeft, BookMarked, CalendarClock, CheckCircle2, Landmark, Circle, Download, ExternalLink, Eye, EyeOff, FileSignature, FileText, FolderInput,
  History, ListTodo, MessageSquare, Trash2, Upload, UserPlus, Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Chat } from "@/components/Chat";
import { Compilation } from "@/components/Compilation";
import { Hearings } from "@/components/Hearings";
import { Provision, type ProvisionData } from "@/components/Provision";
import { Alert, Badge, Button, Card, Empty, Input, Label, Select, Spinner, StatusBadge, fmtDate } from "@/components/ui";
import { api, download, inviteContact, upload, type Attachment, type Matter, type MatterDoc, type MatterRef, type MatterTask } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

const TABS = [
  { id: "overview", label: "Overview", icon: Users },
  { id: "hearings", label: "Hearings", icon: CalendarClock },
  { id: "team", label: "Team discussion", icon: MessageSquare },
  { id: "client", label: "Client", icon: MessageSquare },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "references", label: "References", icon: BookMarked },
  { id: "law", label: "Applicable law", icon: Landmark },
  { id: "filing", label: "Filing", icon: FileSignature },
  { id: "activity", label: "Activity", icon: History },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function MatterPage() {
  const idParam = useQueryParam("id");
  const id = idParam ? Number(idParam) : null;
  const { user } = useAuth();
  const [m, setM] = useState<Matter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [docs, setDocs] = useState<MatterDoc[]>([]);
  const [refs, setRefs] = useState<MatterRef[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    api<Matter>(`/api/matters/${id}`).then(setM).catch((e) => setError(e.message));
    api<MatterDoc[]>(`/api/matters/${id}/documents`).then(setDocs).catch(() => {});
    api<MatterRef[]>(`/api/matters/${id}/references`).then(setRefs).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!id) return <Alert tone="bad">No matter selected.</Alert>;
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!m || !user) return <Spinner />;

  const attachOptions: Attachment[] = [
    ...docs.map((d) => ({ type: "document" as const, id: d.id, label: d.filename })),
    ...refs.filter((r) => r.document_id).map((r) => ({ type: "judgment" as const, id: r.document_id!, label: r.title, citation: r.citation })),
  ];
  const clientAttach = attachOptions.filter((a) => a.type === "judgment" || docs.find((d) => d.id === a.id)?.shared_with_client);
  const openAttachment = (a: Attachment) => {
    if (a.type === "document" && a.id) download(`/api/documents/${a.id}/file`, a.label).catch(() => {});
    else if (a.type === "judgment") {
      const r = refs.find((x) => x.document_id === a.id);
      if (r?.source_url) window.open(r.source_url, "_blank", "noopener");
    }
  };

  return (
    <>
      <Link href="/cases" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" />Cases &amp; Hearings</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{m.case.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>{m.case.case_number || m.case.case_type}</span>{m.case.diary_no && <span>· Diary {m.case.diary_no}</span>}
            <Badge>{m.case.stage}</Badge><StatusBadge status={m.case.filing_status} />
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs text-muted">Next hearing</div>
          <div className="font-semibold text-ink">{fmtDate(m.case.next_hearing)}</div>
        </div>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
              tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
            <t.icon className="h-4 w-4" />{t.label}
            {t.id === "tasks" && m.counts.open_tasks > 0 && <Badge tone="warn">{m.counts.open_tasks}</Badge>}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview m={m} reload={load} />}
      {tab === "hearings" && <Hearings m={m} reload={load} />}
      {tab === "team" && (
        <Card pad={false}>
          <Chat listUrl={`/api/matters/${id}/messages?channel=team`} postUrl={`/api/matters/${id}/messages`} myId={user.id}
            attachOptions={attachOptions} onOpenAttachment={openAttachment}
            note="Internal and privileged: never visible to the client. Type @name to notify someone." placeholder="Message the team…" />
        </Card>
      )}
      {tab === "client" && (
        <Card pad={false}>
          {m.clients.some((c) => c.status === "active") ? (
            <Chat listUrl={`/api/matters/${id}/messages?channel=client`} postUrl={`/api/matters/${id}/messages`} myId={user.id}
              canPost={m.can_manage} attachOptions={clientAttach} onOpenAttachment={openAttachment}
              note="Visible to the client. Only documents you have shared with the client can be attached." placeholder="Message the client…" />
          ) : <Empty icon={UserPlus} title="No client on this matter yet">Invite the client from the Overview tab.</Empty>}
        </Card>
      )}
      {tab === "documents" && <Documents id={id} docs={docs} canManage={m.can_manage} reload={load} />}
      {tab === "tasks" && <Tasks id={id} m={m} reload={load} />}
      {tab === "references" && <References id={id} refs={refs} reload={load} />}
      {tab === "references" && <div className="mt-6"><Compilation id={id} title={m.case.title} refs={refs} docs={docs} /></div>}
      {tab === "law" && <ApplicableLaw id={id} />}
      {tab === "filing" && <Filing id={id} />}
      {tab === "activity" && <Activity id={id} />}
    </>
  );
}

function Overview({ m, reload }: { m: Matter; reload: () => void }) {
  const [hearing, setHearing] = useState(m.case.next_hearing ?? "");
  const [add, setAdd] = useState({ user_id: "", role: "member" });
  const [client, setClient] = useState({ name: "", contact: "" });
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { const r = await fn(); if (ok || (r as { message?: string })?.message) setMsg({ tone: "good", text: ok ?? (r as { message: string }).message }); reload(); }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Card title="Matter details">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-muted">Bench</dt><dd className="text-ink">{m.case.bench || "—"}</dd></div>
          <div><dt className="text-xs text-muted">Limitation expiry</dt><dd className="text-ink">{fmtDate(m.case.limitation_expiry)}</dd></div>
          <div><dt className="text-xs text-muted">Priority</dt><dd className="text-ink">{m.case.priority}</dd></div>
          <div><dt className="text-xs text-muted">Open registry defects</dt><dd className="text-ink">{m.case.defects}</dd></div>
        </dl>
        <form className="mt-5 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/cases/${m.case.id}`, { method: "PATCH", json: { next_hearing: hearing || null } }), "Hearing date saved. The team and client have been notified."); }}>
          <div className="flex-1"><Label hint="notifies team & client">Next hearing</Label><Input type="date" value={hearing} onChange={(e) => setHearing(e.target.value)} /></div>
          <Button type="submit" variant="secondary" disabled={hearing === (m.case.next_hearing ?? "")}>Save</Button>
        </form>
      </Card>

      <Card title={`Team (${m.team.length})`}>
        <ul className="space-y-2">
          {m.team.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{t.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
              <div className="flex-1 text-sm"><div className="text-ink">{t.name}</div><div className="text-xs text-muted">{t.role_label}</div></div>
              {t.matter_role === "lead" && <Badge tone="accent">Lead</Badge>}
              {m.can_manage && <Button variant="danger" title="Remove from matter" onClick={() => run(() => api(`/api/matters/${m.case.id}/members/${t.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
        {m.can_manage && !!m.available?.length && (
          <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/matters/${m.case.id}/members`, { method: "POST", json: { user_id: Number(add.user_id), role: add.role } }), "Added to the matter."); }}>
            <div className="min-w-40 flex-1"><Label>Add to matter</Label>
              <Select value={add.user_id} onChange={(e) => setAdd({ ...add, user_id: e.target.value })}>
                <option value="">Choose…</option>{m.available.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role_label}</option>)}
              </Select></div>
            <div className="w-28"><Label>Role</Label>
              <Select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}><option value="member">Member</option><option value="lead">Lead</option></Select></div>
            <Button type="submit" disabled={!add.user_id}><UserPlus className="h-4 w-4" />Add</Button>
          </form>
        )}
      </Card>

      <PhysicalFile id={m.case.id} reload={reload} />

      <Card title="Client access" className="lg:col-span-2">
        {m.clients.length ? (
          <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
            {m.clients.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="flex-1"><span className="text-ink">{c.name}</span> <span className="text-muted">· {c.phone ? `+91 ${c.phone}` : c.email}</span></div>
                <Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status === "active" ? "has access" : "invited"}</Badge>
                {m.can_manage && <Button variant="danger" title="Remove access" onClick={() => run(() => api(`/api/matters/${m.case.id}/clients/${c.id}`, { method: "DELETE" }), "Client access removed.")}><Trash2 className="h-4 w-4" /></Button>}
              </li>
            ))}
          </ul>
        ) : <p className="mb-4 text-sm text-ink-2">No client yet. An invited client sees only this matter: hearing date, stage, documents you share, requests and the client chat.</p>}
        {m.can_manage && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/matters/${m.case.id}/clients`, { method: "POST", json: { name: client.name, ...inviteContact(client.contact) } })).then(() => setClient({ name: "", contact: "" })); }}>
            <div className="min-w-40 flex-1"><Label>Client name</Label><Input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} /></div>
            <div className="min-w-48 flex-1"><Label>Mobile or email</Label><Input value={client.contact} onChange={(e) => setClient({ ...client, contact: e.target.value })} placeholder="98765 43210" /></div>
            <Button type="submit" disabled={client.name.trim().length < 2 || !client.contact.trim()}><UserPlus className="h-4 w-4" />Invite client</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

function Documents({ id, docs, canManage, reload }: { id: number; docs: MatterDoc[]; canManage: boolean; reload: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const revise = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<MatterDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File, replaces?: MatterDoc) {
    setBusy(true); setError(null);
    const form = new FormData();
    form.append("file", f); form.append("case_id", String(id)); form.append("use_ai", "false");
    if (replaces) {
      form.append("replaces_id", String(replaces.id));
      form.append("version_note", prompt(`What changed from version ${replaces.version}? (optional)`) ?? "");
    }
    try { await upload("/api/documents", form); reload(); } catch (e) { setError((e as Error).message); }
    setBusy(false); setReplacing(null);
  }

  return (
    <Card title={`Documents (${docs.length})`} pad={false}
      actions={<Button variant="secondary" loading={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />Upload<input ref={input} type="file" hidden accept=".pdf,.docx,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></Button>}>
      <input ref={revise} type="file" hidden accept=".pdf,.docx,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && replacing) onFile(f, replacing); }} />
      {error && <div className="p-4"><Alert tone="bad">{error}</Alert></div>}
      {docs.length ? (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <FileText className="h-4 w-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-sm font-medium text-ink">{d.filename}{d.version > 1 && <Badge tone="brand">v{d.version}</Badge>}</div>
                <div className="text-xs text-muted">{d.pages || "—"} pages · {fmtDate(d.created_at)}{d.uploaded_by && ` · by ${d.uploaded_by.name}${d.uploaded_by.kind === "client" ? " (client)" : ""}`}{d.version_note && ` · ${d.version_note}`}</div>
                {!!d.history?.length && (
                  <details className="mt-1 text-xs text-ink-2">
                    <summary className="cursor-pointer">Earlier versions ({d.history.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {d.history.map((h) => (
                        <li key={h.id} className="flex items-center gap-2">
                          <Badge>v{h.version}</Badge><span className="truncate">{h.filename}</span><span className="text-muted">{fmtDate(h.created_at)}{h.uploaded_by && ` · ${h.uploaded_by.name}`}{h.version_note && ` · ${h.version_note}`}</span>
                          <button className="text-brand hover:underline dark:text-accent" onClick={() => download(`/api/documents/${h.id}/file`, h.filename)}>Download</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {d.shared_with_client ? <Badge tone="good"><Eye className="h-3 w-3" />client can see</Badge> : <Badge><EyeOff className="h-3 w-3" />internal</Badge>}
              {canManage && (
                <Button variant="secondary" onClick={() => api(`/api/matters/${id}/documents/${d.id}`, { method: "PATCH", json: { shared_with_client: !d.shared_with_client } }).then(reload)}>
                  {d.shared_with_client ? "Stop sharing" : "Share with client"}
                </Button>
              )}
              <Button variant="ghost" title="Upload a revised version (keeps the history)" loading={busy && replacing?.id === d.id} onClick={() => { setReplacing(d); revise.current?.click(); }}><FolderInput className="h-4 w-4" />New version</Button>
              <Link href={`/documents?id=${d.id}`} className="text-xs font-medium text-brand hover:underline dark:text-accent">Analysis</Link>
              <Button variant="ghost" title="Download" onClick={() => download(`/api/documents/${d.id}/file`, d.filename)}><Download className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      ) : <Empty icon={FileText} title="No documents on this matter">Upload here, or link an analysed record from Document Intelligence.</Empty>}
    </Card>
  );
}

function Tasks({ id, m, reload }: { id: number; m: Matter; reload: () => void }) {
  const [items, setItems] = useState<MatterTask[]>([]);
  const [f, setF] = useState({ title: "", who: "", due_date: "", details: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<MatterTask[]>(`/api/matters/${id}/tasks`).then(setItems).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setError(null);
    const forClient = f.who === "client";
    try {
      await api(`/api/matters/${id}/tasks`, { method: "POST", json: {
        title: f.title, details: f.details, due_date: f.due_date || null, for_client: forClient,
        kind: forClient ? "document_request" : "task", assignee_id: !forClient && f.who ? Number(f.who) : null } });
      setF({ title: "", who: "", due_date: "", details: "" }); load(); reload();
    } catch (e) { setError((e as Error).message); }
  }

  const hasClient = m.clients.some((c) => c.status === "active");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card title="Tasks & requests" pad={false}>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                <button onClick={() => api(`/api/matters/${id}/tasks/${t.id}`, { method: "PATCH", json: { status: t.status === "done" ? "open" : "done" } }).then(() => { load(); reload(); })}
                  className="mt-0.5 text-muted hover:text-ink" aria-label="Toggle done">
                  {t.status === "done" ? <CheckCircle2 className="h-5 w-5 text-good-ink" /> : <Circle className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={clsx("text-sm font-medium", t.status === "done" ? "text-muted line-through" : "text-ink")}>{t.title}</div>
                  {t.details && <p className="text-xs text-ink-2">{t.details}</p>}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                    {t.for_client ? <Badge tone="accent">Requested from client</Badge> : t.assignee && <span>→ {t.assignee.name}</span>}
                    {t.due_date && <span>due {fmtDate(t.due_date)}</span>}
                    {t.document_id && <Badge tone="good">document received</Badge>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon={ListTodo} title="No tasks yet" />}
      </Card>
      <Card title="New task / request">
        <div className="space-y-3">
          <div><Label>What</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Certified copy of impugned order" /></div>
          <div><Label>For</Label>
            <Select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
              <option value="">Unassigned</option>
              {m.team.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.role_label}</option>)}
              {hasClient && m.can_manage && <option value="client">Client (document request)</option>}
            </Select></div>
          <div><Label hint="optional">Due</Label><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
          <div><Label hint="optional">Details</Label><Input value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></div>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button className="w-full" onClick={create} disabled={f.title.trim().length < 2}>Create</Button>
        </div>
      </Card>
    </div>
  );
}

function References({ id, refs, reload }: { id: number; refs: MatterRef[]; reload: () => void }) {
  const router = useRouter();
  const [cite, setCite] = useState({ citation: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card title={`References (${refs.length})`} pad={false}>
        {refs.length ? (
          <ul className="divide-y divide-line">
            {refs.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                <BookMarked className="mt-0.5 h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.title || r.citation}</div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-ink-2">
                    {r.citation && <span className="font-mono">{r.citation}</span>}
                    {r.decision_date && <span>{fmtDate(r.decision_date)}</span>}
                    {r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline dark:text-accent"><ExternalLink className="h-3 w-3" />PDF</a>}
                    {r.citation && <button onClick={() => router.push(`/precedent?q=${encodeURIComponent(r.citation)}`)} className="text-brand hover:underline dark:text-accent">Check validity</button>}
                  </div>
                  {r.note && <p className="mt-1 text-xs text-muted">{r.note}</p>}
                </div>
                <Button variant="danger" onClick={() => api(`/api/matters/${id}/references/${r.id}`, { method: "DELETE" }).then(reload)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        ) : <Empty icon={BookMarked} title="No references saved">Use “Save to matter” on Research results, or add a citation here.</Empty>}
      </Card>
      <Card title="Add a citation">
        <div className="space-y-3">
          <div><Label>Citation</Label><Input value={cite.citation} onChange={(e) => setCite({ ...cite, citation: e.target.value })} placeholder="(1978) 1 SCC 248" className="font-mono" /></div>
          <div><Label hint="optional">Note</Label><Input value={cite.note} onChange={(e) => setCite({ ...cite, note: e.target.value })} /></div>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button className="w-full" disabled={!cite.citation.trim()} onClick={() => api(`/api/matters/${id}/references`, { method: "POST", json: cite })
            .then(() => { setCite({ citation: "", note: "" }); reload(); }).catch((e) => setError(e.message))}>Save</Button>
        </div>
      </Card>
    </div>
  );
}

function Activity({ id }: { id: number }) {
  const [items, setItems] = useState<{ id: number; who: { name: string } | null; text: string; at: string }[] | null>(null);
  useEffect(() => { api<typeof items>(`/api/matters/${id}/activity`).then(setItems).catch(() => setItems([])); }, [id]);
  if (!items) return <Spinner />;
  return (
    <Card title="Activity" pad={false}>
      {items.length ? (
        <ol className="divide-y divide-line">
          {items.map((a) => <Row key={a.id} when={a.at}><b className="font-medium text-ink">{a.who?.name ?? "System"}</b> {a.text}</Row>)}
        </ol>
      ) : <Empty icon={History} title="No activity yet" />}
    </Card>
  );
}

function Row({ when, children }: { when: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm text-ink-2">
      <span>{children}</span>
      <span className="shrink-0 text-xs text-muted">{new Date(when + (when.endsWith("Z") ? "" : "Z")).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
    </li>
  );
}

interface FilingRow { id: number; proceeding_label: string; status: "draft" | "approved"; version: number; updated_at: string }

function Filing({ id }: { id: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<FilingRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<FilingRow[]>(`/api/matters/${id}/filing`).then(setRows).catch((e) => setError(e.message)); }, [id]);

  async function create() {
    setBusy(true); setError(null);
    try { const p = await api<{ id: number }>(`/api/matters/${id}/filing`, { method: "POST", json: { proceeding: "slp_civil" } }); router.push(`/filing?id=${p.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Card title="Filing packages" actions={<Button onClick={create} loading={busy}><FileSignature className="h-4 w-4" />New SLP (Civil) paper-book</Button>}>
      <p className="mb-4 text-sm text-ink-2">
        Builds the complete paper-book in Supreme Court format — index, synopsis &amp; list of dates, petition, certificate, affidavit,
        I.A.s, vakalatnama — from this matter’s details and documents. Parties and annexures are pre-filled; AI drafting is optional
        and every export is logged.
      </p>
      {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
      {rows === null ? <Spinner /> : rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <Link href={`/filing?id=${r.id}`} className="text-sm font-medium text-brand hover:underline dark:text-accent">{r.proceeding_label} · v{r.version}</Link>
              <span className="flex items-center gap-2 text-xs text-muted">
                {r.status === "approved" ? <Badge tone="good">Approved</Badge> : <Badge tone="warn">Draft</Badge>}{fmtDate(r.updated_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">No filing package yet.</p>}
    </Card>
  );
}

/** Every provision named in this matter's papers, verbatim, with the old/new code that governs on the offence date. */
function ApplicableLaw({ id }: { id: number }) {
  const [date, setDate] = useState("");
  const [data, setData] = useState<{ documents_scanned: number; provisions: ProvisionData[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api<{ documents_scanned: number; provisions: ProvisionData[] }>(`/api/matters/${id}/applicable-law${date ? `?offence_date=${date}` : ""}`)
      .then((r) => { if (!off) setData(r); }).catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [id, date]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-2xl text-sm text-ink-2">
            Provisions named in this matter’s documents, with their text from the bare-act library. Give the date of the offence /
            cause of action to see whether the IPC, CrPC and Evidence Act or the new Sanhitas (from 01.07.2024) govern.
          </p>
          <div><Label>Date of offence / cause of action</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" /></div>
        </div>
      </Card>
      {error && <Alert tone="bad">{error}</Alert>}
      {!data && !error && <Spinner />}
      {data && (data.provisions.length ? data.provisions.map((p) => <Provision key={`${p.code}${p.number}`} p={p} compact />)
        : <Card><Empty icon={Landmark} title="No statutory provisions found">{data.documents_scanned ? "None of the matter’s documents name a section of the IPC, CrPC, Evidence Act, BNS, BNSS, BSA or an Article of the Constitution." : "Upload the matter’s documents first."}</Empty></Card>)}
    </div>
  );
}

interface Movement { id: number; location: string; holder: string; note: string; moved_at: string; by: { name: string } | null }

const LOCATIONS = ["Chamber", "Senior's chamber", "With junior", "Court", "Registry / filing counter", "Client", "Archive"];

/** Where the physical brief is, and who moved it when. */
function PhysicalFile({ id, reload }: { id: number; reload: () => void }) {
  const [data, setData] = useState<{ current: string | null; history: Movement[] } | null>(null);
  const [f, setF] = useState({ location: "", holder: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ current: string | null; history: Movement[] }>(`/api/matters/${id}/file-movements`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function move() {
    setError(null);
    try { setData(await api(`/api/matters/${id}/file-movements`, { method: "POST", json: f })); setF({ location: "", holder: "", note: "" }); reload(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <Card title="Physical file" className="lg:col-span-2">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="text-xs text-muted">Now at</div>
          <div className="text-lg font-semibold text-ink">{data?.current || "Not recorded"}</div>
          {data?.history[0] && <div className="text-xs text-ink-2">{data.history[0].holder && `with ${data.history[0].holder} · `}since {fmtDate(data.history[0].moved_at)}{data.history[0].by && ` · moved by ${data.history[0].by.name}`}</div>}
          {data && data.history.length > 1 && (
            <details className="mt-2 text-xs text-ink-2">
              <summary className="cursor-pointer">Movement history ({data.history.length})</summary>
              <ol className="mt-1 space-y-1">{data.history.map((h) => <li key={h.id}>{fmtDate(h.moved_at)} — {h.location}{h.holder && ` (${h.holder})`}{h.note && ` · ${h.note}`}{h.by && ` · ${h.by.name}`}</li>)}</ol>
            </details>
          )}
        </div>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); move(); }}>
          <div><Label>Move to</Label>
            <Input list="file-locations" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Court No. 3" />
            <datalist id="file-locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist></div>
          <div><Label hint="optional">With</Label><Input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} placeholder="Clerk's name" /></div>
          <div className="sm:col-span-2"><Label hint="optional">Note</Label><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Original vakalatnama inside" /></div>
          <div className="sm:col-span-2"><Button type="submit" variant="secondary" disabled={f.location.trim().length < 2}>Record movement</Button></div>
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
        </form>
      </div>
    </Card>
  );
}

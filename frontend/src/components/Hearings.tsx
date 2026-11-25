"use client";

import clsx from "clsx";
import { CalendarClock, FileUp, Link2, ListChecks, Mic, MicOff, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportAI } from "@/components/ReportAI";
import { Alert, Badge, Button, Card, Empty, Input, Label, Select, Spinner, Textarea, fmtDate } from "@/components/ui";
import { api, download, upload, type HearingNote, type Listing, type Matter } from "@/lib/api";
import { useDictation } from "@/lib/speech";

interface HearingsData {
  notes: HearingNote[];
  listings: Listing[];
  outcomes: string[];
  tracking: { case_number: string | null; diary_no: string | null; keys: string[]; last_read: string | null };
}
interface Suggestion { title: string; details: string; due_date: string | null; for_client: boolean; source: "rule" | "ai"; exists: boolean }
type NoteForm = Omit<HearingNote, "id" | "created_at" | "updated_at" | "author"> & { id?: number; fromOrder?: { estimate: boolean; already: boolean } };
interface ParsedOrder { order_date: string | null; next_date: string | null; next_date_is_estimate?: boolean; court: string; item_no: string;
  bench: string; outcome: string; notes: string; document_id: number; filename: string; already_noted: boolean; record_of_proceedings: boolean }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const utc = (s: string) => new Date(s + (s.endsWith("Z") ? "" : "Z"));

export function ListingRow({ l, showCase }: { l: Listing; showCase?: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-3">
      <div className="w-24 shrink-0">
        <div className="text-sm font-semibold tabular-nums text-ink">{fmtDate(l.list_date)}</div>
        <Badge tone={l.kind === "daily" ? "good" : "neutral"}>{l.kind === "daily" ? "Daily list" : "Advance (tentative)"}</Badge>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        {showCase && l.case && <div className="font-medium text-ink">{l.case}</div>}
        <div className="text-ink">{[l.court, l.item_no && `Item ${l.item_no}`].filter(Boolean).join(" · ") || "Court not yet assigned"}</div>
        <div className="text-xs text-ink-2"><span className="font-mono">{l.case_no}</span>{l.parties && ` · ${l.parties}`}</div>
        {l.bench && <div className="mt-0.5 text-xs text-muted">{l.bench}</div>}
      </div>
      <span className="text-xs text-muted">p.{l.page}</span>
    </li>
  );
}

/** Add a published cause list: by its sci.gov.in PDF link (read from the court) or as a downloaded PDF. */
export function CauseListImport({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function send(form: FormData) {
    setBusy(true); setMsg(null);
    try {
      const r = await upload<{ list_date: string; kind: string; items: number; matches: number; already: boolean; shared?: boolean }>("/api/causelist/import", form);
      setMsg({ tone: "good", text: r.already ? `Already added: ${r.kind} list of ${fmtDate(r.list_date)}.`
        : `${r.kind === "daily" ? "Daily" : "Advance"} list of ${fmtDate(r.list_date)}: ${r.items} items read, ${r.matches} of your matters found.` });
      setUrl(""); onDone?.();
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <div className={clsx("space-y-2", !compact && "text-sm")}>
      {!compact && <p className="text-ink-2">Open <a href="https://www.sci.gov.in/cause-list/" target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline dark:text-accent">sci.gov.in → Cause List</a>, right-click a list (e.g. a court&apos;s daily list or the advance list) → Copy link, and paste it here. One list covers every matter in the chamber.</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(); f.append("url", url); send(f); }}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.sci.gov.in/jonew/cl/…pdf" className="font-mono text-xs" />
        <Button type="submit" variant="secondary" loading={busy && !!url} disabled={!url.trim()}><Link2 className="h-4 w-4" />Add</Button>
      </form>
      <div className="flex items-center gap-2">
        <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f0 = e.target.files?.[0]; e.target.value = ""; if (f0) { const f = new FormData(); f.append("file", f0); send(f); } }} />
        <Button type="button" variant="ghost" loading={busy && !url} onClick={() => file.current?.click()} className="whitespace-nowrap"><FileUp className="h-4 w-4" />Upload PDF</Button>
        <span className="text-xs text-muted">An uploaded PDF is matched only to your chamber&apos;s matters.</span>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}

export function Hearings({ m, reload }: { m: Matter; reload: () => void }) {
  const id = m.case.id;
  const [data, setData] = useState<HearingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NoteForm | null>(null);
  const [track, setTrack] = useState({ case_number: m.case.case_number ?? "", diary_no: m.case.diary_no ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<HearingsData>(`/api/matters/${id}/hearings`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!data) return <Spinner />;

  const today = ymd(new Date());
  const upcoming = data.listings.filter((l) => l.list_date >= today);
  const past = data.listings.filter((l) => l.list_date < today);

  function newNote() {
    const t = ymd(new Date());
    const l = data!.listings.find((x) => x.list_date === t && x.kind === "daily");
    setForm({ hearing_date: t, court: l?.court ?? "", bench: l?.bench ?? "", item_no: l?.item_no ?? "", outcome: "", notes: "", next_date: null, dictated: false, document_id: null });
  }

  function fromOrder(o: ParsedOrder) {
    setForm({ hearing_date: o.order_date ?? ymd(new Date()), court: o.court, bench: o.bench, item_no: o.item_no, outcome: o.outcome,
      notes: o.notes, next_date: o.next_date, dictated: false, document_id: o.document_id,
      fromOrder: { estimate: !!o.next_date_is_estimate, already: o.already_noted } });
    reload();
  }

  async function saveTracking() {
    setMsg(null);
    try {
      await api(`/api/cases/${id}`, { method: "PATCH", json: { case_number: track.case_number.trim() || null, diary_no: track.diary_no.trim() || null } });
      setMsg("Saved. The cause lists already read were checked for this number."); load(); reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title="Cause list" pad={false}>
          {upcoming.length ? <ul className="divide-y divide-line">{upcoming.map((l) => <ListingRow key={l.id} l={l} />)}</ul>
            : <Empty icon={CalendarClock} title="Not in any published cause list yet">
                {data.tracking.keys.length ? "Add the day's cause list below (or on the Chamber page). When this matter is in it, the team is notified and the next hearing is set."
                  : "Enter the case number or diary number (with year) to track this matter in the cause lists."}
              </Empty>}
          <div className="border-t border-line px-5 py-3"><CauseListImport compact onDone={load} /></div>
          {past.length > 0 && (
            <details className="border-t border-line px-5 py-2 text-sm text-ink-2">
              <summary className="cursor-pointer py-1">Earlier listings ({past.length})</summary>
              <ul className="divide-y divide-line">{past.map((l) => <ListingRow key={l.id} l={l} />)}</ul>
            </details>
          )}
        </Card>
        <Card title="Track in cause lists">
          <div className="space-y-3">
            <div><Label hint="as the cause list prints it">Case number</Label>
              <Input value={track.case_number} onChange={(e) => setTrack({ ...track, case_number: e.target.value })} placeholder="SLP(C) No. 30665/2026" className="font-mono" /></div>
            <div><Label hint="with year">Diary number</Label>
              <Input value={track.diary_no} onChange={(e) => setTrack({ ...track, diary_no: e.target.value })} placeholder="34272/2026" className="font-mono" /></div>
            <Button className="w-full" variant="secondary" onClick={saveTracking}
              disabled={track.case_number === (m.case.case_number ?? "") && track.diary_no === (m.case.diary_no ?? "")}>Save</Button>
            {msg && <p className="text-xs text-ink-2">{msg}</p>}
            <p className="text-xs text-muted">
              Matched only on case or diary number, never on party names. A daily-list listing sets the next hearing and notifies the team.
              {data.tracking.last_read && ` Lists last read ${utc(data.tracking.last_read).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.`}
            </p>
          </div>
        </Card>
      </div>

      <Card title={`Hearing notes (${data.notes.length})`} pad={false}
        actions={!form && <div className="flex flex-wrap gap-2"><OrderImport matterId={id} onParsed={fromOrder} /><Button onClick={newNote}><Plus className="h-4 w-4" />Add hearing note</Button></div>}>
        {form && <NoteEditor matterId={id} value={form} outcomes={data.outcomes} onDone={(saved) => { setForm(null); if (saved) { load(); reload(); } }} />}
        {data.notes.length ? (
          <ul className="divide-y divide-line">
            {data.notes.map((n) => <NoteItem key={n.id} n={n} m={m} onEdit={() => setForm({ ...n })} reload={() => { load(); reload(); }} />)}
          </ul>
        ) : !form && <Empty icon={ListChecks} title="No hearing notes yet">After each hearing, record what happened and the next date — type it or dictate it. Follow-up tasks are suggested from the note.</Empty>}
      </Card>
    </div>
  );
}

function NoteEditor({ matterId, value, outcomes, onDone }: { matterId: number; value: NoteForm; outcomes: string[]; onDone: (saved: boolean) => void }) {
  const [f, setF] = useState(value);
  const [lang, setLang] = useState("en-IN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const append = useCallback((t: string) => setF((x) => ({ ...x, dictated: true, notes: x.notes ? `${x.notes.replace(/\s+$/, "")} ${t}` : t })), []);
  const voice = useDictation(append, lang);

  async function save() {
    setSaving(true); setError(null);
    voice.stop();
    const { id, fromOrder: _src, ...body } = f;
    void _src;
    try {
      await api(id ? `/api/matters/${matterId}/hearings/${id}` : `/api/matters/${matterId}/hearings`, { method: id ? "PATCH" : "POST", json: { ...body, next_date: body.next_date || null } });
      onDone(true);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div className="space-y-3 border-b border-line bg-surface-2/40 p-5">
      {f.fromOrder && <Alert tone={f.fromOrder.already ? "warn" : "info"}>
        {f.fromOrder.already ? "A hearing note already uses this order. " : ""}Filled in from the order — check every field before saving.
        {f.fromOrder.estimate && " The next date is worked out from “after … weeks”; the registry fixes the actual date."}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <div><Label>Hearing date</Label><Input type="date" value={f.hearing_date} onChange={(e) => setF({ ...f, hearing_date: e.target.value })} /></div>
        <div><Label>Court</Label><Input value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })} placeholder="Court No. 3" /></div>
        <div><Label>Item</Label><Input value={f.item_no} onChange={(e) => setF({ ...f, item_no: e.target.value })} /></div>
        <div><Label>What happened</Label>
          <Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
            {outcomes.map((o) => <option key={o} value={o}>{o ? o[0].toUpperCase() + o.slice(1) : "—"}</option>)}
          </Select></div>
      </div>
      <div><Label hint="optional">Bench</Label><Input value={f.bench} onChange={(e) => setF({ ...f, bench: e.target.value })} /></div>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Label>Notes</Label>
          <div className="flex items-center gap-2">
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={voice.listening} aria-label="Dictation language"
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink">
              <option value="en-IN">English</option><option value="hi-IN">हिंदी</option>
            </select>
            <Button type="button" variant={voice.listening ? "danger" : "secondary"} onClick={voice.listening ? voice.stop : voice.start}>
              {voice.listening ? <><MicOff className="h-4 w-4" />Stop dictation</> : <><Mic className="h-4 w-4" />Dictate</>}
            </Button>
          </div>
        </div>
        <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-40"
          placeholder="e.g. Notice issued, returnable in four weeks. Counter affidavit within 4 weeks, rejoinder 2 weeks thereafter. Interim stay continued." />
        {voice.listening && <p className={clsx("mt-1 text-xs", voice.interim ? "text-ink-2" : "text-muted")}>{voice.interim || "Listening… speak your note."}</p>}
        {voice.error && <div className="mt-2"><Alert tone="bad">{voice.error}</Alert></div>}
        <p className="mt-1 text-xs text-muted">For your own dictation after the hearing. Recording court proceedings needs the Court&apos;s permission. Voice typing sends audio to the browser&apos;s speech service (Google / Microsoft).</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label hint="updates the matter and notifies the team & client">Next date</Label>
          <Input type="date" value={f.next_date ?? ""} onChange={(e) => setF({ ...f, next_date: e.target.value || null })} className="w-48" /></div>
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => { voice.stop(); onDone(false); }}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!f.hearing_date}>Save note</Button>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
    </div>
  );
}

function NoteItem({ n, m, onEdit, reload }: { n: HearingNote; m: Matter; onEdit: () => void; reload: () => void }) {
  const [sugs, setSugs] = useState<(Suggestion & { pick: boolean; who: string })[] | null>(null);
  const [busy, setBusy] = useState<"rules" | "ai" | "create" | null>(null);
  const [logId, setLogId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function suggest(ai: boolean) {
    setBusy(ai ? "ai" : "rules"); setError(null); setDone(null);
    try {
      const r = await api<{ suggestions: Suggestion[]; ai_log_id: number | null }>(`/api/matters/${m.case.id}/hearings/${n.id}/suggest-tasks`, { method: "POST", json: { ai } });
      setSugs(r.suggestions.map((s) => ({ ...s, pick: !s.exists, who: s.for_client ? "client" : "" })));
      setLogId(r.ai_log_id);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function create() {
    const picked = (sugs ?? []).filter((s) => s.pick);
    setBusy("create"); setError(null);
    try {
      await api(`/api/matters/${m.case.id}/tasks/bulk`, { method: "POST", json: { tasks: picked.map((s) => ({
        title: s.title, details: s.details, due_date: s.due_date, for_client: s.who === "client",
        kind: s.who === "client" ? "document_request" : "task", assignee_id: s.who && s.who !== "client" ? Number(s.who) : null })) } });
      setDone(`${picked.length} task(s) created — see the Tasks tab.`); setSugs(null); reload();
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  const hasClient = m.clients.some((c) => c.status === "active");
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">{fmtDate(n.hearing_date)}{n.outcome && <span className="font-normal text-ink-2"> · {n.outcome}</span>}</div>
          <div className="text-xs text-muted">{[n.court, n.item_no && `item ${n.item_no}`, n.bench].filter(Boolean).join(" · ")}{n.author && ` · by ${n.author.name}`}{n.dictated && " · dictated"}
            {n.document_id && <> · <button className="text-brand underline dark:text-accent" onClick={() => download(`/api/documents/${n.document_id}/file`, "order.pdf")}>order PDF</button></>}</div>
        </div>
        <div className="flex items-center gap-1">
          {n.next_date && <Badge tone="accent">Next date {fmtDate(n.next_date)}</Badge>}
          <Button variant="ghost" title="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button variant="danger" title="Delete" onClick={() => { if (confirm("Delete this hearing note?")) api(`/api/matters/${m.case.id}/hearings/${n.id}`, { method: "DELETE" }).then(reload).catch((e) => setError(e.message)); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {n.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{n.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === "rules"} onClick={() => suggest(false)}><ListChecks className="h-4 w-4" />Follow-up tasks</Button>
        <Button variant="ghost" loading={busy === "ai"} onClick={() => suggest(true)} title="Also read the note with AI (Haiku); you still choose what to create"><Sparkles className="h-4 w-4" />AI suggestions</Button>
      </div>
      {done && <div className="mt-2"><Alert tone="good">{done}</Alert></div>}
      {error && <div className="mt-2"><Alert tone="bad">{error}</Alert></div>}
      {sugs && (
        <div className="mt-3 rounded-lg border border-line">
          {sugs.length ? (
            <ul className="divide-y divide-line">
              {sugs.map((s, i) => {
                const set = (p: Partial<typeof s>) => setSugs(sugs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={s.pick} onChange={(e) => set({ pick: e.target.checked })} aria-label="Create this task" />
                    <Input value={s.title} onChange={(e) => set({ title: e.target.value })} className="min-w-48 flex-1" />
                    <Input type="date" value={s.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null })} className="w-40" />
                    <Select value={s.who} onChange={(e) => set({ who: e.target.value })} className="w-44">
                      <option value="">Unassigned</option>
                      {m.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      {hasClient && m.can_manage && <option value="client">Client (request)</option>}
                    </Select>
                    {s.source === "ai" && <Badge tone="accent">AI</Badge>}
                    {s.exists && <Badge>already open</Badge>}
                  </li>
                );
              })}
            </ul>
          ) : <p className="p-3 text-sm text-muted">Nothing to suggest from this note.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className="text-xs text-muted">Suggestions only — tick what to create, edit titles and dates.</span>
            <div className="flex items-center gap-2">
              {logId && <ReportAI feature="hearing_tasks" excerpt={sugs.map((s) => s.title).join("; ")} logId={logId} />}
              <Button onClick={create} loading={busy === "create"} disabled={!sugs.some((s) => s.pick && s.title.trim().length > 1)}>Create selected</Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** Read a Supreme Court order (its sci.gov.in link or the PDF) into a draft hearing note. */
function OrderImport({ matterId, onParsed }: { matterId: number; onParsed: (o: ParsedOrder) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function send(form: FormData) {
    setBusy(true); setError(null);
    try { onParsed(await upload<ParsedOrder>(`/api/matters/${matterId}/orders`, form)); setOpen(false); setUrl(""); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}><FileUp className="h-4 w-4" />From an order</Button>;
  return (
    <div className="w-full space-y-2 rounded-lg border border-line bg-surface p-3 sm:w-[26rem]">
      <p className="text-xs text-ink-2">Open the order on sci.gov.in (case status → orders) and copy its PDF link, or upload the PDF you downloaded.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(); f.append("url", url); send(f); }}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.sci.gov.in/…pdf" className="font-mono text-xs" />
        <Button type="submit" variant="secondary" loading={busy && !!url} disabled={!url.trim()}><Link2 className="h-4 w-4" /></Button>
      </form>
      <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f0 = e.target.files?.[0]; e.target.value = ""; if (f0) { const f = new FormData(); f.append("file", f0); send(f); } }} />
      <div className="flex gap-2">
        <Button variant="ghost" loading={busy && !url} onClick={() => file.current?.click()}><FileUp className="h-4 w-4" />Upload PDF</Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
    </div>
  );
}

"use client";

import clsx from "clsx";
import {
  ArrowLeft, CalendarClock, CalendarPlus, Check, CircleCheck, FileText, ListTodo, MessageCircleQuestionMark, Pencil, Phone, Printer, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CaseFields, NotAdvice, caseBody, type CaseForm } from "@/components/personal/kit";
import { ExplainPaper, PaperRow, UploadPaper, usePapers, type Paper } from "@/components/personal/Papers";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Spinner, Textarea, fmtDate } from "@/components/ui";
import { api, type Case, type CaseDetails, type HearingNote, type MatterTask } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

type Tab = "overview" | "dates" | "papers" | "todo" | "questions";
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "dates", label: "Court dates", icon: CalendarClock },
  { id: "papers", label: "Papers", icon: FileText },
  { id: "todo", label: "To do", icon: ListTodo },
  { id: "questions", label: "Questions for advocate", icon: MessageCircleQuestionMark },
];
const HAPPENED = ["Date changed (adjourned)", "Arguments heard", "Evidence / witness", "Order passed", "Notice / summons issued",
  "Bail matter heard", "Judgment given", "Did not come up", "Other"];

export default function MyCasePage() {
  const id = Number(useQueryParam("id"));
  const askedTab = useQueryParam("tab") as Tab | null;
  const router = useRouter();
  const [c, setC] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setTab] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (askedTab && TABS.some((t) => t.id === askedTab) ? askedTab : "overview");

  const load = useCallback(() => {
    if (!id) return;
    api<Case[]>("/api/cases").then((all) => {
      const found = all.find((x) => x.id === id);
      if (found) setC(found); else setError("Case not found.");
    }).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(changes: Partial<Case> & { details?: CaseDetails }) {
    const updated = await api<Case>(`/api/cases/${id}`, { method: "PATCH", json: changes });
    setC(updated);
  }

  async function remove() {
    if (!c || !confirm(`Delete "${c.title}" with all its dates, papers and notes? This cannot be undone.`)) return;
    try { await api(`/api/cases/${id}`, { method: "DELETE" }); router.replace("/my-cases"); } catch (e) { setError((e as Error).message); }
  }

  if (error) return <><BackLink /><Alert tone="bad">{error}</Alert></>;
  if (!c) return <Spinner />;

  return (
    <>
      <BackLink />
      <PageHeader title={c.title}
        subtitle={[c.details?.case_kind, c.details?.court, c.case_number].filter(Boolean).join(" · ") || "Your case"}
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print summary</Button>
          <Button variant="danger" onClick={remove}><Trash2 className="h-4 w-4" />Delete</Button>
        </>} />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line print:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              tab === t.id ? "border-brand font-medium text-ink dark:border-accent" : "border-transparent text-ink-2 hover:text-ink")}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      <div className="print:hidden">
        {tab === "overview" && <Overview c={c} onSave={patch} />}
        {tab === "dates" && <Dates c={c} onChanged={load} />}
        {tab === "papers" && <Papers caseId={c.id} />}
        {tab === "todo" && <Todo caseId={c.id} />}
        {tab === "questions" && <Questions c={c} onSave={patch} />}
      </div>
      <PrintSummary c={c} />
    </>
  );
}

function BackLink() {
  return <Link href="/my-cases" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink print:hidden"><ArrowLeft className="h-4 w-4" />My cases</Link>;
}

// ---------------------------------------------------------------- overview

function Overview({ c, onSave }: { c: Case; onSave: (x: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const toForm = (): CaseForm => ({ title: c.title, stage: c.stage, case_number: c.case_number ?? "", next_hearing: c.next_hearing ?? "", details: c.details ?? {} });
  const [form, setForm] = useState<CaseForm>(toForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = c.details ?? {};

  async function save() {
    setSaving(true); setError(null);
    try { await onSave({ ...caseBody(form), details: { ...d, ...form.details } }); setEditing(false); }
    catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  if (editing) return (
    <Card title="Edit case">
      <CaseFields value={form} onChange={setForm} />
      {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
      <div className="mt-5 flex gap-2"><Button onClick={save} loading={saving}>Save</Button>
        <Button variant="secondary" onClick={() => { setForm(toForm()); setEditing(false); }}>Cancel</Button></div>
    </Card>
  );

  const rows: [string, string | null | undefined][] = [
    ["Type of case", d.case_kind], ["Your side", d.my_role], ["Other party", d.other_party], ["Where it is now", d.court],
    ["City", d.city], ["Stage", c.stage], ["Case number", c.case_number], ["FIR number", d.fir_no], ["Police station", d.police_station],
    ["Case / FIR date", d.filed_on],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="About this case" actions={<Button variant="ghost" className="text-xs" onClick={() => { setForm(toForm()); setEditing(true); }}><Pencil className="h-3.5 w-3.5" />Edit</Button>}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-sm text-ink">{v}</dd></div>
            ))}
          </dl>
          {d.summary && <div className="mt-5 border-t border-line pt-4"><div className="text-xs text-muted">In your words</div><p className="mt-1 whitespace-pre-wrap text-sm text-ink">{d.summary}</p></div>}
        </Card>
        <NotAdvice />
      </div>
      <div className="space-y-4">
        <Card title="Next date in court">
          <div className="text-2xl font-semibold text-ink">{c.next_hearing ? fmtDate(c.next_hearing) : "Not added"}</div>
          <p className="mt-1 text-xs text-ink-2">You get a reminder here the day before. Change it under Court dates.</p>
        </Card>
        <Card title="Your advocate">
          {d.advocate_name || d.advocate_phone ? (
            <div className="space-y-1 text-sm">
              {d.advocate_name && <div className="font-medium text-ink">{d.advocate_name}</div>}
              {d.advocate_phone && <a href={`tel:${d.advocate_phone}`} className="flex items-center gap-1.5 text-brand hover:underline dark:text-accent"><Phone className="h-3.5 w-3.5" />{d.advocate_phone}</a>}
              {d.advocate_email && <a href={`mailto:${d.advocate_email}`} className="block text-ink-2 hover:underline">{d.advocate_email}</a>}
            </div>
          ) : <p className="text-sm text-ink-2">Not added. <Link href="/legal-help" className="text-brand hover:underline dark:text-accent">How to find an advocate or free legal aid</Link>.</p>}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- court dates

function Dates({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const [notes, setNotes] = useState<HearingNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ hearing_date: today, outcome: HAPPENED[0], notes: "", next_date: "" });
  const [saving, setSaving] = useState(false);
  const [nextOnly, setNextOnly] = useState(c.next_hearing ?? "");

  const load = useCallback(() => {
    api<{ notes: HearingNote[] }>(`/api/matters/${c.id}/hearings`).then((r) => setNotes(r.notes)).catch((e) => setError(e.message));
  }, [c.id]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setSaving(true); setError(null);
    try {
      await api(`/api/matters/${c.id}/hearings`, { method: "POST", json: { ...f, court: c.details?.court ?? "", next_date: f.next_date || null } });
      setAdding(false); setF({ hearing_date: today, outcome: HAPPENED[0], notes: "", next_date: "" }); load(); onChanged();
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }
  async function setNext() {
    setError(null);
    try { await api(`/api/cases/${c.id}`, { method: "PATCH", json: { next_hearing: nextOnly || null } }); onChanged(); }
    catch (e) { setError((e as Error).message); }
  }
  async function del(n: HearingNote) {
    if (!confirm("Delete this entry?")) return;
    await api(`/api/matters/${c.id}/hearings/${n.id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title="What happened on each date" actions={!adding && <Button className="text-xs" onClick={() => setAdding(true)}><CalendarPlus className="h-4 w-4" />Add a date</Button>}>
          {adding && (
            <div className="mb-5 space-y-4 rounded-lg border border-line p-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><Label>Date in court</Label><Input type="date" value={f.hearing_date} onChange={(e) => setF({ ...f, hearing_date: e.target.value })} /></div>
                <div><Label>What happened</Label><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{HAPPENED.map((h) => <option key={h}>{h}</option>)}</Select></div>
                <div><Label hint="if given">Next date</Label><Input type="date" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></div>
              </div>
              <div><Label hint="optional">Notes</Label><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What the judge or your advocate said, what you need to bring next time…" /></div>
              <div className="flex gap-2"><Button onClick={add} loading={saving}>Save</Button><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button></div>
            </div>
          )}
          {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
          {!notes ? <Spinner /> : notes.length ? (
            <ol className="relative space-y-5 border-l border-line pl-5">
              {notes.map((n) => (
                <li key={n.id} className="relative">
                  <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-brand dark:bg-accent" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{fmtDate(n.hearing_date)}</span>
                    {n.outcome && <Badge>{n.outcome}</Badge>}
                    {n.next_date && <span className="text-xs text-ink-2">Next date {fmtDate(n.next_date)}</span>}
                    <button onClick={() => del(n)} className="ml-auto text-muted hover:text-bad-ink" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  {n.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{n.notes}</p>}
                </li>
              ))}
            </ol>
          ) : <Empty icon={CalendarClock} title="No dates added yet">After each date in court, note what happened and the next date. It builds the history of your case.</Empty>}
        </Card>
      </div>
      <Card title="Next date in court">
        <Label>Date</Label>
        <Input type="date" value={nextOnly} onChange={(e) => setNextOnly(e.target.value)} />
        <Button className="mt-3 w-full" onClick={setNext} disabled={(nextOnly || "") === (c.next_hearing ?? "")}>Save next date</Button>
        <p className="mt-2 text-xs text-ink-2">You get a reminder here the day before (and on WhatsApp, once your number is linked and WhatsApp alerts are on).</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- papers

function Papers({ caseId }: { caseId: number }) {
  const { papers, error, reload } = usePapers(caseId);
  const [open, setOpen] = useState<Paper | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <UploadPaper caseId={caseId} onDone={() => reload()} />
        {error && <Alert tone="bad">{error}</Alert>}
        {!papers ? <Spinner /> : papers.length ? (
          <div className="space-y-2">{papers.map((p) => <PaperRow key={p.id} p={p} active={open?.id === p.id} onOpen={() => setOpen(p)} onDeleted={() => { if (open?.id === p.id) setOpen(null); reload(); }} />)}</div>
        ) : <p className="text-sm text-ink-2">No papers yet. Upload the FIR, notices, summons, orders or agreements of this case.</p>}
      </div>
      <div className="lg:col-span-3">
        <Card>{open ? <ExplainPaper key={open.id} paper={open} /> : <Empty icon={FileText} title="Pick a paper to understand it">Click “Explain” on any paper to read it in simple English or Hindi.</Empty>}</Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- to do

function Todo({ caseId }: { caseId: number }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<MatterTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<MatterTask[]>(`/api/matters/${caseId}/tasks`).then(setTasks).catch((e) => setError(e.message)); }, [caseId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (title.trim().length < 2) return;
    setError(null);
    try {
      // assigned to yourself so the "due tomorrow" reminder reaches you
      await api(`/api/matters/${caseId}/tasks`, { method: "POST", json: { title: title.trim(), due_date: due || null, assignee_id: user?.id } });
      setTitle(""); setDue(""); load();
    } catch (e) { setError((e as Error).message); }
  }
  async function toggle(t: MatterTask) {
    await api(`/api/matters/${caseId}/tasks/${t.id}`, { method: "PATCH", json: { status: t.status === "open" ? "done" : "open" } }).catch((e) => setError(e.message));
    load();
  }

  return (
    <Card title="Things to do for this case">
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Get certified copy of the order, collect bank statement" className="flex-1" />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="sm:w-44" />
        <Button type="submit" disabled={title.trim().length < 2}>Add</Button>
      </form>
      {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
      {!tasks ? <Spinner /> : tasks.length ? (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => toggle(t)} aria-label={t.status === "open" ? "Mark done" : "Mark not done"}
                className={clsx("grid h-5 w-5 shrink-0 place-items-center rounded border", t.status === "done" ? "border-good bg-good text-white" : "border-line hover:border-brand")}>
                {t.status === "done" && <Check className="h-3.5 w-3.5" />}
              </button>
              <span className={clsx("flex-1 text-sm", t.status === "done" ? "text-muted line-through" : "text-ink")}>{t.title}</span>
              {t.for_client && <Badge tone="warn">From advocate</Badge>}
              {t.due_date && <span className="text-xs text-ink-2">{fmtDate(t.due_date)}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-2">Nothing yet. Add what you need to do or collect before the next date.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- questions for the advocate

function Questions({ c, onSave }: { c: Case; onSave: (x: Record<string, unknown>) => Promise<void> }) {
  const list = c.details?.questions ?? [];
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = (questions: NonNullable<CaseDetails["questions"]>) =>
    onSave({ details: { ...(c.details ?? {}), questions } }).catch((e) => setError((e as Error).message));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Questions to ask your advocate" className="lg:col-span-2">
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { save([...list, { text: text.trim() }]); setText(""); } }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Do I need to be present on the next date?" className="flex-1" />
          <Button type="submit" disabled={!text.trim()}>Add</Button>
        </form>
        {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
        {list.length ? (
          <ul className="space-y-3">
            {list.map((q, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <div className="flex items-start gap-2">
                  <button onClick={() => save(list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} title={q.done ? "Mark not asked" : "Mark asked"}
                    className={clsx("mt-0.5", q.done ? "text-good-ink" : "text-muted hover:text-ink")}><CircleCheck className="h-4 w-4" /></button>
                  <span className={clsx("flex-1 text-sm", q.done ? "text-ink-2" : "font-medium text-ink")}>{q.text}</span>
                  <button onClick={() => save(list.filter((_, j) => j !== i))} className="text-muted hover:text-bad-ink" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <AnswerNote value={q.answer ?? ""} onSave={(answer) => save(list.map((x, j) => (j === i ? { ...x, answer, done: !!answer || x.done } : x)))} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-2">Write down questions as they come to you, and take this list to your next meeting. “Explain” on a paper also suggests questions.</p>}
      </Card>
      <NotAdvice>Your advocate knows the full facts of your case. Use the answers here as your own notes; an AI tool cannot replace your advocate&apos;s advice.</NotAdvice>
    </div>
  );
}

function AnswerNote({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  if (!open) return value
    ? <p className="mt-2 whitespace-pre-wrap border-l-2 border-good/50 pl-3 text-sm text-ink-2"><button onClick={() => setOpen(true)} className="float-right text-xs text-muted hover:text-ink">Edit</button>{value}</p>
    : <button onClick={() => setOpen(true)} className="ml-6 mt-1 text-xs font-medium text-brand hover:underline dark:text-accent">Write the answer you got</button>;
  return (
    <div className="ml-6 mt-2 space-y-2">
      <Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder="What your advocate said" />
      <div className="flex gap-2"><Button className="px-2.5 py-1 text-xs" onClick={() => { onSave(v.trim()); setOpen(false); }}>Save</Button>
        <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => { setV(value); setOpen(false); }}>Cancel</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- print view (one page to take to the advocate)

function PrintSummary({ c }: { c: Case }) {
  const d = c.details ?? {};
  const open = (d.questions ?? []).filter((q) => !q.done);
  return (
    <div className="hidden text-black print:block">
      <h1 className="text-xl font-bold">{c.title}</h1>
      <p className="mt-1 text-sm">{[d.case_kind, d.court, d.city, c.case_number && `Case no. ${c.case_number}`, d.fir_no && `FIR ${d.fir_no}`, d.police_station].filter(Boolean).join(" · ")}</p>
      <table className="mt-4 text-sm"><tbody>
        {[["Your side", d.my_role], ["Other party", d.other_party], ["Stage", c.stage], ["Next date", c.next_hearing ? fmtDate(c.next_hearing) : "—"], ["Case / FIR date", d.filed_on]]
          .filter(([, v]) => v).map(([k, v]) => <tr key={k}><td className="pr-6 align-top font-semibold">{k}</td><td>{v}</td></tr>)}
      </tbody></table>
      {d.summary && <><h2 className="mt-5 font-bold">What the case is about</h2><p className="whitespace-pre-wrap text-sm">{d.summary}</p></>}
      {open.length > 0 && <><h2 className="mt-5 font-bold">Questions for my advocate</h2><ol className="ml-5 list-decimal text-sm">{open.map((q, i) => <li key={i}>{q.text}</li>)}</ol></>}
      <p className="mt-8 text-xs">Prepared on Nyay Apex (nyayapex.ai) from the person&apos;s own notes. Not legal advice.</p>
    </div>
  );
}


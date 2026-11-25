"use client";

import { ExternalLink, Mic, MicOff, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Spinner, Textarea, fmtDate } from "@/components/ui";
import { api, type HearingNote, type Listing } from "@/lib/api";
import { useDictation } from "@/lib/speech";

interface Pack {
  case: { id: number; title: string; case_type: string; case_number: string | null; diary_no: string | null; bench: string | null; stage: string; next_hearing: string | null };
  listing: Listing[];
  last_note: HearingNote | null;
  briefs: { document_id: number; filename: string; summary: string; core_issues: string[]; questions_of_law: string[]; hearing_points: string[];
    contradictions: { point: string; pages: number[] }[] }[];
  documents: { id: number; filename: string; pages: number }[];
  references: { title: string; citation: string; pages: string; note: string; source_url: string | null }[];
  open_tasks: { title: string; due_date: string | null }[];
}

interface BenchInfo { bench: string; from_listing: boolean; judges: { judge: string; judgments: { id: number; title: string; year: string; citation: string | null; source_url: string | null }[] }[]; note: string }

function BenchCard({ caseId }: { caseId: number }) {
  const [b, setB] = useState<BenchInfo | null>(null);
  useEffect(() => {
    let off = false;
    api<BenchInfo>(`/api/matters/${caseId}/bench`).then((r) => { if (!off) setB(r); }).catch(() => {});
    return () => { off = true; };
  }, [caseId]);
  if (!b || !b.judges.length) return null;
  return (
    <Card title="Bench">
      <p className="text-xs text-ink-2">{b.bench}{b.from_listing && " (from the cause list)"}</p>
      {b.judges.map((j) => (
        <div key={j.judge} className="mt-3">
          <div className="text-sm font-medium text-ink">Justice {j.judge}</div>
          {j.judgments.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {j.judgments.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-2 text-ink-2">
                  <span className="text-ink">{x.title}</span><span className="text-xs">{x.year}{x.citation && ` · ${x.citation}`}</span>
                  {x.source_url && <a href={x.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand dark:text-accent"><ExternalLink className="h-3 w-3" />PDF</a>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted">No related judgment in the library.</p>}
        </div>
      ))}
      <p className="mt-3 text-xs text-muted">{b.note}</p>
    </Card>
  );
}

/** The matter at a glance during the hearing: listing, last note, the record's brief, authorities. */
export function BriefPack({ caseId }: { caseId: number }) {
  const [p, setP] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api<Pack>(`/api/matters/${caseId}/brief-pack`).then((r) => { if (!off) setP(r); }).catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [caseId]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!p || p.case.id !== caseId) return <Spinner />;
  const today = p.listing.find((l) => l.kind === "daily");
  return (
    <div className="space-y-4">
      <Card title={p.case.title}>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
          <span className="font-mono">{p.case.case_number || p.case.case_type}</span>
          {p.case.diary_no && <span>Diary {p.case.diary_no}</span>}<span>{p.case.stage}</span>
          {p.case.next_hearing && <span>Next hearing {fmtDate(p.case.next_hearing)}</span>}
        </div>
        {today && <div className="mt-3"><Alert tone="info"><b>{fmtDate(today.list_date)}</b> · {today.court}{today.item_no && `, item ${today.item_no}`}{today.bench && ` · ${today.bench}`}</Alert></div>}
        {p.last_note && (
          <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
            <div className="text-xs font-medium text-ink-2">Last hearing {fmtDate(p.last_note.hearing_date)}{p.last_note.outcome && ` · ${p.last_note.outcome}`}</div>
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-ink">{p.last_note.notes || "—"}</p>
          </div>
        )}
      </Card>

      <BenchCard caseId={caseId} />

      {p.briefs.map((b) => (
        <Card key={b.document_id} title={<span className="flex items-center gap-2">Brief · {b.filename}<Badge tone="accent">AI · verify</Badge></span>}>
          {b.summary && <p className="text-sm text-ink">{b.summary}</p>}
          <List title="Hearing points" items={b.hearing_points} />
          <List title="Questions of law" items={b.questions_of_law} />
          <List title="Core issues" items={b.core_issues} />
          <List title="Contradictions in the record" items={b.contradictions.map((c) => `${c.point}${c.pages.length ? ` (p. ${c.pages.join(", ")})` : ""}`)} />
        </Card>
      ))}
      {!p.briefs.length && <Card><p className="text-sm text-ink-2">No analysed record on this matter yet. Upload it in Document Intelligence to get a brief.</p></Card>}

      {p.references.length > 0 && (
        <Card title={`Authorities (${p.references.length})`}>
          <ul className="space-y-1.5 text-sm">
            {p.references.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-ink">{r.title || r.citation}</span>
                {r.citation && r.title && <span className="font-mono text-xs text-ink-2">{r.citation}</span>}
                {r.pages && <span className="text-xs text-ink-2">pp. {r.pages}</span>}
                {r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand dark:text-accent"><ExternalLink className="h-3 w-3" />PDF</a>}
                {r.note && <span className="w-full text-xs text-muted">{r.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {p.open_tasks.length > 0 && <Card title="Open tasks"><List items={p.open_tasks.map((t) => `${t.title}${t.due_date ? ` (due ${fmtDate(t.due_date)})` : ""}`)} /></Card>}
    </div>
  );
}

function List({ title, items }: { title?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      {title && <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{title}</div>}
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Running notes during the hearing, typed or dictated, saved to the matter as a hearing note. */
export function LiveNotes({ caseId }: { caseId: number | null }) {
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const append = useCallback((t: string) => setText((x) => (x ? `${x.replace(/\s+$/, "")} ${t}` : t)), []);
  const voice = useDictation(append, lang);

  async function save() {
    if (!caseId) return;
    setSaving(true); setError(null); voice.stop();
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      await api(`/api/matters/${caseId}/hearings`, { method: "POST", json: { hearing_date: day, notes: text, dictated: true } });
      setSaved("Saved as today's hearing note. Add the outcome, next date and follow-up tasks in the matter's Hearings tab.");
      setText("");
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  return (
    <Card title="Hearing notes" actions={
      <div className="flex items-center gap-2">
        <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={voice.listening} aria-label="Dictation language"
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"><option value="en-IN">English</option><option value="hi-IN">हिंदी</option></select>
        <Button variant={voice.listening ? "danger" : "secondary"} onClick={voice.listening ? voice.stop : voice.start}>
          {voice.listening ? <><MicOff className="h-4 w-4" />Stop</> : <><Mic className="h-4 w-4" />Dictate</>}
        </Button>
      </div>}>
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(null); }} className="min-h-40" placeholder="What the Bench said, directions, next date…" />
      {voice.listening && <p className="mt-1 text-xs text-ink-2">{voice.interim || "Listening…"}</p>}
      {voice.error && <div className="mt-2"><Alert tone="bad">{voice.error}</Alert></div>}
      {error && <div className="mt-2"><Alert tone="bad">{error}</Alert></div>}
      {saved && <div className="mt-2"><Alert tone="good">{saved}</Alert></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-md text-xs text-muted">Your own notes. Recording court proceedings needs the Court&apos;s permission; voice typing sends audio to the browser&apos;s speech service.</p>
        <Button onClick={save} loading={saving} disabled={!caseId || !text.trim()} title={caseId ? "" : "Choose the matter first"}><Save className="h-4 w-4" />Save to matter</Button>
      </div>
    </Card>
  );
}

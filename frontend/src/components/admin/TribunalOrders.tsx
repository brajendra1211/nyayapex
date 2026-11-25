"use client";

import { ExternalLink, Landmark, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Input, Label, Select, fmtDate } from "@/components/ui";
import { api, upload } from "@/lib/api";

interface Forum { code: string; name: string; short: string; benches: string[]; binding: boolean; count: number }
interface Order {
  id: number; title: string; forum: string; bench: string | null; case_no: string | null; decision_date: string | null;
  members?: string | null; pages: number; source_url: string | null; created_at: string; check: string[];
}
interface Added { created: boolean; message: string; judgment: Order; check: string[] }

/** Platform admins add NCLT / NCLAT orders (PDF) to the shared library and check the details read from them. */
export function TribunalOrders() {
  const [forums, setForums] = useState<Forum[]>([]);
  const [forum, setForum] = useState("NCLAT");
  const [bench, setBench] = useState("");
  const [list, setList] = useState<{ total: number; items: Order[] } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<Forum[]>("/api/corpus/forums").then(setForums).catch(() => {});
    api<{ total: number; items: Order[] }>(`/api/corpus/tribunal?forum=${forum}&q=${encodeURIComponent(q)}`).then(setList).catch((e) => setError(e.message));
  }, [forum, q]);
  useEffect(() => { load(); }, [load]);

  const benches = forums.find((f) => f.code === forum)?.benches ?? [];

  async function send(files: FileList) {
    setError(null);
    const out: typeof log = [];
    for (const [i, file] of Array.from(files).entries()) {
      setBusy(`Adding ${i + 1} of ${files.length}: ${file.name}`);
      const form = new FormData();
      form.append("file", file);
      form.append("forum", forum);
      if (bench) form.append("bench", bench);
      try {
        const r = await upload<Added>("/api/corpus/tribunal", form);
        out.push({ name: file.name, ok: true, text: `${r.message}${r.check.length ? ` Check: ${r.check.join(", ")}.` : ""}` });
      } catch (e) { out.push({ name: file.name, ok: false, text: (e as Error).message }); }
      setLog([...out]);
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    load();
  }

  return (
    <Card className="mt-6" title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-accent-ink" />Tribunal orders (NCLT / NCLAT)</span>}
      actions={<span className="text-xs text-muted">{forums.filter((f) => f.code !== "SC").map((f) => `${f.short}: ${f.count}`).join(" · ")}</span>}>
      <p className="text-sm text-ink-2">
        Add orders as text PDFs downloaded from nclat.nic.in or nclt.gov.in. Case number, parties, date and coram are read from the order:
        check the ones flagged. Both tribunals allow reproduction if it is accurate and the source is acknowledged; every order shows its source.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div><Label>Tribunal</Label>
          <Select value={forum} onChange={(e) => { setForum(e.target.value); setBench(""); }}>
            <option value="NCLAT">NCLAT</option><option value="NCLT">NCLT</option>
          </Select></div>
        <div><Label hint="applies to all files in this upload">Bench</Label>
          <Select value={bench} onChange={(e) => setBench(e.target.value)}>
            <option value="">Not specified</option>{benches.map((b) => <option key={b}>{b}</option>)}
          </Select></div>
        <Button onClick={() => input.current?.click()} loading={!!busy}><Upload className="h-4 w-4" />Add PDFs</Button>
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => e.target.files?.length && send(e.target.files)} />
      </div>
      {busy && <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p>}
      {log.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {log.map((l, i) => <li key={i} className={l.ok ? "text-ink-2" : "text-bad-ink"}><b>{l.name}</b>: {l.text}</li>)}
        </ul>
      )}
      {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}

      <div className="mt-6 flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${forum} orders by parties or case number`} />
      </div>
      <div className="mt-3">
        {!list ? null : list.items.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.items.map((o) => <OrderRow key={o.id} o={o} benches={benches} onChanged={load} />)}
          </ul>
        ) : <Empty icon={Landmark} title={`No ${forum} orders yet`}>Add PDFs above; they become searchable in Legal Research right away.</Empty>}
        {list && list.total > list.items.length && <p className="mt-2 text-xs text-muted">Showing the latest {list.items.length} of {list.total}.</p>}
      </div>
    </Card>
  );
}

function OrderRow({ o, benches, onChanged }: { o: Order; benches: string[]; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: o.title ?? "", case_no: o.case_no ?? "", decision_date: o.decision_date ?? "", bench: o.bench ?? "" });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api(`/api/corpus/tribunal/${o.id}`, { method: "PATCH", json: { ...f, bench: f.bench || null, decision_date: f.decision_date || null } });
      setEdit(false); onChanged();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove() {
    if (!confirm(`Remove "${o.title}" from the library?`)) return;
    try { await api(`/api/corpus/tribunal/${o.id}`, { method: "DELETE" }); onChanged(); } catch (e) { alert((e as Error).message); }
  }

  return (
    <li className="px-4 py-3">
      {edit ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Parties</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="A Ltd. v. B Bank Ltd." /></div>
            <div><Label>Case number</Label><Input value={f.case_no} onChange={(e) => setF({ ...f, case_no: e.target.value })} className="font-mono" /></div>
            <div><Label>Date of order</Label><Input type="date" value={f.decision_date} onChange={(e) => setF({ ...f, decision_date: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Bench</Label>
              <Select value={f.bench} onChange={(e) => setF({ ...f, bench: e.target.value })}><option value="">Not specified</option>{benches.map((b) => <option key={b}>{b}</option>)}</Select></div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}
          <div className="flex gap-2"><Button onClick={save}>Save</Button><Button variant="secondary" onClick={() => setEdit(false)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">{o.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
              {o.case_no && <span className="font-mono">{o.case_no}</span>}
              {o.decision_date && <span>{fmtDate(o.decision_date)}</span>}
              {o.bench && <span>{o.bench}</span>}
              <span>{o.pages} pages</span>
            </div>
            {o.check.length > 0 && <div className="mt-1"><Badge tone="warn">Check: {o.check.join(", ")}</Badge></div>}
          </div>
          {o.source_url && <a href={o.source_url} target="_blank" rel="noopener noreferrer" title="Open the order" className="rounded p-1 text-muted hover:text-ink"><ExternalLink className="h-4 w-4" /></a>}
          <button onClick={() => setEdit(true)} title="Edit details" className="rounded p-1 text-muted hover:text-ink"><Pencil className="h-4 w-4" /></button>
          <button onClick={remove} title="Remove" className="rounded p-1 text-muted hover:text-bad-ink"><Trash2 className="h-4 w-4" /></button>
        </div>
      )}
    </li>
  );
}

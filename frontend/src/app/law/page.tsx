"use client";

import clsx from "clsx";
import { ArrowRightLeft, BookOpen, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AiText, LangToggle, type Lang } from "@/components/personal/kit";
import { CODE_LABEL, Provision, provisionName, type Correspondence, type ProvisionData } from "@/components/Provision";
import { ReportAI } from "@/components/ReportAI";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NAV_SEARCH_EVENT, useQueryParam } from "@/lib/hooks";

interface StatuteRow {
  code: string; title: string; act: string; available: boolean; sections: number; version: string | null;
  source_name: string | null; mapped_to_new: number; replaced_by?: string; replaces?: string;
}
interface Contents { code: string; title: string; version: string; sections: { number: string; title: string; chapter: string; chapter_title: string }[] }
interface SearchRes { references: ProvisionData[]; results: { code: string; number: string; title: string; snippet: string; chapter_title: string }[]; notes?: string[] }

function go(code: string, s?: string | null) {
  const qs = new URLSearchParams({ code, ...(s ? { s } : {}) });
  window.history.pushState(null, "", `/law?${qs}`);
  window.dispatchEvent(new Event(NAV_SEARCH_EVENT));
}

export default function LawPage() {
  const code = (useQueryParam("code") ?? "BNS").toUpperCase();
  const sec = useQueryParam("s");
  const [statutes, setStatutes] = useState<StatuteRow[] | null>(null);
  const [contents, setContents] = useState<Contents | null>(null);
  const [provision, setProvision] = useState<ProvisionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchRes | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => { api<StatuteRow[]>("/api/law/statutes").then(setStatutes).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    let off = false;
    api<Contents>(`/api/law/${code}/sections`).then((c) => { if (!off) setContents(c); }).catch(() => { if (!off) setContents(null); });
    return () => { off = true; };
  }, [code]);
  useEffect(() => {
    if (!sec) return;
    let off = false;
    api<ProvisionData>(`/api/law/${code}/${encodeURIComponent(sec)}`)
      .then((p) => { if (!off) { setProvision(p); setError(null); } })
      .catch((e) => { if (!off) { setProvision(null); setError(e.message); } });
    return () => { off = true; };
  }, [code, sec]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await api<SearchRes>(`/api/law/search?q=${encodeURIComponent(q)}`);
      setRes(r);
      if (r.references.length === 1) go(r.references[0].code, r.references[0].number);
    } catch (err) { setError((err as Error).message); }
    setSearching(false);
  }

  const current = statutes?.find((s) => s.code === code);
  const shown = (contents?.sections ?? []).filter((s) => !filter || `${s.number} ${s.title}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <PageHeader title="Bare Acts" subtitle="The text of the law, word for word from the official Gazette copy, with IPC↔BNS correspondence and the judgments that discuss each provision. Search by section or words, in English or Hindi, or ask AI which section fits." />

      <Card className="mb-5">
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="302 IPC · BNSS 482 · 420 · anticipatory bail · चोरी · electronic record" className="text-base" />
          <Button type="submit" loading={searching}><Search className="h-4 w-4" />Find</Button>
        </form>
        <Converter />
        {res && (
          <div className="mt-4 space-y-3">
            {res.notes?.map((n) => <p key={n} className="text-xs text-ink-2">{n}</p>)}
            {res.references.map((p) => <Provision key={`${p.code}${p.number}`} p={p} compact />)}
            {res.results.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {res.results.map((r) => (
                  <li key={`${r.code}${r.number}`}>
                    <button onClick={() => go(r.code, r.number)} className="w-full px-3 py-2 text-left hover:bg-surface-2">
                      <div className="text-sm"><span className="font-mono font-semibold text-ink">{provisionName(r.code, r.number)}</span> <span className="text-ink">{r.title}</span></div>
                      <div className="line-clamp-1 text-xs text-ink-2">{r.snippet}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!res.references.length && !res.results.length && !res.notes?.length && <p className="text-sm text-muted">Nothing found. Try another word, or the section number with the act (e.g. 302 IPC).</p>}
          </div>
        )}
      </Card>

      <AskAi />

      <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
        <div className="space-y-4">
          <Card pad={false}>
            <ul className="divide-y divide-line">
              {(statutes ?? []).map((s) => (
                <li key={s.code}>
                  <button onClick={() => go(s.code)} className={clsx("w-full px-4 py-2.5 text-left hover:bg-surface-2", s.code === code && "bg-surface-2")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{s.title}</span>
                      {s.available ? <Badge tone="good">{s.sections}</Badge> : s.mapped_to_new ? <Badge>map only</Badge> : <Badge tone="warn">add PDF</Badge>}
                    </div>
                    <div className="text-xs text-muted">{s.act}{s.replaced_by ? ` · replaced by ${CODE_LABEL[s.replaced_by]}` : ""}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {contents && (
            <Card pad={false} title={`${CODE_LABEL[code] ?? code} - contents`}>
              <div className="border-b border-line p-2"><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter sections…" /></div>
              <ul className="max-h-[32rem] overflow-y-auto py-1 text-sm">
                {shown.map((s, i) => {
                  const head = !filter && (i === 0 || shown[i - 1].chapter !== s.chapter) ? s : null;
                  return (
                    <li key={s.number}>
                      {head && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Ch. {head.chapter} {head.chapter_title}</div>}
                      <button onClick={() => go(code, s.number)} className={clsx("flex w-full gap-2 px-3 py-1 text-left hover:bg-surface-2", s.number === sec && "bg-accent-soft")}>
                        <span className="w-10 shrink-0 font-mono text-xs text-ink-2">{s.number}</span>
                        <span className="text-ink">{s.title || "—"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div>
          {error && sec && <Alert tone="bad">{error}</Alert>}
          {!statutes && <Spinner />}
          {sec && provision ? <Provision key={`${provision.code}${provision.number}`} p={provision} />
            : current && !current.available ? (
              <Card>
                <Empty icon={BookOpen} title={`${current.title} is not in the library yet`}>
                  {current.mapped_to_new ? "Its correspondence to the new Sanhita is available - search a section above (e.g. “302 IPC”). " : ""}
                  To add the full text, download the official PDF from India Code (indiacode.nic.in) in a browser, save it as
                  backend/data/statutes/raw/{current.code}.pdf and run <code>python -m app.import_statutes</code>.
                </Empty>
              </Card>
            ) : (
              <Card><Empty icon={BookOpen} title="Pick a section">Choose from the contents, or search above. {current?.version}</Empty></Card>
            )}
        </div>
      </div>
    </>
  );
}

/** IPC 302 -> BNS 103 (and back), from the official correspondence. */
function Converter() {
  const [from, setFrom] = useState("IPC");
  const [num, setNum] = useState("");
  const [out, setOut] = useState<Correspondence[] | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!num.trim()) return;
    setOut(await api<Correspondence[]>(`/api/law/convert?code=${from}&section=${encodeURIComponent(num.trim())}`).catch(() => []));
  }
  return (
    <form onSubmit={run} className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
      <ArrowRightLeft className="h-4 w-4 text-muted" /><span className="text-ink-2">Old ↔ new:</span>
      <Select value={from} onChange={(e) => { setFrom(e.target.value); setOut(null); }} className="w-28">
        {["IPC", "BNS", "CRPC", "BNSS", "IEA", "BSA"].map((c) => <option key={c} value={c}>{CODE_LABEL[c]}</option>)}
      </Select>
      <Input value={num} onChange={(e) => { setNum(e.target.value); setOut(null); }} placeholder="Section e.g. 420" className="w-36" />
      <Button type="submit" variant="secondary">Convert</Button>
      {out && (out.length ? out.map((c, i) => c.relation === "deleted"
        ? <Badge key={i} tone="warn">Deleted - no counterpart</Badge>
        : <button key={i} type="button" onClick={() => go(c.code, c.section)} title={c.source}
          className="rounded-md border border-line px-2 py-0.5 hover:border-brand/50">
          <span className="font-mono font-medium text-ink">{provisionName(c.code, c.ref || c.section || "")}</span>
          {c.title && <span className="ml-1 text-ink-2">{c.title}</span>}{!c.official && <span className="ml-1 text-warn-ink">· verify</span>}
        </button>) : <span className="text-muted">No correspondence found.</span>)}
    </form>
  );
}

interface AskRes { answer: string | null; sections: { code: string; number: string; title: string }[]; ai_log_id?: number; note?: string; disclaimer?: string }

const ASK_EXAMPLES = ["Someone snatched my phone and threatened me", "Police refused to register my complaint", "किसी ने धोखे से पैसे ले लिए",
  "Husband's family harasses wife for dowry", "Is a WhatsApp chat valid evidence?"];

/** "Which section applies?" - AI chooses among sections the library search found, and links each to its text. */
function AskAi() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [lang, setLang] = useState<Lang>(user?.language === "hi" ? "hi" : "en");
  const [res, setRes] = useState<AskRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text = q, l = lang) {
    if (text.trim().length < 4) return;
    setLoading(true); setError(null); setRes(null);
    try { setRes(await api<AskRes>("/api/law/ask", { method: "POST", json: { question: text.trim(), lang: l } })); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  return (
    <Card className="mb-6" title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent-ink" />Not sure which section? Ask AI</span>}
      actions={<LangToggle value={lang} onChange={(l) => { setLang(l); if (res) ask(q, l); }} />}>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="space-y-3">
        <Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe the situation in your own words, in English or Hindi"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {!res && ASK_EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => { setQ(x); ask(x); }} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand/40 hover:text-ink">{x}</button>
            ))}
          </div>
          <Button type="submit" loading={loading} disabled={q.trim().length < 4}><Sparkles className="h-4 w-4" />Find sections</Button>
        </div>
      </form>
      {loading && <Spinner label={lang === "hi" ? "धाराएँ खोज रहे हैं…" : "Reading the bare acts…"} />}
      {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
      {res && !loading && (
        <div className="mt-5 border-t border-line pt-4">
          {res.note && <p className="text-sm text-ink-2">{res.note}</p>}
          {res.answer && (
            <>
              <div className="mb-3"><Badge tone="accent"><Sparkles className="h-3 w-3" />AI suggestion · read each section</Badge></div>
              <AiText text={res.answer} />
              {res.sections.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {res.sections.map((x) => (
                    <button key={`${x.code}${x.number}`} onClick={() => { go(x.code, x.number); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-xs hover:border-brand/40">
                      <span className="font-mono font-semibold text-ink">{provisionName(x.code, x.number)}</span> <span className="text-ink-2">{x.title}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>{res.disclaimer}</span>
                <ReportAI feature="law_ask" excerpt={res.answer} context={{ question: q }} logId={res.ai_log_id} />
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

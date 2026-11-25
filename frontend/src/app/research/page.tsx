"use client";

import { BookMarked, ExternalLink, FileSearch, Library as LibraryIcon, Link2, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AiLabel, Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, fmtDate } from "@/components/ui";
import { api, type CorpusStats, type Judgment, type Source } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";
import { Provision, type ProvisionData } from "@/components/Provision";
import { ReportAI } from "@/components/ReportAI";
import { SaveToMatter } from "@/components/SaveToMatter";

type ResearchRes = {
  answer: string | null; sources: Source[]; statutes?: ProvisionData[]; terms?: string[]; also_searched?: string[]; cost_usd?: number | null;
  ai_log_id?: number | null; filters_applied?: boolean;
};
type Validity = { status: "Good Law" | "Overruled" | "Distinguished" | "Doubtful" | "Mixed" | "Unverified"; cited_by: number; citation: string | null;
  strength: string; treatments?: Record<string, number> };
const NO_FILTERS = { year_from: "", year_to: "", judge: "", party: "", provision: "", forum: "", sort: "relevance" };
const DEFAULT_RESULTS = 5;
const MORE_STEP = 10;
const MAX_RESULTS = 30;
const VALIDITY_TONE = { "Good Law": "good", Overruled: "bad", Doubtful: "warn", Mixed: "warn", Distinguished: "warn", Unverified: "neutral" } as const;
const TREAT_WORD: Record<string, string> = { "Good Law": "followed", Distinguished: "distinguished", Doubtful: "doubted", Overruled: "overruled" };
const treatLine = (t?: Record<string, number>) => Object.entries(t ?? {}).map(([k, n]) => `${TREAT_WORD[k] ?? k} ${n}`).join(", ");
const PERIODS: [string, string, string][] = [["2020 onwards", "2020", ""], ["2015 onwards", "2015", ""], ["2000–2014", "2000", "2014"], ["Before 2000", "", "1999"]];

/** The searched words in bold, so a lawyer sees at once why this passage came up. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const rx = new RegExp(`(${terms.join("|")})`, "gi"); // terms are plain a-z and 0-9 words
  return <>{text.split(rx).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-accent-soft px-0.5 font-medium text-ink">{part}</mark> : part))}</>;
}
const USD_INR = 88; // approximate, display only

const EXAMPLES = [
  "Can delay in filing an SLP be condoned when the certified copy was received late?",
  "Is a pre-deposit mandatory for an appeal under Section 18 of the SARFAESI Act?",
  "When can the Supreme Court interfere with concurrent findings of fact?",
];

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);
  const [ai, setAi] = useState(true);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ResearchRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [f, setF] = useState(NO_FILTERS);
  const [limit, setLimit] = useState(DEFAULT_RESULTS);
  const [moreLoading, setMoreLoading] = useState(false);
  const [validity, setValidity] = useState<Record<number, Validity>>({});
  const activeFilters = Object.entries(f).filter(([k, v]) => k !== "sort" && v.trim()).length;

  const filterBody = () => ({
    year_from: f.year_from ? Number(f.year_from) : null, year_to: f.year_to ? Number(f.year_to) : null,
    judge: f.judge, party: f.party, provision: f.provision, forum: f.forum, sort: f.sort,
  });

  function loadValidity(sources: Source[]) {
    const ids = [...new Set(sources.filter((s) => s.library === "public").map((s) => s.document_id))].filter((id) => !validity[id]);
    if (!ids.length) return;
    api<Record<number, Validity>>("/api/research/validity", { method: "POST", json: { document_ids: ids } })
      .then((v) => setValidity((old) => ({ ...old, ...v }))).catch(() => {});
  }

  async function run(q = query) {
    if (!q.trim()) return;
    setLoading(true); setError(null); setLimit(DEFAULT_RESULTS);
    try {
      const r = await api<ResearchRes>("/api/research", { method: "POST", json: { query: q, deep, ai, ...filterBody() } });
      setRes(r); loadValidity(r.sources);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  /** More references only: the AI explanation already shown is kept, so this costs nothing. */
  async function more() {
    const next = Math.min(limit + MORE_STEP, MAX_RESULTS);
    setMoreLoading(true);
    try {
      const r = await api<ResearchRes>("/api/research", { method: "POST", json: { query, ai: false, ...filterBody(), limit: next } });
      setRes((old) => (old ? { ...old, sources: r.sources } : r)); setLimit(next); loadValidity(r.sources);
    } catch (e) { setError((e as Error).message); }
    setMoreLoading(false);
  }

  // Query arriving from the top-bar search (?q=…)
  const urlQ = useQueryParam("q");
  const [seenQ, setSeenQ] = useState<string | null>(null);
  if (urlQ && urlQ !== seenQ) {
    setSeenQ(urlQ);
    setQuery(urlQ);
    setLoading(true);
    setError(null);
  }
  useEffect(() => {
    if (!urlQ) return;
    let cancelled = false;
    api<ResearchRes>("/api/research", { method: "POST", json: { query: urlQ, deep: false, ai: true } })
      .then((r) => { if (!cancelled) { setRes(r); setLimit(DEFAULT_RESULTS); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [urlQ]);

  return (
    <>
      <PageHeader title="Legal Research" subtitle='Ask in plain English or Hindi. Put words in "double quotes" for an exact phrase. Searches Supreme Court judgments, NCLT / NCLAT orders added to the library, and your own documents; answers cite only what they find.' />

      <Card>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} className="py-2.5 pl-9" placeholder="What is your research question?" />
          </div>
          <Button type="button" variant="secondary" onClick={() => setShowFilters((s) => !s)} className="py-2.5" aria-expanded={showFilters}>
            <SlidersHorizontal className="h-4 w-4" />Filters{activeFilters > 0 && <Badge tone="brand">{activeFilters}</Badge>}
          </Button>
          <Button type="submit" loading={loading} disabled={!query.trim()} className="py-2.5">Research</Button>
        </form>
        {showFilters && (
          <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-ink-2">Period</span>
              {PERIODS.map(([label, from, to]) => (
                <button key={label} type="button" onClick={() => setF({ ...f, year_from: from, year_to: to })}
                  className={f.year_from === from && f.year_to === to ? "rounded-full border border-brand bg-surface px-3 py-1 text-xs font-medium text-ink" : "rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 hover:border-brand/40"}>{label}</button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div><Label>From year</Label><Input inputMode="numeric" value={f.year_from} onChange={(e) => setF({ ...f, year_from: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1950" /></div>
              <div><Label>To year</Label><Input inputMode="numeric" value={f.year_to} onChange={(e) => setF({ ...f, year_to: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="2026" /></div>
              <div className="lg:col-span-2"><Label hint="old and new law together">Section / Article</Label><Input value={f.provision} onChange={(e) => setF({ ...f, provision: e.target.value })} placeholder="302 IPC, BNS 103, Article 21" /></div>
              <div className="lg:col-span-2"><Label>Sort by</Label>
                <Select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
                  <option value="relevance">Most relevant</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                </Select></div>
              <div className="lg:col-span-2"><Label>Court / tribunal</Label>
                <Select value={f.forum} onChange={(e) => setF({ ...f, forum: e.target.value })}>
                  <option value="">All</option><option value="SC">Supreme Court</option><option value="NCLAT">NCLAT</option><option value="NCLT">NCLT</option>
                </Select></div>
              <div className="lg:col-span-2"><Label>Judge / bench</Label><Input value={f.judge} onChange={(e) => setF({ ...f, judge: e.target.value })} placeholder="Chandrachud" /></div>
              <div className="lg:col-span-2"><Label>Party name</Label><Input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} placeholder="Union of India" /></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>Period, judge and party filters cover library judgments only, not your uploaded documents. Judgments before 2015 are found by keywords and citations, so use their wording.</span>
              {(activeFilters > 0 || f.sort !== "relevance") && <Button type="button" variant="ghost" onClick={() => setF(NO_FILTERS)}><X className="h-4 w-4" />Clear filters</Button>}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="accent-[var(--brand)]" />AI explanation <span className="text-muted">(≈ ₹0.1–0.2 / question)</span></label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={deep} disabled={!ai} onChange={(e) => setDeep(e.target.checked)} className="accent-[var(--brand)]" />Deep analysis <span className="text-muted">(≈ ₹2–4 / question)</span></label>
          <span className="text-muted">Search is free and local (keywords + meaning, works in Hindi too); only the explanation uses AI.</span>
        </div>
        {!res && (
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => { setQuery(x); run(x); }} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-brand/40 hover:text-ink">{x}</button>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-6 space-y-6">
        {error && <Alert tone="bad">{error}</Alert>}
        {res && !res.sources.length && (
          <Card><Empty icon={FileSearch} title="No matching judgments found">
            {res.filters_applied ? "Try removing a filter or widening the period." : "Try different words, or import the judgment you have in mind using its e-SCR link below."}
          </Empty></Card>
        )}
        {!!res?.statutes?.length && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">The law - bare text</div>
            {res.statutes.map((p) => <Provision key={`${p.code}${p.number}`} p={p} compact />)}
          </div>
        )}
        {res?.answer && (
          <Card title="Analysis" actions={<span className="flex items-center gap-2">{res.cost_usd != null && <Badge tone={res.cost_usd === 0 ? "good" : "neutral"}>{res.cost_usd === 0 ? "from cache · free" : `cost $${res.cost_usd.toFixed(4)} ≈ ₹${(res.cost_usd * USD_INR).toFixed(2)}`}</Badge>}<AiLabel /></span>}>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{res.answer}</div>
            <div className="mt-4 border-t border-line pt-3"><ReportAI feature="research" excerpt={res.answer} context={{ query }} logId={res.ai_log_id} /></div>
          </Card>
        )}
        {res && !!res.also_searched?.length && (
          <p className="text-xs text-ink-2">Also searched in English: {res.also_searched.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}</p>
        )}
        {res && res.sources.length > 0 && (
          <Card title={`Ranked sources (${res.sources.length})`} pad={false}>
            <ol className="divide-y divide-line">
              {res.sources.map((s, i) => (
                <li key={i} className="flex gap-4 px-5 py-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookMarked className="h-4 w-4 text-muted" />
                      <span className="font-medium text-ink">{s.document}</span>
                      {s.library !== "public" ? <Badge>Your document</Badge>
                        : s.forum && s.forum !== "SC" ? <Badge tone="accent">{s.forum}{s.bench ? ` · ${s.bench}` : ""}</Badge>
                        : <Badge tone="brand">Supreme Court</Badge>}
                      {validity[s.document_id] && (
                        <Link href={`/precedent?q=${encodeURIComponent(validity[s.document_id].citation ?? s.document)}`}
                          title={`Worked out from the words later judgments in the library use next to this one (${treatLine(validity[s.document_id].treatments) || "none found"}). Read them before relying on it.`}>
                          <Badge tone={VALIDITY_TONE[validity[s.document_id].status]}>{validity[s.document_id].status === "Unverified" ? "Status not verified"
                            : validity[s.document_id].status === "Mixed" ? "Mixed treatment · verify" : `${validity[s.document_id].status} · verify`}</Badge>
                        </Link>
                      )}
                      {validity[s.document_id]?.cited_by > 0 && <Link href={`/precedent?doc=${s.document_id}`} className="text-xs text-brand hover:underline dark:text-accent">cited in {validity[s.document_id].cited_by} {validity[s.document_id].cited_by === 1 ? "judgment" : "judgments"} · graph</Link>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                      {s.case_no && <span className="font-mono">{s.case_no}</span>}
                      {s.neutral_citation && <span className="font-mono">{s.neutral_citation}</span>}
                      {s.scr_citation && <span className="font-mono">{s.scr_citation}</span>}
                      {s.decision_date && <span>{fmtDate(s.decision_date)}</span>}
                      <span>pp. {s.pages[0]}–{s.pages[1]}</span>
                      {s.judges && <span className="max-w-72 truncate" title={s.judges}>{s.judges}</span>}
                      {s.source_url && (
                        <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline dark:text-accent">
                          <ExternalLink className="h-3 w-3" />Original PDF
                        </a>
                      )}
                      {s.matched_by?.map((m) => (
                        <Badge key={m} tone={m === "meaning" ? "accent" : m === "citation" || m === "name" ? "good" : "neutral"}>{m === "name" ? "case name" : m} match</Badge>
                      ))}
                    </div>
                    {s.binding_note && <p className="mt-1 text-xs text-warn-ink">{s.binding_note}</p>}
                    {s.arising_from && <p className="mt-0.5 text-xs text-ink-2">Appeal from: {s.arising_from}</p>}
                    <p className="mt-1.5 line-clamp-4 text-sm text-ink-2"><Highlighted text={s.snippet} terms={res.terms ?? []} /></p>
                    <div className="mt-2"><SaveToMatter documentId={s.document_id} citation={s.neutral_citation ?? s.scr_citation} title={s.document} pages={`${s.pages[0]}-${s.pages[1]}`} /></div>
                    {s.citations.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">{s.citations.map((c) => <Badge key={c} tone="brand">{c}</Badge>)}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {res.sources.length >= limit && limit < MAX_RESULTS && (
              <div className="border-t border-line p-3 text-center">
                <Button variant="secondary" onClick={more} loading={moreLoading}>Show more results</Button>
              </div>
            )}
          </Card>
        )}

        <JudgmentLibrary />
      </div>
    </>
  );
}

function JudgmentLibrary() {
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);

  const load = () => api<CorpusStats>("/api/corpus/stats").then(setStats).catch(() => {});
  useEffect(() => { load(); }, []);

  async function importUrl() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ created: boolean; message: string; judgment: Judgment }>("/api/corpus/import-url", { method: "POST", json: { url: url.trim() } });
      setMsg({ tone: r.created ? "good" : "info", text: `${r.message} ${r.judgment.title}${r.judgment.neutral_citation ? ` (${r.judgment.neutral_citation})` : ""}` });
      setUrl("");
      load();
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <Card title={<span className="flex items-center gap-2"><LibraryIcon className="h-4 w-4 text-muted" />Supreme Court judgment library</span>}
        actions={stats && <Badge tone="brand">{stats.judgments.toLocaleString("en-IN")} judgments</Badge>}>
        {stats?.recent.length ? (
          <ul className="space-y-2 text-sm">
            {stats.recent.map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">{j.title}</span>
                <span className="font-mono text-xs text-muted">{j.neutral_citation ?? j.scr_citation}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">The library is being built. Imported judgments appear here.</p>}
        {stats && <p className="mt-4 text-xs text-muted">{stats.attribution}</p>}
      </Card>
      <Card title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted" />Import a judgment by link</span>}>
        <p className="mb-3 text-sm text-ink-2">
          Found a judgment on <a href="https://scr.sci.gov.in/scrsearch/" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline dark:text-accent">e-SCR</a> that
          isn&apos;t here yet? Paste its PDF link — it&apos;s added to the shared library for everyone.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) importUrl(); }} className="space-y-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://scr.sci.gov.in/…/….pdf" />
          <Button type="submit" className="w-full" loading={busy} disabled={!url.trim()}>Import</Button>
        </form>
        {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        <p className="mt-3 text-xs text-muted">e-SCR PDF links are temporary — import soon after you copy one.</p>
      </Card>
    </div>
  );
}

"use client";

import { ExternalLink, MessageCircleQuestionMark, Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiText, LangToggle, NotAdvice, type Lang } from "@/components/personal/kit";
import { Provision, type ProvisionData } from "@/components/Provision";
import { ReportAI } from "@/components/ReportAI";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, Textarea, fmtDate } from "@/components/ui";
import { api, type Source } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

interface Answer { answer: string | null; sources: Source[]; statutes?: ProvisionData[]; also_searched?: string[]; ai_log_id?: number }

const EXAMPLES = [
  "What is anticipatory bail and when can it be given?",
  "Police are not registering my FIR. What does the law say?",
  "What happens if a cheque bounces?",
  "Can a daughter claim a share in her father's property?",
  "पत्नी को भरण-पोषण (maintenance) कब मिलता है?",
  "किरायेदार को घर खाली कराने का कानून क्या है?",
];

export default function AskPage() {
  const { user } = useAuth();
  const fromUrl = useQueryParam("q");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState<Lang>(user?.language === "hi" ? "hi" : "en");
  const [res, setRes] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef<string | null>(null);

  async function ask(question: string, l: Lang = lang) {
    const text = question.trim();
    if (text.length < 4) return;
    setLoading(true); setError(null); setRes(null); setAsked(text);
    try { setRes(await api<Answer>("/api/research", { method: "POST", json: { query: text, lang: l, ai: true, limit: 6 } })); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  useEffect(() => {
    if (fromUrl && ran.current !== fromUrl) { ran.current = fromUrl; setQ(fromUrl); ask(fromUrl); }
  }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Ask about the law"
        subtitle="Ask in simple English or Hindi. The answer explains the law in plain words and shows the sections and Supreme Court judgments it comes from." />

      <Card className="mb-6">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} placeholder="e.g. What are my rights if I am arrested?"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-ink-2">Answer in <LangToggle value={lang} onChange={(l) => { setLang(l); if (asked) ask(asked, l); }} /></div>
            <Button type="submit" loading={loading} disabled={q.trim().length < 4}><Search className="h-4 w-4" />Ask</Button>
          </div>
        </form>
        {!res && !loading && (
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => { setQ(x); ask(x); }} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-brand/40 hover:text-ink">{x}</button>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted">Don&apos;t type names, phone numbers or other private details here; describe the situation in general words.</p>
      </Card>

      {loading && <Spinner label={lang === "hi" ? "कानून और फ़ैसले खोज रहे हैं…" : "Looking up the law and court judgments…"} />}
      {error && <Alert tone="bad">{error}</Alert>}

      {res && !loading && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title={<span className="flex items-center gap-2">Answer <Badge tone="accent"><Sparkles className="h-3 w-3" />AI · check the sources</Badge></span>}>
              {res.answer ? <AiText text={res.answer} /> : (
                <Empty icon={MessageCircleQuestionMark} title="No clear answer found">
                  Try asking in other words, or name the law (for example “Section 498A” or “cheque bounce”).
                </Empty>
              )}
              {res.answer && <div className="mt-4 border-t border-line pt-3"><ReportAI feature="research" excerpt={res.answer} context={{ query: asked }} logId={res.ai_log_id} /></div>}
            </Card>
            <NotAdvice />
          </div>
          <div className="space-y-4">
            {!!res.statutes?.length && (
              <Card title="The law (bare text)">
                <div className="space-y-3">{res.statutes.map((p) => <Provision key={`${p.code}${p.number}`} p={p} compact />)}</div>
              </Card>
            )}
            {res.sources.length > 0 && (
              <Card title="Court judgments used" pad={false}>
                <ul className="divide-y divide-line">
                  {res.sources.map((s) => (
                    <li key={s.document_id} className="px-4 py-3">
                      <div className="text-sm font-medium text-ink">{s.document}</div>
                      <div className="mt-0.5 text-xs text-muted">{[s.neutral_citation || s.scr_citation, s.decision_date && fmtDate(s.decision_date)].filter(Boolean).join(" · ")}</div>
                      {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline dark:text-accent"><ExternalLink className="h-3 w-3" />Read the judgment</a>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {!!res.also_searched?.length && <p className="text-xs text-muted">Also searched: {res.also_searched.join(", ")}</p>}
          </div>
        </div>
      )}
    </>
  );
}

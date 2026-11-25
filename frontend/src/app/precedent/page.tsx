"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, HelpCircle, Scale, Split, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { CitationGraph } from "@/components/CitationGraph";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";

interface Result {
  query: string;
  citation: { citation: string; reporter: string; case_name: string } | null;
  status: "Good Law" | "Overruled" | "Distinguished" | "Doubtful" | "Unverified";
  strength: string;
  citing_documents: number;
  treatments: { status: string; document_id: number; page: number; context: string }[];
  risk: string | null;
  note: string;
}

const META = {
  "Good Law": { icon: CheckCircle2, ink: "text-good-ink", ring: "border-good/50" },
  "Overruled": { icon: XCircle, ink: "text-bad-ink", ring: "border-bad/60" },
  "Distinguished": { icon: Split, ink: "text-ink", ring: "border-line" },
  "Doubtful": { icon: AlertTriangle, ink: "text-warn-ink", ring: "border-warn/60" },
  "Unverified": { icon: HelpCircle, ink: "text-ink-2", ring: "border-line" },
};

export default function PrecedentPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(query = q) {
    setLoading(true); setError(null);
    try { setRes(await api<Result>("/api/precedent", { method: "POST", json: { query } })); }
    catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  const urlQ = useQueryParam("q");
  const [seenQ, setSeenQ] = useState<string | null>(null);
  if (urlQ && urlQ !== seenQ) { setSeenQ(urlQ); setQ(urlQ); setLoading(true); }
  useEffect(() => {
    if (!urlQ) return;
    let cancelled = false;
    api<Result>("/api/precedent", { method: "POST", json: { query: urlQ } })
      .then((r) => { if (!cancelled) setRes(r); }).catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [urlQ]);

  const m = res ? META[res.status] : null;
  const docParam = useQueryParam("doc");
  const [graphDoc, setGraphDoc] = useState<number | null>(null);
  const shownDoc = graphDoc ?? (docParam ? Number(docParam) : null);

  return (
    <>
      <PageHeader title="Precedent Validator" subtitle="Is this judgment still good law? Checks subsequent treatment across your library — zero AI tokens." />
      {shownDoc && <div className="mb-6"><CitationGraph docId={shownDoc} onOpen={(n) => setGraphDoc(n.id)} /></div>}
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) check(q); }} className="flex flex-col gap-2 sm:flex-row">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="(2017) 10 SCC 1   ·   AIR 1973 SC 1461   ·   MANU/SC/0445/1973" className="py-2.5 font-mono" />
          <Button type="submit" loading={loading} disabled={!q.trim()}>Validate</Button>
        </form>
      </Card>

      <div className="mt-6 space-y-6">
        {error && <Alert tone="bad">{error}</Alert>}
        {res && m && (
          <>
            <div className={clsx("rounded-xl border-2 bg-surface p-5", m.ring)}>
              <div className="flex flex-wrap items-center gap-4">
                <m.icon className={clsx("h-10 w-10", m.ink)} />
                <div className="flex-1">
                  <div className={clsx("text-2xl font-semibold", m.ink)}>{res.status}</div>
                  <div className="font-mono text-sm text-ink-2">{res.citation?.citation ?? res.query}{res.citation?.case_name ? ` — ${res.citation.case_name}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">Citation strength</div>
                  <div className="font-medium text-ink">{res.strength}</div>
                  <div className="text-xs text-muted">{res.citing_documents} citing document(s)</div>
                </div>
              </div>
              {res.risk && <div className="mt-4"><Alert tone={res.status === "Overruled" ? "bad" : "warn"}>{res.risk}</Alert></div>}
            </div>

            <Card title="Subsequent treatment" pad={false}>
              {res.treatments.length ? (
                <ul className="divide-y divide-line">
                  {res.treatments.map((t, i) => (
                    <li key={i} className="px-5 py-4">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge tone={t.status === "Overruled" ? "bad" : t.status === "Doubtful" ? "warn" : t.status === "Good Law" ? "good" : "neutral"}>{t.status}</Badge>
                        <span className="text-xs text-muted">doc:{t.document_id} · p.{t.page}</span>
                      </div>
                      <p className="text-sm text-ink-2">{t.context}</p>
                    </li>
                  ))}
                </ul>
              ) : <Empty icon={Scale} title="No treatment found in your library" />}
            </Card>
            <p className="text-xs text-muted">{res.note}</p>
          </>
        )}
      </div>
    </>
  );
}

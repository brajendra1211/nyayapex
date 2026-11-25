"use client";

import clsx from "clsx";
import { AlertTriangle, Building2, FolderOpen, Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CauseListImport } from "@/components/Hearings";
import { Alert, Badge, Card, Empty, PageHeader, Spinner, StatusBadge, fmtDate } from "@/components/ui";
import { api, type FilingStatus } from "@/lib/api";

interface QueueRow { id: number; title: string; case_type: string; case_number: string | null; diary_no: string | null; stage: string; days_in_stage: number;
  defects: number; filing_status: FilingStatus; limitation_expiry: string | null; next_hearing: string | null }
interface FileRow { id: number; title: string; location: string | null; holder: string; since: string | null; next_hearing: string | null }
interface ChamberData { queue: QueueRow[]; files: FileRow[]; alerts: { case_id: number; title: string; level: "bad" | "warn"; text: string }[]; defect_cure_days: number }

const STAGES = ["Drafting", "Filed", "Defects", "Listed"];

export default function ChamberPage() {
  const [d, setD] = useState<ChamberData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<ChamberData>("/api/chamber").then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Chamber" subtitle="Registry queue, where every physical file is, and filing alerts — for the whole chamber." />
      {error && <Alert tone="bad">{error}</Alert>}
      {!d && !error && <Spinner />}
      {d && (
        <div className="space-y-6">
          <Card title="Add today's cause list"><CauseListImport onDone={load} /></Card>

          <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warn-ink" />Filing alerts ({d.alerts.length})</span>} pad={false}>
            {d.alerts.length ? (
              <ul className="divide-y divide-line">
                {d.alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.level === "bad" ? "bg-bad" : "bg-warn")} aria-hidden />
                    <div><Link href={`/matter?id=${a.case_id}`} className="font-medium text-ink hover:underline">{a.title}</Link>
                      <div className="text-ink-2">{a.text}</div></div>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={AlertTriangle} title="No filing alerts" />}
          </Card>

          <Card title={<span className="flex items-center gap-2"><Inbox className="h-4 w-4 text-muted" />Registry queue</span>} pad={false}>
            {d.queue.length ? (
              <div className="grid gap-px bg-line md:grid-cols-4">
                {STAGES.map((s) => {
                  const rows = d.queue.filter((r) => r.stage === s);
                  return (
                    <div key={s} className="bg-surface p-4">
                      <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-ink">{s}</span><Badge>{rows.length}</Badge></div>
                      <ul className="space-y-2">
                        {rows.map((r) => (
                          <li key={r.id} className="rounded-lg border border-line p-2.5 text-sm">
                            <Link href={`/matter?id=${r.id}`} className="font-medium text-ink hover:underline">{r.title}</Link>
                            <div className="text-xs text-muted">{r.case_number || r.case_type}{r.diary_no && ` · Diary ${r.diary_no}`}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                              <Badge tone={r.days_in_stage > 21 ? "warn" : "neutral"}>{r.days_in_stage} days here</Badge>
                              {r.defects > 0 && <Badge tone="bad">{r.defects} defects</Badge>}
                              {s === "Drafting" && <StatusBadge status={r.filing_status} />}
                              {r.limitation_expiry && s === "Drafting" && <span className="text-muted">limitation {fmtDate(r.limitation_expiry)}</span>}
                            </div>
                          </li>
                        ))}
                        {!rows.length && <li className="text-xs text-muted">None</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : <Empty icon={Inbox} title="Nothing in the registry queue">Matters at Drafting, Filed, Defects or Listed show here.</Empty>}
            <p className="border-t border-line px-5 py-2 text-xs text-muted">Defect alerts use a {d.defect_cure_days}-day cure period (SC Rules 2013, Order XV) — verify against current registry practice.</p>
          </Card>

          <Card title={<span className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-muted" />Physical files</span>} pad={false}>
            {d.files.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left text-xs text-ink-2">
                    <tr><th className="px-5 py-2.5 font-medium">Matter</th><th className="px-3 py-2.5 font-medium">Now at</th><th className="px-3 py-2.5 font-medium">Since</th><th className="px-3 py-2.5 font-medium">Next hearing</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.files.map((f) => (
                      <tr key={f.id}>
                        <td className="px-5 py-2.5"><Link href={`/matter?id=${f.id}`} className="font-medium text-ink hover:underline">{f.title}</Link></td>
                        <td className="px-3 py-2.5">{f.location ? <span className="text-ink">{f.location}{f.holder && <span className="text-ink-2"> · {f.holder}</span>}</span> : <span className="text-muted">Not recorded</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{fmtDate(f.since)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink">{fmtDate(f.next_hearing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={Building2} title="No matters yet" />}
            <p className="border-t border-line px-5 py-2 text-xs text-muted">Record a movement from the matter&apos;s Overview → Physical file.</p>
          </Card>
        </div>
      )}
    </>
  );
}

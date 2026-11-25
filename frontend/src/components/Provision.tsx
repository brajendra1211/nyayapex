"use client";

import clsx from "clsx";
import { ArrowRightLeft, Check, Copy, ExternalLink, Gavel, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, fmtDate } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export interface Correspondence {
  direction: "old" | "new"; code: string; section: string | null; ref: string | null; relation: string; title: string;
  available: boolean; source: string; official: boolean; needs_check: boolean;
}
export interface ProvisionData {
  code: string; statute: string; unit?: string; number: string; title: string; text: string | null; chapter?: string;
  chapter_title?: string; version?: string; source_name?: string; source_url?: string; page?: number; status?: string;
  correspondence?: Correspondence[]; applicable_note?: string;
  count?: number; where?: { document_id: number; document: string; page: number }[];
}
interface JudgmentHit {
  document_id: number; title: string; citation: string | null; decision_date: string | null; source_url: string | null;
  pages: number[]; via: string; mentions_provision: boolean; snippet: string;
}

export const CODE_LABEL: Record<string, string> = {
  BNS: "BNS", BNSS: "BNSS", BSA: "BSA", IPC: "IPC", CRPC: "CrPC", IEA: "Evidence Act", COI: "Constitution",
};
export const provisionName = (code: string, number: string) => (code === "COI" ? `Article ${number}` : `${CODE_LABEL[code] ?? code} s. ${number}`);
export const lawHref = (code: string, number?: string | null) => `/law?code=${code}${number ? `&s=${encodeURIComponent(number)}` : ""}`;

/** One statutory provision, verbatim, with its old/new counterpart and the judgments that discuss it. */
export function Provision({ p, compact = false }: { p: ProvisionData; compact?: boolean }) {
  const personal = !!useAuth().user?.features.includes("personal");
  const [open, setOpen] = useState(!compact);
  const [copied, setCopied] = useState(false);
  const [judgments, setJudgments] = useState<JudgmentHit[] | null>(null);
  const [loadingJ, setLoadingJ] = useState(false);

  async function loadJudgments() {
    setLoadingJ(true);
    try { setJudgments(await api<JudgmentHit[]>(`/api/law/${p.code}/${encodeURIComponent(p.number)}/judgments`)); }
    catch { setJudgments([]); }
    setLoadingJ(false);
  }
  function copy() {
    const head = `${provisionName(p.code, p.number)}${p.title ? ` - ${p.title}` : ""} (${p.statute})`;
    navigator.clipboard.writeText(`${head}\n\n${p.text ?? ""}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink">{provisionName(p.code, p.number)}</span>
            {p.title && <span className="text-sm text-ink">{p.title}</span>}
            {p.count ? <Badge>{p.count}× in papers</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-muted">{p.statute}{p.chapter_title ? ` · Chapter ${p.chapter} ${p.chapter_title}` : ""}</div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {p.text && <Button variant="ghost" onClick={copy} title="Copy text">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>}
          <Link href={lawHref(p.code, p.number)} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" title="Open in Bare Acts"><ScrollText className="h-4 w-4" /></Link>
        </div>
      </div>

      {p.applicable_note && <div className="mx-4 mb-2 rounded-md bg-accent-soft px-3 py-1.5 text-xs text-ink">{p.applicable_note}</div>}

      {!!p.correspondence?.length && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 text-xs">
          <ArrowRightLeft className="h-3.5 w-3.5 text-muted" />
          {p.correspondence.map((c, i) => c.relation === "deleted" ? (
            <Badge key={i} tone="warn">No counterpart in {CODE_LABEL[c.direction === "new" ? "BNS" : c.code] ?? c.code} (deleted)</Badge>
          ) : (
            <Link key={i} href={lawHref(c.code, c.section)} title={c.source}
              className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:border-brand/50",
                c.official ? "border-line text-ink" : "border-warn/50 text-warn-ink")}>
              <span className="text-muted">{c.direction === "new" ? "now" : "was"}</span>
              <span className="font-mono font-medium">{provisionName(c.code, c.ref || c.section || "")}</span>
              {c.title && <span className="max-w-48 truncate text-ink-2">{c.title}</span>}
              {!c.official && <span>· verify</span>}
            </Link>
          ))}
        </div>
      )}

      {open && (
        <div className="border-t border-line px-4 py-3">
          {p.text ? (
            <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink">{p.text}</div>
          ) : (
            <p className="text-sm text-muted">{p.status ?? "The text of this Act is not in the library yet."} Open the corresponding provision above.</p>
          )}
          {!!p.where?.length && (
            <div className="mt-3 text-xs text-ink-2">
              Appears in: {p.where.map((w, i) => <span key={i}>{i > 0 && ", "}<Link href={personal ? `/understand?doc=${w.document_id}` : `/documents?id=${w.document_id}`} className="text-brand hover:underline dark:text-accent">{w.document} p.{w.page}</Link></span>)}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{p.version}{p.source_name ? ` · ${p.source_name}` : ""}{p.page ? ` · PDF p.${p.page}` : ""}{p.status ? ` · ${p.status}` : ""}</span>
            {judgments === null && (
              <Button variant="secondary" onClick={loadJudgments} loading={loadingJ}><Gavel className="h-4 w-4" />Supreme Court judgments on this</Button>
            )}
          </div>
          {judgments !== null && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-medium text-ink-2">Judgments in the library that discuss this provision</div>
              {judgments.length ? (
                <ul className="space-y-1.5">
                  {judgments.map((j) => (
                    <li key={j.document_id} className="rounded-md bg-surface-2 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium text-ink">{j.title}</span>
                        {j.citation && <span className="font-mono text-xs text-ink-2">{j.citation}</span>}
                        {j.decision_date && <span className="text-xs text-muted">{fmtDate(j.decision_date)}</span>}
                        <span className="text-xs text-muted">· p.{j.pages[0]}{j.pages[1] !== j.pages[0] ? `-${j.pages[1]}` : ""}</span>
                        {j.mentions_provision ? <Badge tone="good">cites {j.via}</Badge> : <Badge>related</Badge>}
                        {j.source_url && <a href={j.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline dark:text-accent"><ExternalLink className="h-3 w-3" />PDF</a>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-ink-2">{j.snippet}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted">No judgment in the library discusses it yet.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

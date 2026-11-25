"use client";

import { CheckCircle2, Circle, Flag } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

const CATEGORIES = [
  ["wrong_citation", "Wrong or non-existent citation"],
  ["fabricated", "Made-up fact or quote"],
  ["wrong_fact", "Wrong fact / misread record"],
  ["harmful", "Biased or inappropriate output"],
  ["other", "Something else"],
] as const;

/** "I verified this" (Reg 8(3): AI output is advisory and must be checked) - recorded in the AI register with name and time. */
function VerifyAI({ logId }: { logId: number }) {
  const [state, setState] = useState<{ by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const r = await api<{ verified_by: string | null }>(`/api/ai-log/${logId}/verify`, { method: "POST", json: { verified: !state } });
      setState(r.verified_by ? { by: r.verified_by } : null);
    } catch { /* keep the previous state */ }
    setBusy(false);
  }
  return (
    <button onClick={toggle} disabled={busy} title="Record that you have checked this answer against the sources"
      className={state ? "inline-flex items-center gap-1 text-xs font-medium text-good-ink" : "inline-flex items-center gap-1 text-xs text-muted hover:text-good-ink"}>
      {state ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
      {state ? `Verified by ${state.by}` : "I have verified this"}
    </button>
  );
}

/** "Report AI issue" (SC AI Regulations 2026, Reg 39: AI incidents must be reportable and reviewed). */
export function ReportAI({ feature, excerpt, context, logId }: {
  feature: string; excerpt?: string; context?: Record<string, unknown>; logId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("wrong_citation");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ message: string }>("/api/ai-incidents", {
        method: "POST", json: { feature, category, description, excerpt: (excerpt ?? "").slice(0, 4000), context: context ?? {}, ai_output_id: logId ?? null },
      });
      setDone(r.message); setOpen(false); setDescription("");
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-3">
        {logId ? <VerifyAI key={logId} logId={logId} /> : null}
        <button onClick={() => { setOpen(true); setDone(null); }} className="inline-flex items-center gap-1 text-xs text-muted hover:text-bad-ink">
          <Flag className="h-3.5 w-3.5" />Report AI issue
        </button>
        {done && <span className="text-xs text-good-ink">{done}</span>}
      </span>
    );
  }
  return (
    <div className="mt-3 w-full space-y-2 rounded-lg border border-line bg-surface-2 p-3 text-left">
      <div className="text-xs font-medium text-ink">What went wrong?</div>
      <Select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20"
        placeholder="Describe the problem, e.g. which citation is wrong and what the correct one is." />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="flex gap-2">
        <Button onClick={send} loading={busy} disabled={description.trim().length < 5}>Send report</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

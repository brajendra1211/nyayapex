"use client";

import { BookmarkPlus, Check } from "lucide-react";
import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { api, type Case } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Pin a judgment / citation to one of the user's matters (shows in the matter's References tab). */
export function SaveToMatter({ documentId, citation, title, pages }: {
  documentId?: number; citation?: string | null; title?: string; pages?: string;
}) {
  const { user } = useAuth();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [pick, setPick] = useState("");
  const [state, setState] = useState<"idle" | "open" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (!user?.features.includes("cases")) return null;

  async function open() {
    setState("open");
    if (!cases) setCases(await api<Case[]>("/api/cases").catch(() => []));
  }

  async function save() {
    try {
      await api(`/api/matters/${pick}/references`, { method: "POST", json: { document_id: documentId ?? null, citation: citation ?? "", title: title ?? "", pages: pages ?? "" } });
      setState("saved"); setMsg(cases?.find((c) => String(c.id) === pick)?.title ?? "");
    } catch (e) { setState("error"); setMsg((e as Error).message); }
  }

  if (state === "saved") return <span className="inline-flex items-center gap-1 text-xs text-good-ink"><Check className="h-3.5 w-3.5" />Saved to {msg}</span>;
  if (state === "idle") return (
    <button onClick={open} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline dark:text-accent">
      <BookmarkPlus className="h-3.5 w-3.5" />Save to matter
    </button>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-56 py-1 text-xs">
        <option value="">{cases ? (cases.length ? "Choose matter…" : "No matters yet") : "Loading…"}</option>
        {cases?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </Select>
      <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!pick} onClick={save}>Save</Button>
      <button onClick={() => setState("idle")} className="text-xs text-muted hover:text-ink">Cancel</button>
      {state === "error" && <span className="text-xs text-bad-ink">{msg}</span>}
    </span>
  );
}

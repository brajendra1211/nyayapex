"use client";

import { Briefcase, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CaseFields, ROLE_SHORT, caseBody, emptyCase, type CaseForm } from "@/components/personal/kit";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, fmtDate } from "@/components/ui";
import { api, type Case } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";

export default function MyCasesPage() {
  const router = useRouter();
  const askedNew = useQueryParam("new") === "1";
  const [cases, setCases] = useState<Case[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<CaseForm>(emptyCase);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Case[]>("/api/cases").then(setCases).catch((e) => setError(e.message)); }, []);
  const showForm = adding || askedNew;

  async function save() {
    if (form.title.trim().length < 3) { setError("Give your case a short name."); return; }
    setSaving(true); setError(null);
    try {
      const c = await api<Case>("/api/cases", { method: "POST", json: caseBody(form) });
      router.push(`/my-cases/case?id=${c.id}`);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <>
      <PageHeader title="My cases" subtitle="Each case keeps its papers, court dates, things to do and questions for your advocate."
        actions={!showForm && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add a case</Button>} />

      {showForm && (
        <Card title="Add a case" className="mb-6">
          <CaseFields value={form} onChange={setForm} />
          {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
          <div className="mt-5 flex gap-2">
            <Button onClick={save} loading={saving}>Save case</Button>
            <Button variant="secondary" onClick={() => { setAdding(false); setForm(emptyCase); if (askedNew) router.replace("/my-cases"); }}>Cancel</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Only you can see what you add here. You can change any of it later.</p>
        </Card>
      )}

      {!showForm && error && <Alert tone="bad">{error}</Alert>}
      {!cases && !error && <Spinner />}
      {cases && (cases.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => (
            <Link key={c.id} href={`/my-cases/case?id=${c.id}`} className="group rounded-xl border border-line bg-surface p-5 transition hover:border-brand/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{c.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{[c.details?.case_kind, c.case_number, c.details?.city].filter(Boolean).join(" · ")}</div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted group-hover:text-ink" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>{c.stage}</Badge>
                {c.details?.court && <Badge tone="brand">{c.details.court}</Badge>}
                {c.details?.my_role && <Badge>{ROLE_SHORT[c.details.my_role] ?? c.details.my_role}</Badge>}
              </div>
              <div className="mt-3 text-sm text-ink-2">{c.next_hearing ? <>Next date: <b className="text-ink">{fmtDate(c.next_hearing)}</b></> : "Next date not added"}</div>
            </Link>
          ))}
        </div>
      ) : !showForm && (
        <Card><Empty icon={Briefcase} title="No cases yet">Add your case to keep everything about it in one place.</Empty></Card>
      ))}
    </>
  );
}

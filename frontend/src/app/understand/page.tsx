"use client";

import { FileQuestionMark, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { NotAdvice } from "@/components/personal/kit";
import { ExplainPaper, PaperRow, UploadPaper, usePapers, type Paper } from "@/components/personal/Papers";
import { Alert, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

export default function UnderstandPage() {
  const { user } = useAuth();
  const asked = Number(useQueryParam("doc")) || null;
  const { papers, error, reload } = usePapers();
  const [picked, setOpen] = useState<Paper | null>(null);
  const [justUploaded, setJustUploaded] = useState<number | null>(null);
  // the paper named in the link, or the one just uploaded once it has been read, unless the person picked another
  const wanted = justUploaded ?? asked;
  const open = picked ?? papers?.find((x) => x.id === wanted && x.status === "done") ?? null;

  return (
    <>
      <PageHeader title="Understand a document"
        subtitle="Upload a legal paper - an FIR, legal notice, summons, court order, judgment or agreement - and read what it means in simple English or Hindi." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <UploadPaper onDone={(p) => { setOpen(null); setJustUploaded(p.id); reload(); }} />
          <div className="flex items-start gap-2 text-xs text-ink-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" />
            Your papers are private to your account and are not used to train AI.</div>
          {error && <Alert tone="bad">{error}</Alert>}
          {!papers ? <Spinner /> : papers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Your papers</div>
              {papers.map((p) => <PaperRow key={p.id} p={p} active={open?.id === p.id} onOpen={() => setOpen(p)}
                onDeleted={() => { if (open?.id === p.id) setOpen(null); reload(); }} />)}
            </div>
          )}
          <p className="text-xs text-muted">Tip: papers you add inside a case (My cases → a case → Papers) also show here.</p>
        </div>
        <div className="space-y-4 lg:col-span-3">
          <Card>
            {open ? <ExplainPaper key={open.id} paper={open} defaultLang={user?.language === "hi" ? "hi" : "en"} /> : (
              <Empty icon={FileQuestionMark} title="Upload or pick a paper">
                The explanation covers what the paper is, what it says, the dates and deadlines in it, the laws it mentions,
                the legal words used, and questions you may want to ask your advocate.
              </Empty>
            )}
          </Card>
          <NotAdvice />
        </div>
      </div>
    </>
  );
}

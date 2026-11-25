"use client";

import { Briefcase, CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, Empty, PageHeader, Spinner, fmtDate } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface PortalMatter {
  id: number; title: string; case_type: string; diary_no: string | null; stage: string; next_hearing: string | null;
  firm: string; advocates: string[]; open_requests: number;
}

export default function PortalHome() {
  const { user } = useAuth();
  const [items, setItems] = useState<PortalMatter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<PortalMatter[]>("/api/portal/matters").then(setItems).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <PageHeader title={`Namaste${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`} subtitle="Your matters, hearing dates and anything your advocate needs from you." />
      {error && <Alert tone="bad">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items && (items.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((m) => (
            <Link key={m.id} href={`/portal/matter?id=${m.id}`} className="group rounded-xl border border-line bg-surface p-5 transition hover:border-brand/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-ink">{m.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{m.case_type}{m.diary_no ? ` · Diary ${m.diary_no}` : ""} · {m.firm}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted group-hover:text-ink" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-ink"><CalendarClock className="h-4 w-4 text-muted" />
                  {m.next_hearing ? <>Next hearing <b>{fmtDate(m.next_hearing)}</b></> : "Hearing date not fixed"}</span>
                <Badge>{m.stage}</Badge>
                {m.open_requests > 0 && <Badge tone="warn">{m.open_requests} request{m.open_requests > 1 ? "s" : ""} from your advocate</Badge>}
              </div>
              {m.advocates.length > 0 && <div className="mt-3 text-xs text-ink-2">Advocate: {m.advocates.join(", ")}</div>}
            </Link>
          ))}
        </div>
      ) : <Card><Empty icon={Briefcase} title="No matters shared with you yet">Your advocate will add you to your matter.</Empty></Card>)}
    </>
  );
}

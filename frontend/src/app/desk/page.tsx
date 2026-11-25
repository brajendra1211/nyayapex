"use client";

import {
  Briefcase, CalendarClock, ChevronRight, FileQuestionMark, FileText, HandHeart, Languages, ListTodo, MessageCircleQuestionMark, Plus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NotAdvice, ROLE_SHORT } from "@/components/personal/kit";
import { Alert, Badge, Card, Empty, PageHeader, Spinner, fmtDate } from "@/components/ui";
import { api, type Case } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Home {
  cases: (Case & { last_note: { date: string; outcome: string; notes: string } | null })[];
  upcoming: { date: string; kind: "hearing" | "task"; text: string; case_id: number }[];
  tasks: { id: number; title: string; due_date: string | null; case_id: number; case: string }[];
  documents: { id: number; filename: string; status: string; case_id: number | null; case: string | null; created_at: string }[];
}

const TOOLS = [
  { href: "/understand", icon: FileQuestionMark, title: "Understand a document", text: "Upload an FIR, notice, summons or order and read it in simple words." },
  { href: "/ask", icon: MessageCircleQuestionMark, title: "Ask about the law", text: "Ask in English or Hindi. Answers show the law and court judgments they come from." },
  { href: "/legal-words", icon: Languages, title: "Legal words", text: "What do bail, summons, adjournment and other court words mean?" },
  { href: "/legal-help", icon: HandHeart, title: "Free legal help", text: "Free legal aid, helplines and how to choose an advocate." },
];

const daysTo = (d: string) => Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
const when = (d: string) => { const n = daysTo(d); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`; };

export default function DeskPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Home>("/api/personal/home").then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <PageHeader title={`Namaste${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle="Keep your case papers, dates and questions in one place, and understand them in simple words."
        actions={<Link href="/my-cases?new=1" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink hover:opacity-90"><Plus className="h-4 w-4" />Add my case</Link>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Coming up" pad={false}>
              {data.upcoming.length ? (
                <ul className="divide-y divide-line">
                  {data.upcoming.map((u, i) => (
                    <li key={i}>
                      <Link href={`/my-cases/case?id=${u.case_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                        {u.kind === "hearing" ? <CalendarClock className="h-4 w-4 shrink-0 text-brand dark:text-accent" /> : <ListTodo className="h-4 w-4 shrink-0 text-muted" />}
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.text}</span>
                        <span className="text-right text-xs"><span className="block font-medium text-ink">{fmtDate(u.date)}</span>
                          <span className={daysTo(u.date) <= 2 ? "text-bad-ink" : "text-muted"}>{when(u.date)}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-4 text-sm text-ink-2">No dates in the next three months. Add your next court date on your case page and we&apos;ll remind you a day before.</p>}
            </Card>

            <Card title="My cases" actions={data.cases.length > 0 && <Link href="/my-cases" className="text-xs font-medium text-brand hover:underline dark:text-accent">All cases</Link>} pad={false}>
              {data.cases.length ? (
                <ul className="divide-y divide-line">
                  {data.cases.map((c) => (
                    <li key={c.id}>
                      <Link href={`/my-cases/case?id=${c.id}`} className="group flex items-start gap-3 px-5 py-4 hover:bg-surface-2/60">
                        <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink">{c.title}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge>{c.stage}</Badge>
                            {c.details?.court && <Badge tone="brand">{c.details.court}</Badge>}
                            {c.details?.my_role && <Badge>{ROLE_SHORT[c.details.my_role] ?? c.details.my_role}</Badge>}
                          </div>
                          <div className="mt-1.5 text-xs text-ink-2">
                            {c.next_hearing ? <>Next date: <b>{fmtDate(c.next_hearing)}</b></> : "Next date not added"}
                            {c.last_note && <> · Last hearing {fmtDate(c.last_note.date)}{c.last_note.outcome ? `: ${c.last_note.outcome}` : ""}</>}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted group-hover:text-ink" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={Briefcase} title="You haven't added a case yet">
                  Add your case to keep its papers, court dates and questions for your advocate together.
                  <div className="mt-3"><Link href="/my-cases?new=1" className="font-medium text-brand hover:underline dark:text-accent">Add my case</Link></div>
                </Empty>
              )}
            </Card>

            {data.tasks.length > 0 && (
              <Card title="Things to do" pad={false}>
                <ul className="divide-y divide-line">
                  {data.tasks.map((t) => (
                    <li key={t.id}><Link href={`/my-cases/case?id=${t.case_id}&tab=todo`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-2/60">
                      <ListTodo className="h-4 w-4 text-muted" /><span className="flex-1 text-ink">{t.title}</span>
                      <span className="text-xs text-muted">{t.due_date ? fmtDate(t.due_date) : t.case}</span>
                    </Link></li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="group flex gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink"><t.icon className="h-5 w-5" /></span>
                <span><span className="block font-medium text-ink">{t.title}</span><span className="mt-0.5 block text-sm text-ink-2">{t.text}</span></span>
              </Link>
            ))}
            {data.documents.length > 0 && (
              <Card title="Recent papers" pad={false}>
                <ul className="divide-y divide-line">
                  {data.documents.map((d) => (
                    <li key={d.id}><Link href={`/understand?doc=${d.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                      <FileText className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate text-ink">{d.filename}</span>
                    </Link></li>
                  ))}
                </ul>
              </Card>
            )}
            <NotAdvice />
          </div>
        </div>
      )}
    </>
  );
}

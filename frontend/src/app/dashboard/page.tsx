"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, Circle, FileText, Hourglass, Coins, ListTodo, PenLine, ShieldCheck, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListingRow } from "@/components/Hearings";
import { Alert, Badge, Card, Empty, PageHeader, Spinner, StatusBadge, fmtDate } from "@/components/ui";
import { api, type Dashboard, type FilingStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const STATUS_ORDER: FilingStatus[] = ["READY", "AT RISK", "NOT READY"];
const STATUS_FILL: Record<FilingStatus, string> = { "READY": "bg-good", "AT RISK": "bg-warn", "NOT READY": "bg-bad" };

function Stat({ label, value, icon: Icon, hint, alert, href }: {
  label: string; value: string | number; icon: React.ElementType; hint?: string; alert?: boolean; href?: string;
}) {
  const body = (
    <div className={clsx("h-full rounded-xl border bg-surface p-4 transition", alert ? "border-warn/60" : "border-line", href && "hover:border-brand/40")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        <Icon className={clsx("h-4 w-4", alert ? "text-warn-ink" : "text-muted")} />
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function FilingBar({ data }: { data: Record<FilingStatus, number> }) {
  const total = STATUS_ORDER.reduce((s, k) => s + (data[k] ?? 0), 0);
  if (!total) return <p className="text-sm text-muted">No matters yet.</p>;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface" role="img"
        aria-label={STATUS_ORDER.map((s) => `${s}: ${data[s] ?? 0}`).join(", ")}>
        {STATUS_ORDER.filter((s) => data[s]).map((s) => (
          <div key={s} className={clsx("h-full first:rounded-l-full last:rounded-r-full", STATUS_FILL[s])}
            style={{ width: `${(100 * data[s]) / total}%` }} title={`${s}: ${data[s]} of ${total}`} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-2">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="rounded-lg bg-surface-2 px-3 py-2.5">
            <StatusBadge status={s} />
            <div className="mt-1.5 text-xl font-semibold tabular-nums text-ink">{data[s] ?? 0}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageBars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-sm text-muted">No matters yet.</p>;
  return (
    <ul className="space-y-2.5">
      {entries.map(([stage, n]) => (
        <li key={stage} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm" title={`${stage}: ${n}`}>
          <span className="truncate text-ink-2">{stage}</span>
          <div className="h-2.5 rounded-r bg-surface-2">
            <div className="h-full rounded-r bg-series" style={{ width: `${(100 * n) / max}%` }} />
          </div>
          <span className="text-right tabular-nums text-ink">{n}</span>
        </li>
      ))}
    </ul>
  );
}

const GUIDE_KEY = "nyay-guide-hidden";

/** First-week checklist: each step ticks itself off from what the account has actually done. */
function GettingStarted({ data }: { data: Dashboard }) {
  const { user } = useAuth();
  const [calendar, setCalendar] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(() => { try { return typeof window !== "undefined" && localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; } });
  useEffect(() => { api<{ url: string | null }>("/api/calendar/link").then((r) => setCalendar(!!r.url)).catch(() => setCalendar(false)); }, []);
  const steps = [
    { done: data.counts.active_matters > 0, label: "Add your first matter", href: "/cases" },
    { done: data.counts.tracked > 0, label: "Enter a case or diary number — the cause lists are then tracked for you", href: "/cases" },
    { done: data.counts.documents > 0, label: "Upload a record for its chronology and brief", href: "/documents" },
    { done: !!calendar, label: "Subscribe to your hearings calendar in Google / Outlook", href: "/account#calendar" },
    { done: !!user?.phone, label: "Add your WhatsApp number for hearing and limitation alerts", href: "/account" },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (hidden || calendar === null || !left) return null;
  return (
    <Card title={`Getting started · ${steps.length - left} of ${steps.length} done`}
      actions={<button onClick={() => { setHidden(true); try { localStorage.setItem(GUIDE_KEY, "1"); } catch {} }} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Hide"><X className="h-4 w-4" /></button>}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className={clsx("flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2", s.done ? "text-muted line-through" : "text-ink")}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}{s.label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">On a phone, use the browser menu → “Add to Home screen” to install Nyay Apex like an app.</p>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  // Date only after data arrives on the client, so it is never baked into the prerender
  const today = data ? new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : undefined;

  return (
    <>
      <PageHeader
        title="Chamber Dashboard"
        subtitle={today}
        actions={
          <>
            <Link href="/documents" className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2">
              <Upload className="h-4 w-4" /> Upload record
            </Link>
            <Link href="/cases" className="inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-brand-ink hover:opacity-90">
              <Briefcase className="h-4 w-4" /> New matter
            </Link>
          </>
        }
      />

      {error && <div className="mb-6"><Alert tone="bad">{error}</Alert></div>}
      {!data && !error && <Spinner />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Active matters" value={data.counts.active_matters} icon={Briefcase} href="/cases" />
            <Stat label="Hearings in 7 days" value={data.counts.hearings_7d} icon={CalendarClock} href="/cases" />
            <Stat label="Limitation expiring ≤30d" value={data.counts.limitation_30d} icon={Hourglass}
              alert={data.counts.limitation_30d > 0} hint={data.counts.limitation_30d ? "Needs attention" : "All clear"} />
            <Stat label="Open registry defects" value={data.counts.open_defects} icon={ShieldCheck} href="/compliance"
              alert={data.counts.open_defects > 0} />
            <Stat label="AI spend (USD)" value={`$${data.ai.cost_usd.toFixed(2)}`} icon={Coins} href="/usage"
              hint={`${data.ai.calls} calls · ${data.ai.local_cache_hits} free cache hits`} />
          </div>

          <GettingStarted data={data} />

          {(data.listings.length > 0 || data.my_tasks.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="In the cause lists" className="lg:col-span-2" pad={false}
                actions={<Link href="/cases" className="inline-flex items-center gap-1 text-xs font-medium text-brand dark:text-accent">Matters <ArrowRight className="h-3 w-3" /></Link>}>
                {data.listings.length ? <ul className="divide-y divide-line">{data.listings.map((l) => <ListingRow key={`${l.id}-${l.case_id}`} l={l} showCase />)}</ul>
                  : <Empty icon={CalendarClock} title="None of your matters is in a published list yet" />}
              </Card>
              <Card title="My open tasks" pad={false}>
                {data.my_tasks.length ? (
                  <ul className="divide-y divide-line">
                    {data.my_tasks.map((t) => (
                      <li key={t.id}><Link href={`/matter?id=${t.case_id}`} className="block px-5 py-2.5 hover:bg-surface-2/60">
                        <div className="text-sm font-medium text-ink">{t.title}</div>
                        <div className="text-xs text-muted">{t.case}{t.due_date && ` · due ${fmtDate(t.due_date)}`}</div>
                      </Link></li>
                    ))}
                  </ul>
                ) : <Empty icon={ListTodo} title="No open tasks assigned to you" />}
              </Card>
            </div>
          )}

          {!data.ai.enabled && (
            <Alert tone="warn">
              AI is off. Add <code className="font-mono">ANTHROPIC_API_KEY</code> to <code className="font-mono">backend/.env</code>.
              The zero-token features (chronology, citations, format check, limitation) still work.
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Filing readiness" className="lg:col-span-2"><FilingBar data={data.filing_status} /></Card>
            <Card title="Matters by stage"><StageBars data={data.stages} /></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Upcoming hearings" className="lg:col-span-2" pad={false}
              actions={<Link href="/cases" className="inline-flex items-center gap-1 text-xs font-medium text-brand dark:text-accent">All matters <ArrowRight className="h-3 w-3" /></Link>}>
              {data.upcoming_hearings.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-left text-xs text-ink-2">
                      <tr><th className="px-5 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Matter</th>
                        <th className="hidden px-3 py-2.5 font-medium md:table-cell">Bench</th><th className="px-5 py-2.5 font-medium">Filing</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.upcoming_hearings.map((c) => (
                        <tr key={c.id} className="hover:bg-surface-2/60">
                          <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums text-ink">{fmtDate(c.next_hearing)}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-ink">{c.title}</div>
                            <div className="text-xs text-muted">{c.case_type}{c.diary_no ? ` · Diary ${c.diary_no}` : ""}</div>
                          </td>
                          <td className="hidden px-3 py-3 text-ink-2 md:table-cell">{c.bench ?? "—"}</td>
                          <td className="px-5 py-3"><StatusBadge status={c.filing_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty icon={CalendarClock} title="No hearings scheduled">Add hearing dates in Cases &amp; Hearings.</Empty>}
            </Card>

            <Card title="Limitation alerts" pad={false}>
              {data.limitation_alerts.length ? (
                <ul className="divide-y divide-line">
                  {data.limitation_alerts.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                      <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0", (c.days_left ?? 99) <= 7 ? "text-bad-ink" : "text-warn-ink")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{c.title}</div>
                        <div className="text-xs text-muted">Expires {fmtDate(c.limitation_expiry)}</div>
                      </div>
                      <Badge tone={(c.days_left ?? 99) <= 7 ? "bad" : "warn"}>{c.days_left}d left</Badge>
                    </li>
                  ))}
                </ul>
              ) : <Empty icon={Hourglass} title="Nothing expiring in 30 days" />}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Recent documents" className="lg:col-span-2" pad={false}>
              {data.recent_documents.length ? (
                <ul className="divide-y divide-line">
                  {data.recent_documents.map((d) => (
                    <li key={d.id}>
                      <Link href={`/documents?id=${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                        <FileText className="h-4 w-4 text-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.filename}</span>
                        <span className="text-xs text-muted">{d.pages} pp</span>
                        <Badge tone={d.status === "done" ? "good" : d.status === "failed" ? "bad" : "neutral"}>{d.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty icon={FileText} title="No documents yet">Upload a case record to get a chronology and brief.</Empty>}
            </Card>

            <Card title="Quick actions">
              <div className="grid gap-2">
                {[
                  { href: "/drafting", icon: PenLine, label: "Draft an SLP", sub: "From analysed record" },
                  { href: "/compliance", icon: ShieldCheck, label: "Check filing readiness", sub: "Format + limitation" },
                  { href: "/precedent", icon: AlertTriangle, label: "Is it still good law?", sub: "Precedent validator" },
                ].map((a) => (
                  <Link key={a.href} href={a.href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-brand/40 hover:bg-surface-2/60">
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-accent-soft text-accent"><a.icon className="h-4 w-4" /></div>
                    <div><div className="text-sm font-medium text-ink">{a.label}</div><div className="text-xs text-muted">{a.sub}</div></div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

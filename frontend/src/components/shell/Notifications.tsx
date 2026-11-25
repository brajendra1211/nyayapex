"use client";

import clsx from "clsx";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type AppNotification } from "@/lib/api";

const POLL_MS = 45_000;

function ago(iso: string) {
  const s = (Date.now() - new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<{ unread: number; items: AppNotification[] } | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api<{ unread: number; items: AppNotification[] }>("/api/notifications").then(setData).catch(() => {}), []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      await api("/api/notifications/read", { method: "POST" }).catch(() => {});
      setData((d) => d && { unread: 0, items: d.items.map((i) => ({ ...i, read: true })) });
    }
  }

  return (
    <div className="relative">
      <button onClick={toggle} aria-label="Notifications" className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2">
        <Bell className="h-5 w-5" />
        {!!data?.unread && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">Notifications</div>
            <ul className="max-h-96 overflow-y-auto">
              {data?.items.length ? data.items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => { setOpen(false); if (n.link) router.push(n.link); }}
                    className={clsx("block w-full px-4 py-3 text-left text-sm hover:bg-surface-2", !n.read && "bg-accent-soft/40")}>
                    <div className="text-ink">{n.text}</div>
                    <div className="mt-0.5 text-xs text-muted">{ago(n.created_at)}</div>
                  </button>
                </li>
              )) : <li className="px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

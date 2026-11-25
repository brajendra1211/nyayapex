"use client";

import clsx from "clsx";
import { Gavel, KeyRound, LogOut, Menu, Moon, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, contactOf, type Health } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NotificationBell } from "./Notifications";
import { NAV_SEARCH_EVENT, useHtmlData } from "@/lib/hooks";

function usePref(attr: "theme" | "courtroom", key: string, values: [string, string]) {
  const value = useHtmlData(attr, values[0]);
  const toggle = () => {
    const next = value === values[0] ? values[1] : values[0];
    document.documentElement.dataset[attr] = next;
    try { localStorage.setItem(key, next); } catch {}
  };
  return [value, toggle] as const;
}

const VERIFY_LABEL = { pending: "Verification pending", verified: "Verified", rejected: "Verification rejected", not_required: "" };

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";

  return (
    <div className="relative ml-1">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink">
        {initials}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <div className="px-3 py-2">
              <div className="font-medium text-ink">{user.name}</div>
              <div className="text-xs text-muted">{contactOf(user)}</div>
              <div className="mt-1 text-xs text-ink-2">{user.role_label} · {user.workspace?.name}</div>
              {user.verification !== "not_required" && (
                <div className={clsx("mt-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                  user.verification === "verified" ? "bg-good/10 text-good-ink" : user.verification === "rejected" ? "bg-bad/10 text-bad-ink" : "bg-warn/15 text-warn-ink")}>
                  {VERIFY_LABEL[user.verification]}
                </div>
              )}
            </div>
            <div className="my-1 border-t border-line" />
            <Link href="/account" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
              <KeyRound className="h-4 w-4" /> Login &amp; security
            </Link>
            <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const THEMES: [string, string] = ["light", "dark"];
const COURT: [string, string] = ["off", "on"];

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [theme, toggleTheme] = usePref("theme", "nyay-theme", THEMES);
  const [court, toggleCourt] = usePref("courtroom", "nyay-courtroom", COURT);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const { user } = useAuth();
  const isClient = user?.kind === "client";
  const personal = !!user?.features.includes("personal");

  useEffect(() => {
    api<Health>("/api/health").then(setHealth).catch(() => setHealth("down"));
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6 print:hidden">
      <button onClick={onMenu} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      {isClient ? <div className="flex-1" /> : <form
        className="relative max-w-xl flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          router.push(`${personal ? "/ask" : "/research"}?q=${encodeURIComponent(q.trim())}`);
          // pushState fires no event; tell an already-open Research page to re-read the URL
          setTimeout(() => window.dispatchEvent(new Event(NAV_SEARCH_EVENT)), 50);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={personal ? "Ask about the law in English or Hindi…" : "Ask a legal question in plain English…"}
          className="w-full rounded-lg border border-line bg-surface-2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:bg-surface focus:outline-none"
        />
      </form>}

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={clsx(
            "hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs md:inline-flex",
            health === "down" ? "text-bad-ink" : health && !health.ai_enabled ? "text-warn-ink" : "text-ink-2",
          )}
          title={health && health !== "down" ? `Bulk: ${health.models.bulk} · Smart: ${health.models.smart}` : ""}
        >
          <span className={clsx("h-2 w-2 rounded-full",
            health === "down" ? "bg-bad" : health && !health.ai_enabled ? "bg-warn" : health ? "bg-good" : "bg-line")} />
          {health === "down" ? "Backend offline" : health && !health.ai_enabled ? "AI off · add API key" : health ? "AI connected" : "Checking…"}
        </span>

        <button
          onClick={toggleCourt}
          className={clsx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
            court === "on" ? "bg-accent text-[#0b2d6b]" : "text-ink-2 hover:bg-surface-2")}
          title="Courtroom readability mode: large text, high contrast"
          aria-pressed={court === "on"}
        >
          <Gavel className="h-4 w-4" />
          <span className="hidden sm:inline">{personal ? "Large text" : "Courtroom mode"}</span>
        </button>

        <button onClick={toggleTheme} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Toggle dark mode">
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

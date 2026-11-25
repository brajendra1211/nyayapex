"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { BRAND, navFor } from "@/lib/nav";

const TYPE_LABEL = { advocate: "Advocate", firm: "Law Firm / Chamber", corporate: "Corporate Legal", student: "Law Student", individual: "Individual" };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const NAV = navFor(user);

  return (
    <nav className="flex h-full flex-col bg-side text-side-ink">
      <Link href="/dashboard" onClick={onNavigate} className="block px-4 py-4" title={BRAND.name}>
        <Logo on="dark" className="h-12" />
      </Link>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {NAV.map((section) => (
          <div key={section.group} className="mt-5 first:mt-1">
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-side-ink/50">{section.group}</div>
            <ul className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      className={clsx(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                        active ? "bg-side-active font-medium text-white" : "hover:bg-side-active/60 hover:text-white",
                      )}
                    >
                      <Icon className={clsx("h-4 w-4", active ? "text-accent" : "text-side-ink/70 group-hover:text-white")} />
                      {label}
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        {user?.workspace && (
          <>
            <div className="truncate text-sm font-medium text-white">{user.workspace.name}</div>
            <div className="text-[11px] text-side-ink/70">{TYPE_LABEL[user.workspace.type]}</div>
          </>
        )}
        <div className="mt-2 text-[11px] text-side-ink/50">SCS Universal Tech Pvt. Ltd. · Pilot v0.1</div>
      </div>
    </nav>
  );
}

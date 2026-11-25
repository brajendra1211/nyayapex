"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { AuthProvider, homeFor, useAuth } from "@/lib/auth";
import { BARE_PATHS, PUBLIC_PATHS, SITE_PATHS, featureForPath } from "@/lib/nav";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Installable app + offline page in production; never caches case data (see public/sw.js)
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return (
    <AuthProvider>
      <Guarded>{children}</Guarded>
    </AuthProvider>
  );
}

function FullScreenSpinner() {
  return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
}

/** Sends visitors to login / onboarding / their home as needed, and hides features their account type lacks. */
function Guarded({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // The website renders at once (also for search engines); a logged-in user opening the home page goes to the app
  const isSite = SITE_PATHS.includes(pathname);
  const siteTarget = isSite && pathname === "/" && !loading && user?.onboarded ? homeFor(user) : null;
  useEffect(() => { if (siteTarget) router.replace(siteTarget); }, [siteTarget, router]);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const feature = featureForPath(pathname);
  const allowed = !feature || (feature === "platform_admin" ? !!user?.is_platform_admin : !!user?.features.includes(feature));

  let target: string | null = null;
  if (!loading && !isSite) {
    if (!user && !isPublic) target = "/login";
    else if (user && !user.onboarded && pathname !== "/onboarding") target = "/onboarding";
    // Alerts link to /matter?id=…; an individual's own case page is /my-cases/case?id=…
    else if (user?.onboarded && pathname === "/matter" && user.features.includes("personal"))
      target = "/my-cases/case" + (typeof window === "undefined" ? "" : window.location.search);
    else if (user?.onboarded && (isPublic || pathname === "/onboarding" || !allowed)) target = homeFor(user);
  }
  useEffect(() => { if (target && target !== pathname) router.replace(target); }, [target, pathname, router]);

  if (isSite) return <>{children}</>;
  if (BARE_PATHS.includes(pathname)) return loading || (target && target !== pathname) ? <FullScreenSpinner /> : <>{children}</>;
  if (loading || !user || target) return <FullScreenSpinner />;
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const personal = !!useAuth().user?.features.includes("personal");

  return (
    <div className="flex h-full min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block print:hidden">
        <Suspense><Sidebar /></Suspense>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <Suspense><Sidebar onNavigate={() => setOpen(false)} /></Suspense>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-line px-6 py-3 text-center text-xs text-muted print:hidden">
          {personal
            ? "Nyay Apex gives legal information in simple words, not legal advice. AI answers can be wrong: confirm with an advocate or free legal aid (15100)."
            : "Nyay Apex is a digital co-counsel. AI output is non-binding and must be verified by the advocate. No filing is ever made automatically."}
        </footer>
      </div>
    </div>
  );
}

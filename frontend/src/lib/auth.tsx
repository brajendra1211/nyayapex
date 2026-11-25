"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { UNAUTHORIZED_EVENT, api, dropLegacyToken, legacyToken, type Me } from "./api";

interface AuthState {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  signIn: (user: Me) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/api/auth/me");
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // One-time move of an old page-storage token to the httpOnly cookie
    const moved = legacyToken() ? api("/api/auth/session", { method: "POST" }).then(dropLegacyToken).catch(dropLegacyToken) : Promise.resolve();
    moved.then(() => api<Me>("/api/auth/me"))
      .then((me) => { if (!cancelled) setUser(me); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { cancelled = true; window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, []);

  const signIn = useCallback((me: Me) => {
    setUser(me);
    setLoading(false);
  }, []);

  const signOut = useCallback(() => {
    api("/api/auth/logout", { method: "POST" }).catch(() => {});
    dropLegacyToken();
    setUser(null);
    router.replace("/login");
  }, [router]);

  return <Ctx.Provider value={{ user, loading, refresh, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Where a user should land after login, based on onboarding state and account type. */
export function homeFor(user: Me | null): string {
  if (!user) return "/login";
  if (!user.onboarded) return "/onboarding";
  if (user.kind === "client") return "/portal";
  if (user.features.includes("personal")) return "/desk";
  return user.features.includes("dashboard") ? "/dashboard" : "/research";
}

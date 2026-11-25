import {
  BadgeCheck, BarChart3, BookOpen, BookOpenCheck, Briefcase, Building2, FolderOpen, FileQuestionMark, FileSearch, FileText, Gavel, HandHeart, House,
  Languages, LayoutDashboard, Library, MessageCircleQuestionMark, PenLine, Scale, ScrollText, ShieldCheck, Users,
} from "lucide-react";
import type { Me } from "./api";

type Item = { href: string; label: string; icon: typeof LayoutDashboard; feature: string };

export const NAV: { group: string; items: Item[] }[] = [
  {
    // Individual accounts: a person following their own case
    group: "My legal desk",
    items: [
      { href: "/desk", label: "Home", icon: House, feature: "personal" },
      { href: "/my-cases", label: "My cases", icon: Briefcase, feature: "personal" },
      { href: "/understand", label: "Understand a document", icon: FileQuestionMark, feature: "personal" },
      { href: "/ask", label: "Ask about the law", icon: MessageCircleQuestionMark, feature: "personal" },
    ],
  },
  {
    group: "Learn",
    items: [
      { href: "/legal-words", label: "Legal words", icon: Languages, feature: "personal" },
      { href: "/legal-help", label: "Free legal help", icon: HandHeart, feature: "personal" },
    ],
  },
  {
    group: "My matters",
    items: [{ href: "/portal", label: "My matters", icon: FolderOpen, feature: "portal" }],
  },
  {
    group: "Overview",
    items: [{ href: "/dashboard", label: "Chamber Dashboard", icon: LayoutDashboard, feature: "dashboard" }],
  },
  {
    group: "Research",
    items: [
      { href: "/research", label: "Legal Research", icon: FileSearch, feature: "research" },
      { href: "/precedent", label: "Precedent Validator", icon: Scale, feature: "precedent" },
      { href: "/citations", label: "Citation Manager", icon: Library, feature: "citations" },
      { href: "/law", label: "Bare Acts", icon: BookOpen, feature: "law" },
    ],
  },
  {
    group: "Drafting & Filing",
    items: [
      { href: "/documents", label: "Document Intelligence", icon: FileText, feature: "documents" },
      { href: "/drafting", label: "Drafting Assistant", icon: PenLine, feature: "drafting" },
      { href: "/compliance", label: "Registry Compliance", icon: ShieldCheck, feature: "compliance" },
    ],
  },
  {
    group: "Practice",
    items: [
      { href: "/cases", label: "Cases & Hearings", icon: Briefcase, feature: "cases" },
      { href: "/chamber", label: "Chamber", icon: Building2, feature: "cases" },
      { href: "/courtroom", label: "Courtroom Assistant", icon: Gavel, feature: "courtroom" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/team", label: "Team & Roles", icon: Users, feature: "team" },
      { href: "/usage", label: "AI Usage & Cost", icon: BarChart3, feature: "usage" },
      { href: "/ai-log", label: "AI Register", icon: ScrollText, feature: "research" },
      { href: "/admin", label: "Verifications", icon: BadgeCheck, feature: "platform_admin" },
    ],
  },
];

export function navFor(user: Me | null) {
  const allowed = new Set([...(user?.features ?? []), ...(user?.is_platform_admin ? ["platform_admin"] : [])]);
  const personal = allowed.has("personal");
  return NAV.map((s) => ({
    ...s,
    // Individuals see Bare Acts among their own tools, not under the professionals' "Research" heading
    group: personal && s.group === "Research" ? "Read the law" : s.group,
    items: s.items.filter((i) => allowed.has(i.feature)),
  })).filter((s) => s.items.length);
}

/** Feature required for a path (undefined = no restriction beyond login). */
export function featureForPath(pathname: string): string | undefined {
  if (pathname.startsWith("/matter") || pathname.startsWith("/filing")) return "cases";
  if (pathname.startsWith("/portal")) return "portal";
  for (const s of NAV) for (const i of s.items) {
    if (pathname.startsWith(i.href)) return i.feature;
  }
}

export const PUBLIC_PATHS = ["/login"];
/** The public website: open to everyone, logged in or not, rendered without the app's sidebar. */
export const SITE_PATHS = ["/", "/features", "/individuals", "/about", "/contact", "/responsible-ai", "/privacy", "/terms"];
export const BARE_PATHS = ["/login", "/onboarding"]; // rendered without sidebar/topbar

export const BRAND = { name: "Nyay Apex", tagline: "Supreme Court practice suite", icon: BookOpenCheck };

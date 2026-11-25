"use client";

import { CheckCircle2, HelpCircle, Link2 } from "lucide-react";
import { Badge } from "@/components/ui";
import type { CiteStatus } from "@/lib/api";

/** Library verification badge: icon + words, never colour alone. */
export function CitationStatus({ status, citedIn }: { status: CiteStatus; citedIn?: number | null }) {
  if (status === "verified") return <Badge tone="good"><CheckCircle2 className="h-3 w-3" />In SC library</Badge>;
  if (status === "cited") return <Badge tone="brand"><Link2 className="h-3 w-3" />{citedIn ? `Cited in ${citedIn} judgments` : "Cited in library"}</Badge>;
  return <Badge tone="warn"><HelpCircle className="h-3 w-3" />Not found — verify manually</Badge>;
}

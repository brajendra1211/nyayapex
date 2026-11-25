export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// The session lives in an httpOnly cookie set by the API at login; page scripts never see it.
// Browsers that logged in before the switch still hold a token here until it is exchanged once (see auth.tsx).
const LEGACY_TOKEN_KEY = "nyay-token";
export const UNAUTHORIZED_EVENT = "nyay:unauthorized";

export function legacyToken(): string | null {
  try { return localStorage.getItem(LEGACY_TOKEN_KEY); } catch { return null; }
}
export function dropLegacyToken() {
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
}

export async function rawFetch(path: string, init?: RequestInit & { json?: unknown }): Promise<Response> {
  const { json, ...rest } = init ?? {};
  const token = legacyToken();
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Nyay-Client", "web"); // with the cookie, the API accepts changes only from this app
  try {
    return await fetch(`${API_URL}${path}`, { ...rest, headers, credentials: "include", body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch {
    throw new ApiError(0, "Backend se connect nahi ho paya. Kya FastAPI server chal raha hai? (port 8000)");
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await rawFetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/otp")) {
    // Session missing/expired: AuthProvider clears the user and the guard sends them to /login
    dropLegacyToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return handle<T>(res);
}

/** Authenticated file download (plain <a href> can't send the bearer token). */
export async function download(path: string, filename: string) {
  const res = await rawFetch(path);
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
}

/** POST that returns a file (PDF builders): saves it and returns the JSON summary sent in the X-Report header. */
export async function postDownload<R>(path: string, body: FormData | unknown, filename: string): Promise<R | null> {
  const res = await rawFetch(path, body instanceof FormData ? { method: "POST", body } : { method: "POST", json: body });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); msg = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail ?? b); } catch {}
    throw new ApiError(res.status, msg);
  }
  const report = res.headers.get("X-Report");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  return report ? (JSON.parse(report) as R) : null;
}

export function upload<T>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: "POST", body: form });
}

/** "+91 98765 43210" or the email, whichever the person has. */
export function contactOf(p: { phone?: string | null; email?: string | null }): string {
  return p.phone ? `+91 ${p.phone}` : p.email ?? "";
}

/** Team invites accept either a mobile number or an email in one field. */
export function inviteContact(value: string): { phone?: string; email?: string } {
  const v = value.trim();
  return v.includes("@") ? { email: v } : { phone: v };
}

// ---------- Types ----------

export type FilingStatus = "READY" | "AT RISK" | "NOT READY";

export interface Case {
  id: number;
  title: string;
  diary_no: string | null;
  case_type: string;
  bench: string | null;
  stage: string;
  priority: string;
  next_hearing: string | null;
  limitation_expiry: string | null;
  filing_status: FilingStatus;
  defects: number;
  case_number?: string | null;
  file_location?: string | null;
  stage_since?: string | null;
  days_left?: number;
  details?: CaseDetails | null;
}

/** What an individual (non-advocate) records about their own case. */
export interface CaseDetails {
  court?: string; city?: string; my_role?: string; other_party?: string; case_kind?: string;
  fir_no?: string; police_station?: string; filed_on?: string; summary?: string;
  advocate_name?: string; advocate_phone?: string; advocate_email?: string;
  questions?: { text: string; answer?: string; done?: boolean }[];
}

/** A matter (or an AOR's item) in a published Supreme Court cause list. */
export interface Listing {
  id: number;
  list_date: string;
  kind: "daily" | "advance";
  court: string;
  bench: string;
  item_no: string;
  case_no: string;
  parties: string;
  remarks: string;
  page: number;
  description: string;
  case_id?: number;
  case?: string;
  matched_by?: "case_number" | "diary_no";
}

export interface HearingNote {
  id: number;
  hearing_date: string;
  court: string;
  bench: string;
  item_no: string;
  outcome: string;
  notes: string;
  next_date: string | null;
  dictated: boolean;
  document_id: number | null;
  created_at: string;
  updated_at: string;
  author: Person | null;
}

export interface Dashboard {
  counts: { active_matters: number; hearings_7d: number; limitation_30d: number; open_defects: number; documents: number; tracked: number };
  filing_status: Record<FilingStatus, number>;
  stages: Record<string, number>;
  upcoming_hearings: Case[];
  limitation_alerts: Case[];
  listings: Listing[];
  my_tasks: { id: number; title: string; due_date: string | null; case_id: number; case: string }[];
  recent_documents: { id: number; filename: string; status: string; pages: number; created_at: string }[];
  ai: { cost_usd: number; calls: number; local_cache_hits: number; enabled: boolean };
}

export interface ChronoEvent {
  date: string;
  event: string;
  pages: (number | null)[];
  source: "regex" | "ai";
}

export interface DocCitation {
  citation: string;
  reporter: string;
  case_name: string;
  pages: number[];
}

export interface Brief {
  summary: string;
  core_issues: string[];
  ancillary_issues: string[];
  questions_of_law: string[];
  contradictions: { point: string; pages: number[] }[];
  articles: string[];
  hearing_points: string[];
}

export interface DocStats {
  pages: number;
  ocr_pages: number;
  duplicate_pages_removed: number;
  noise_removed_pct: number;
  chunks: number;
  chunks_sent_to_ai?: number;
  tokens_raw_est: number;
  tokens_sent_est?: number;
  brief_input_tokens_est?: number;
  reused_from?: number;
}

export interface Doc {
  id: number;
  case_id: number | null;
  filename: string;
  pages: number;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  stats: DocStats | null;
  created_at: string;
  chronology?: ChronoEvent[];
  citations?: DocCitation[];
  brief?: Brief | null;
  brief_ai_log_id?: number | null;
}

export interface Source {
  document_id: number;
  document: string;
  library?: "public" | "private";
  scr_citation?: string | null;
  neutral_citation?: string | null;
  decision_date?: string | null;
  source_url?: string | null;
  pages: [number, number];
  score: number;
  snippet: string;
  judges?: string | null;
  citations: string[];
  matched_by?: ("citation" | "name" | "keyword" | "meaning")[];
  forum?: "SC" | "NCLAT" | "NCLT";
  forum_name?: string;
  bench?: string | null;
  case_no?: string | null;
  binding_note?: string | null;
  arising_from?: string | null;
}

export interface Judgment {
  id: number;
  title: string;
  scr_citation: string | null;
  neutral_citation: string | null;
  decision_date: string | null;
  judges: string | null;
  disposal: string | null;
  source_url: string | null;
  pages: number;
  passages: number | null;
}

export interface CorpusStats {
  judgments: number;
  recent: Judgment[];
  attribution: string;
}

export interface Defect {
  code: string;
  severity: "critical" | "major" | "minor";
  issue: string;
  fix: string;
  pages: number[];
}

export interface LintFlag {
  line: number;
  sentence: string;
  match: string;
  risk: string;
  fix: string;
}

export type AccountType = "advocate" | "firm" | "corporate" | "student" | "individual";

export interface Me {
  id: number;
  phone: string | null;
  has_password: boolean;
  name: string;
  email: string | null;
  role: string | null;
  role_label: string | null;
  profile: Record<string, unknown>;
  verification: "not_required" | "pending" | "verified" | "rejected";
  language: "en" | "hi";
  citation_pref: "SCC" | "AIR" | "MANU";
  onboarded: boolean;
  is_platform_admin: boolean;
  workspace: { id: number; type: AccountType; name: string; details: Record<string, string> } | null;
  features: string[];
  pending_invites?: { id: number; workspace: string; workspace_type: AccountType; role: string; role_label: string; name: string }[];
  kind: "professional" | "client";
  client_invites?: { id: number; matter: string; firm: string; name: string }[];
}

export interface Health {
  ok: boolean;
  ai_enabled: boolean;
  models: { bulk: string; smart: string };
}

// ---------- Citations ----------

export type CiteStatus = "verified" | "cited" | "unknown";
export interface Parallel { citation: string; reporter: string; seen: number }

export interface SavedCitation {
  id: number;
  citation: string;
  case_name: string;
  reporter: string;
  note: string;
  status: CiteStatus;
  parallels: Parallel[];
  cited_in: number | null;
  judgment_id: number | null;
  judgment: { title: string | null; decision_date: string | null; source_url: string | null } | null;
  verified_at: string | null;
  preferred: string;
  duplicate?: boolean;
}

export interface FoundCitation {
  citation: string;
  reporter: string;
  case_name: string;
  raw: string;
  status: CiteStatus;
  parallels: Parallel[];
  judgment: { id: number; title: string | null; decision_date: string | null; source_url: string | null } | null;
  saved: boolean;
}

// ---------- Matters & client portal ----------

export interface Person { id: number; name: string; kind: "professional" | "client"; role_label: string | null }

export interface Attachment { type: "document" | "judgment" | "citation"; id?: number; label: string; citation?: string | null }

export interface ChatMessage {
  id: number;
  channel: "team" | "client";
  body: string;
  attachments: Attachment[];
  author: Person | null;
  created_at: string;
}

export interface MatterTask {
  id: number;
  title: string;
  details: string;
  kind: "task" | "document_request";
  for_client: boolean;
  assignee: Person | null;
  due_date: string | null;
  status: "open" | "done";
  document_id: number | null;
  created_at: string;
}

export interface MatterRef {
  id: number;
  document_id: number | null;
  title: string;
  citation: string;
  decision_date: string | null;
  source_url: string | null;
  note: string;
  pages: string;
}

export interface MatterDoc {
  id: number;
  filename: string;
  pages: number;
  status: string;
  shared_with_client: boolean;
  created_at: string;
  uploaded_by?: Person | null;
  version: number;
  version_note: string;
  superseded: boolean;
  history?: MatterDoc[];
}

export interface Matter {
  case: Case;
  can_manage: boolean;
  team: (Person & { matter_role: "lead" | "member" })[];
  clients: { id: number; name: string; phone: string | null; email: string | null; status: "active" | "invited" }[];
  counts: { documents: number; open_tasks: number; references: number };
  available?: Person[];
}

export interface AppNotification { id: number; text: string; link: string; kind: string; read: boolean; created_at: string }

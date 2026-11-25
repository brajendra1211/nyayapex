"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Check, GraduationCap, Plus, Scale, Trash2, User, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { api, contactOf, inviteContact, type AccountType, type Me } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";

const TYPES: { id: AccountType; title: string; sub: string; icon: typeof Scale }[] = [
  { id: "advocate", title: "Individual Advocate", sub: "AOR, senior or independent practitioner", icon: Scale },
  { id: "firm", title: "Law Firm / Chamber", sub: "A chamber or firm with a team — AOR, seniors, juniors, clerks", icon: Users },
  { id: "corporate", title: "Corporate Legal Team", sub: "In-house counsel managing litigation with outside AORs", icon: Building2 },
  { id: "student", title: "Law Student", sub: "Learn research & drafting on real tools (no client matters)", icon: GraduationCap },
  { id: "individual", title: "Individual (not a lawyer)", sub: "Follow your own case, understand legal papers and the law in simple words", icon: User },
];
const STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman & Nicobar Islands", "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu", "Delhi", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry"];

const BAR_COUNCILS = [
  "Andhra Pradesh", "Assam, Nagaland, Meghalaya, Manipur, Tripura, Mizoram & Arunachal Pradesh", "Bihar", "Chhattisgarh", "Delhi",
  "Gujarat", "Himachal Pradesh", "Jammu & Kashmir and Ladakh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra & Goa", "Odisha", "Punjab & Haryana", "Rajasthan", "Tamil Nadu & Puducherry", "Telangana", "Uttar Pradesh",
  "Uttarakhand", "West Bengal",
];
const PRACTICE = ["Constitutional", "Civil", "Criminal", "Service", "Tax", "Arbitration", "Corporate & Commercial", "Land & Property",
  "Family", "Environment", "Intellectual Property", "Consumer"];
const COURTS = ["Supreme Court", "High Court", "District Courts", "Tribunals (NCLT/NGT/ITAT…)"];

type Profile = Record<string, string | boolean | string[]>;
type Step = "invite" | "type" | "details" | "consent" | "team";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const invites = user?.pending_invites ?? [];

  const [step, setStep] = useState<Step>(invites.length ? "invite" : "type");
  const [notClient, setNotClient] = useState(false);
  const [mode, setMode] = useState<"create" | "join">(invites.length ? "join" : "create");
  const [inviteId, setInviteId] = useState<number | null>(invites[0]?.id ?? null);
  const [type, setType] = useState<AccountType | null>(null);
  const [name, setName] = useState(invites[0]?.name || user?.name || "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [wsName, setWsName] = useState("");
  const [ws, setWs] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<Profile>({});
  const [isAdvocate, setIsAdvocate] = useState(true); // firm admin: are you an advocate?
  const [prefs, setPrefs] = useState({ language: "en", citation_pref: "SCC" });
  const [consent, setConsent] = useState(false);
  const [aiAck, setAiAck] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Me | null>(null);

  const invite = invites.find((i) => i.id === inviteId);
  const effectiveType: AccountType | null = mode === "join" ? invite?.workspace_type ?? null : type;
  const joinAsAdvocate = mode === "join" && ["aor", "senior", "junior"].includes(invite?.role ?? "");
  const needsBar = (mode === "create" && (type === "advocate" || (type === "firm" && isAdvocate))) || joinAsAdvocate;

  const setP = (k: string, v: string | boolean | string[]) => setProfile((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) => {
    const cur = (profile[k] as string[] | undefined) ?? [];
    setP(k, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };

  function detailsValid(): string | null {
    if (name.trim().length < 2) return "Enter your full name.";
    if (needsBar && !(profile.bar_enrolment_no as string)?.trim()) return "Bar Council enrolment number is required.";
    if (needsBar && !profile.state_bar_council) return "Select your State Bar Council.";
    if (needsBar && profile.is_aor && !(profile.aor_code as string)?.trim()) return "Enter your AOR code.";
    if (mode === "create" && (type === "firm" || type === "corporate") && wsName.trim().length < 2)
      return type === "firm" ? "Enter the firm / chamber name." : "Enter the company name.";
    if (mode === "create" && type === "student" && !(profile.college as string)?.trim()) return "Enter your college / university.";
    return null;
  }

  async function submit() {
    setLoading(true); setError(null);
    try {
      const body = {
        mode, invite_id: mode === "join" ? inviteId : null, account_type: mode === "create" ? type : null,
        name: name.trim(), email: email.trim() || null, workspace_name: wsName.trim() || null,
        workspace_details: ws, profile: needsBar || type !== "firm" ? profile : { designation: profile.designation },
        ...prefs, consent, ai_ack: aiAck,
      };
      const me = await api<Me>("/api/auth/onboarding", { method: "POST", json: body });
      setDone(me);
      if (mode === "create" && (type === "firm" || type === "corporate")) setStep("team");
      else finish();
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  async function finish() {
    const me = await refresh();
    router.replace(homeFor(me ?? done));
  }

  const steps: Step[] = mode === "join" ? ["invite", "details", "consent"]
    : ["type", "details", "consent", ...(type === "firm" || type === "corporate" ? ["team" as Step] : [])];
  const idx = steps.indexOf(step);

  if (user?.client_invites?.length && !invites.length && !notClient) {
    return <ClientOnboarding invites={user.client_invites} onNotClient={() => setNotClient(true)} />;
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-8">
        <Logo className="h-9" />
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <span className="hidden sm:inline">{user ? contactOf(user) : ""}</span>
          <button onClick={signOut} className="text-ink-2 hover:text-ink">Log out</button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {/* Progress */}
        <ol className="mb-8 flex items-center gap-2">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                i < idx ? "bg-good text-white" : i === idx ? "bg-brand text-brand-ink" : "bg-surface-2 text-muted")}>
                {i < idx ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              {i < steps.length - 1 && <span className={clsx("h-0.5 flex-1 rounded", i < idx ? "bg-good" : "bg-line")} />}
            </li>
          ))}
        </ol>

        {step === "invite" && (
          <Panel title="You've been invited" sub="Your number was added to a team on Nyay Apex.">
            <div className="space-y-2">
              {invites.map((i) => (
                <button key={i.id} onClick={() => { setInviteId(i.id); setMode("join"); }}
                  className={clsx("flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition",
                    mode === "join" && inviteId === i.id ? "border-brand bg-brand/5" : "border-line hover:border-brand/40")}>
                  <Users className="h-5 w-5 text-muted" />
                  <div className="flex-1">
                    <div className="font-medium text-ink">{i.workspace}</div>
                    <div className="text-sm text-ink-2">Join as {i.role_label}</div>
                  </div>
                </button>
              ))}
              <button onClick={() => setMode("create")}
                className={clsx("w-full rounded-xl border-2 p-4 text-left text-sm transition",
                  mode === "create" ? "border-brand bg-brand/5 text-ink" : "border-line text-ink-2 hover:border-brand/40")}>
                No thanks — create my own separate account
              </button>
            </div>
            <Nav onNext={() => setStep(mode === "join" ? "details" : "type")} />
          </Panel>
        )}

        {step === "type" && (
          <Panel title="How will you use Nyay Apex?" sub="This sets up the right tools and team structure. You can't change it later.">
            <div className="grid gap-3 sm:grid-cols-2">
              {TYPES.map((t) => (
                <button key={t.id} onClick={() => setType(t.id)}
                  className={clsx("flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition",
                    type === t.id ? "border-brand bg-brand/5" : "border-line hover:border-brand/40")}>
                  <div className={clsx("grid h-10 w-10 place-items-center rounded-lg", type === t.id ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-2")}>
                    <t.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{t.title}</div>
                    <div className="mt-0.5 text-sm text-ink-2">{t.sub}</div>
                  </div>
                </button>
              ))}
            </div>
            <Nav onBack={invites.length ? () => setStep("invite") : undefined} onNext={() => setStep("details")} disabled={!type} />
          </Panel>
        )}

        {step === "details" && (
          <Panel title={mode === "join" ? `Join ${invite?.workspace}` : TYPES.find((t) => t.id === type)?.title ?? "Your details"}
            sub={mode === "join" ? `You'll join as ${invite?.role_label}.` : "Tell us about you."}>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "individual" ? "Your name" : "As on Bar Council card / ID"} /></div>
                <div><Label hint={user?.has_password ? "your login" : "optional"}>Email</Label><Input type="email" value={email} disabled={!!user?.has_password} onChange={(e) => setEmail(e.target.value)} /></div>
              </div>

              {mode === "create" && type === "firm" && (
                <Section title="Firm / chamber">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><Label>Firm / chamber name</Label><Input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. Shah & Associates" /></div>
                    <div><Label>City</Label><Input value={ws.city ?? ""} onChange={(e) => setWs({ ...ws, city: e.target.value })} /></div>
                    <div><Label>Team size</Label>
                      <Select value={ws.size ?? ""} onChange={(e) => setWs({ ...ws, size: e.target.value })}>
                        <option value="">—</option>{["2–5", "6–15", "16–50", "50+"].map((s) => <option key={s}>{s}</option>)}
                      </Select></div>
                    <div className="sm:col-span-2"><Label hint="optional, for invoices">GSTIN</Label>
                      <Input value={ws.gstin ?? ""} onChange={(e) => setWs({ ...ws, gstin: e.target.value.toUpperCase() })} placeholder="07ABCDE1234F1Z5" className="font-mono" /></div>
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={isAdvocate} onChange={(e) => setIsAdvocate(e.target.checked)} className="accent-[var(--brand)]" />
                    I am an enrolled advocate (uncheck if you manage the office)
                  </label>
                  {!isAdvocate && <div className="mt-3"><Label>Your designation</Label><Input value={(profile.designation as string) ?? ""} onChange={(e) => setP("designation", e.target.value)} placeholder="Office manager" /></div>}
                </Section>
              )}

              {mode === "create" && type === "corporate" && (
                <Section title="Company">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><Label>Company name</Label><Input value={wsName} onChange={(e) => setWsName(e.target.value)} /></div>
                    <div><Label hint="optional">CIN</Label><Input value={ws.cin ?? ""} onChange={(e) => setWs({ ...ws, cin: e.target.value.toUpperCase() })} className="font-mono" /></div>
                    <div><Label hint="optional">GSTIN</Label><Input value={ws.gstin ?? ""} onChange={(e) => setWs({ ...ws, gstin: e.target.value.toUpperCase() })} className="font-mono" /></div>
                    <div><Label>Industry</Label><Input value={ws.industry ?? ""} onChange={(e) => setWs({ ...ws, industry: e.target.value })} /></div>
                    <div><Label>Your designation</Label><Input value={(profile.designation as string) ?? ""} onChange={(e) => setP("designation", e.target.value)} placeholder="General Counsel" /></div>
                  </div>
                </Section>
              )}

              {mode === "join" && !joinAsAdvocate && (
                <div><Label>Your designation</Label><Input value={(profile.designation as string) ?? ""} onChange={(e) => setP("designation", e.target.value)} /></div>
              )}

              {needsBar && (
                <Section title="Bar Council enrolment" note="We verify enrolment before marking your profile as Verified.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label>Enrolment number</Label><Input value={(profile.bar_enrolment_no as string) ?? ""} onChange={(e) => setP("bar_enrolment_no", e.target.value)} placeholder="D/1234/2015" className="font-mono" /></div>
                    <div><Label>Year of enrolment</Label><Input inputMode="numeric" value={(profile.enrolment_year as string) ?? ""} onChange={(e) => setP("enrolment_year", e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
                    <div className="sm:col-span-2"><Label>State Bar Council</Label>
                      <Select value={(profile.state_bar_council as string) ?? ""} onChange={(e) => setP("state_bar_council", e.target.value)}>
                        <option value="">Select…</option>{BAR_COUNCILS.map((b) => <option key={b}>{b}</option>)}
                      </Select></div>
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={!!profile.is_aor} onChange={(e) => setP("is_aor", e.target.checked)} className="accent-[var(--brand)]" />
                    I am an Advocate-on-Record (Supreme Court)
                  </label>
                  {!!profile.is_aor && <div className="mt-3 sm:w-1/2"><Label>AOR code</Label><Input value={(profile.aor_code as string) ?? ""} onChange={(e) => setP("aor_code", e.target.value)} className="font-mono" /></div>}
                  <div className="mt-4"><Label hint="optional">Practice areas</Label><Chips options={PRACTICE} value={(profile.practice_areas as string[]) ?? []} onToggle={(v) => toggle("practice_areas", v)} /></div>
                  <div className="mt-4"><Label hint="optional">Courts</Label><Chips options={COURTS} value={(profile.courts as string[]) ?? []} onToggle={(v) => toggle("courts", v)} /></div>
                </Section>
              )}

              {mode === "create" && type === "student" && (
                <Section title="College" note="Student accounts are verified using your college email or ID card.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><Label>College / university</Label><Input value={(profile.college as string) ?? ""} onChange={(e) => setP("college", e.target.value)} placeholder="e.g. NLU Delhi" /></div>
                    <div><Label>Course</Label>
                      <Select value={(profile.course as string) ?? ""} onChange={(e) => setP("course", e.target.value)}>
                        <option value="">—</option>{["BA LLB (5 yr)", "BBA LLB (5 yr)", "LLB (3 yr)", "LLM", "PhD"].map((c) => <option key={c}>{c}</option>)}
                      </Select></div>
                    <div><Label>Year</Label>
                      <Select value={(profile.year as string) ?? ""} onChange={(e) => setP("year", e.target.value)}>
                        <option value="">—</option>{["1", "2", "3", "4", "5"].map((y) => <option key={y}>{y}</option>)}
                      </Select></div>
                    <div><Label hint="optional">College email</Label><Input type="email" value={(profile.college_email as string) ?? ""} onChange={(e) => setP("college_email", e.target.value)} /></div>
                    <div><Label hint="optional">Student ID</Label><Input value={(profile.student_id as string) ?? ""} onChange={(e) => setP("student_id", e.target.value)} /></div>
                  </div>
                </Section>
              )}

              {mode === "create" && type === "individual" && (
                <Section title="Where you live" note="Optional. It helps show the right courts and free legal aid office for you.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label hint="optional">City / district</Label><Input value={(profile.city as string) ?? ""} onChange={(e) => setP("city", e.target.value)} /></div>
                    <div><Label hint="optional">State</Label>
                      <Select value={(profile.state as string) ?? ""} onChange={(e) => setP("state", e.target.value)}>
                        <option value="">—</option>{STATES.map((x) => <option key={x}>{x}</option>)}
                      </Select></div>
                  </div>
                </Section>
              )}

              {error && <Alert tone="bad">{error}</Alert>}
            </div>
            <Nav onBack={() => setStep(mode === "join" ? "invite" : "type")}
              onNext={() => { const err = detailsValid(); if (err) setError(err); else { setError(null); setStep("consent"); } }} />
          </Panel>
        )}

        {step === "consent" && (
          <Panel title="Before you start" sub="Please read and confirm.">
            <div className="space-y-3">
              <ConsentBox checked={consent} onChange={setConsent} title="Data protection consent">
                I consent to Nyay Apex processing my personal data and the case documents I upload to provide this service, under the
                Digital Personal Data Protection Act, 2023. Documents are stored in India, used only for my account, and never used to train AI models.
              </ConsentBox>
              {type === "individual" && mode === "create" ? (
                <ConsentBox checked={aiAck} onChange={setAiAck} title="Information, not legal advice">
                  Nyay Apex explains legal papers and the law in simple words using AI. It is general information, not legal advice; it does not
                  say how my case will end, and AI can make mistakes. I will check with an advocate or free legal aid before acting on it.
                </ConsentBox>
              ) : (
                <ConsentBox checked={aiAck} onChange={setAiAck} title="AI is an assistant, not counsel">
                  AI output (research, briefs, drafts) is advisory and may contain errors. I will verify every fact and authority before relying on it,
                  I remain responsible for anything I file, and I will disclose AI assistance to the Court where required
                  (draft SC Regulations for Use of AI in Courts, 2026, Regs. 8 &amp; 43).
                </ConsentBox>
              )}
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <div><Label>Language</Label>
                  <Select value={prefs.language} onChange={(e) => setPrefs({ ...prefs, language: e.target.value })}>
                    <option value="en">English</option><option value="hi">हिन्दी (Hindi)</option>
                  </Select></div>
                {type !== "individual" && <div><Label>Preferred citation format</Label>
                  <Select value={prefs.citation_pref} onChange={(e) => setPrefs({ ...prefs, citation_pref: e.target.value })}>
                    <option value="SCC">SCC</option><option value="AIR">AIR</option><option value="MANU">MANU</option>
                  </Select></div>}
              </div>
              {error && <Alert tone="bad">{error}</Alert>}
            </div>
            <Nav onBack={() => setStep("details")} onNext={submit} nextLabel="Create account" disabled={!consent || !aiAck} loading={loading} />
          </Panel>
        )}

        {step === "team" && <TeamStep type={effectiveType} onDone={finish} />}
      </div>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 text-sm font-semibold text-ink">{title}</div>
      {children}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Chips({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onToggle(o)}
          className={clsx("rounded-full border px-3 py-1 text-xs transition",
            value.includes(o) ? "border-brand bg-brand text-brand-ink" : "border-line text-ink-2 hover:border-brand/40")}>{o}</button>
      ))}
    </div>
  );
}

function ConsentBox({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: ReactNode }) {
  return (
    <label className={clsx("flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition", checked ? "border-brand bg-brand/5" : "border-line")}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{children}</p>
      </div>
    </label>
  );
}

function Nav({ onBack, onNext, nextLabel = "Continue", disabled, loading }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; disabled?: boolean; loading?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      {onBack ? <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" />Back</Button> : <span />}
      <Button onClick={onNext} disabled={disabled} loading={loading}>{nextLabel}<ArrowRight className="h-4 w-4" /></Button>
    </div>
  );
}

const ROLE_OPTIONS: Record<string, { id: string; label: string }[]> = {
  firm: [{ id: "aor", label: "Advocate-on-Record" }, { id: "senior", label: "Senior Advocate" }, { id: "junior", label: "Junior Advocate" }, { id: "clerk", label: "Clerk" }],
  corporate: [{ id: "gc", label: "General Counsel" }, { id: "counsel", label: "Legal Counsel" }, { id: "paralegal", label: "Paralegal" }],
};

function TeamStep({ type, onDone }: { type: AccountType | null; onDone: () => void }) {
  const roles = ROLE_OPTIONS[type ?? "firm"] ?? ROLE_OPTIONS.firm;
  const [rows, setRows] = useState([{ name: "", phone: "", role: roles[0].id }]);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendInvites() {
    setLoading(true); setError(null);
    const ok: string[] = [];
    for (const r of rows.filter((r) => r.phone.trim())) {
      try {
        await api("/api/team/invites", { method: "POST", json: { name: r.name, role: r.role, ...inviteContact(r.phone) } });
        ok.push(r.name || r.phone);
      } catch (e) { setError(`${r.name || r.phone}: ${(e as Error).message}`); }
    }
    setAdded((a) => [...a, ...ok]);
    setRows([{ name: "", phone: "", role: roles[0].id }]);
    setLoading(false);
  }

  return (
    <Panel title="Add your team" sub="Invite colleagues by mobile number or email. They join automatically when they log in with that number or email. You can do this later from Team & Roles.">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
            <Input placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <Input placeholder="Mobile or email" value={r.phone} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
            <Select className="col-span-2 sm:col-span-1" value={r.role} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}>
              {roles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
            <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1} className="row-start-1 col-start-3 sm:col-start-4">
              <Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRows([...rows, { name: "", phone: "", role: roles[0].id }])}><Plus className="h-4 w-4" />Add row</Button>
          <Button onClick={sendInvites} loading={loading} disabled={!rows.some((r) => r.phone.trim())}><Briefcase className="h-4 w-4" />Save invites</Button>
        </div>
        {added.length > 0 && <Alert tone="good">Invited: {added.join(", ")}. Ask them to log in at Nyay Apex with that number or email.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
      <div className="mt-8 flex justify-end">
        <Button onClick={onDone}>{added.length ? "Go to dashboard" : "Skip for now"}<ArrowRight className="h-4 w-4" /></Button>
      </div>
    </Panel>
  );
}

function ClientOnboarding({ invites, onNotClient }: {
  invites: { id: number; matter: string; firm: string; name: string }[]; onNotClient: () => void;
}) {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const [name, setName] = useState(invites[0]?.name || user?.name || "");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setLoading(true); setError(null);
    try {
      await api("/api/auth/onboarding", { method: "POST", json: { mode: "client", name: name.trim(), language, consent } });
      const me = await refresh();
      router.replace(homeFor(me));
    } catch (e) { setError((e as Error).message); setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-8">
        <Logo className="h-9" />
        <button onClick={signOut} className="text-sm text-ink-2 hover:text-ink">Log out</button>
      </header>
      <div className="mx-auto max-w-lg px-4 py-10">
        <Panel title="Welcome to your case portal" sub="Your advocate has given you access to follow your matter.">
          <ul className="mb-6 space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <Briefcase className="h-5 w-5 text-muted" />
                <div><div className="text-sm font-medium text-ink">{i.matter}</div><div className="text-xs text-muted">{i.firm}</div></div>
              </li>
            ))}
          </ul>
          <div className="space-y-4">
            <div><Label>Your name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Language</Label>
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option></Select></div>
            <ConsentBox checked={consent} onChange={setConsent} title="Data protection consent">
              I consent to Nyay Apex processing my personal data and the documents I upload so my advocate and I can work on my matter,
              under the Digital Personal Data Protection Act, 2023. Signed in as {user?.phone ? `+91 ${user.phone}` : user?.email}.
            </ConsentBox>
            {error && <Alert tone="bad">{error}</Alert>}
            <Button className="w-full" onClick={accept} loading={loading} disabled={!consent || name.trim().length < 2}>Open my case portal</Button>
            <button onClick={onNotClient} className="w-full text-center text-xs text-muted hover:text-ink">I&apos;m an advocate, not a client — set up a professional account</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

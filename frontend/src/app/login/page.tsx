"use client";

import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, MessageCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import { useQueryParam } from "@/lib/hooks";

type Session = { user: Me };
type Done = (r: Session) => void;

const phoneDigits = (v: string) => v.replace(/\D/g, "").slice(-10);
const isPhone = (v: string) => /^[6-9]\d{9}$/.test(phoneDigits(v));
const showPhone = (d: string) => `+91 ${d.replace(/(\d{5})(\d{5})/, "$1 $2")}`;
const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(v.trim());
const isStrong = (v: string) => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
const linkCls = "font-medium text-brand hover:underline dark:text-accent";
const maskEmail = (e: string) => e.trim().replace(/^(.)[^@]*(@.*)$/, "$1***$2");
type Sent = { resend_after: number; channels?: string[] };

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const asked = useQueryParam("view");
  const [picked, setView] = useState<"login" | "register" | null>(null);
  const view = picked ?? (asked === "register" ? "register" : "login");

  const done: Done = (r) => {
    signIn(r.user);
    router.replace(homeFor(r.user));
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-side p-12 text-side-ink lg:flex">
        <Link href="/" className="block w-fit">
          <Logo on="dark" className="h-16" />
        </Link>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">Your digital co-counsel for the Supreme Court of India.</h1>
          <ul className="mt-8 space-y-3 text-sm">
            {["Plain-English research grounded in your judgments", "SLP & writ first drafts with risk flags",
              "Registry readiness check before you reach the counter", "Limitation tracking for every matter"].map((t) => (
              <li key={t} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-side-ink/50">AI output is advisory. The advocate reviews, verifies and approves everything filed.</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block w-fit lg:hidden">
            <Logo className="h-12" />
          </Link>

          <h2 className="text-2xl font-semibold text-ink">{view === "login" ? "Log in" : "Create your account"}</h2>
          <div className="mt-6">
            {view === "login" ? <LogIn onDone={done} onRegister={() => setView("register")} />
              : <Register onDone={done} onLogin={() => setView("login")} />}
          </div>

          <p className="mt-10 flex gap-2 text-xs text-muted">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Your data is processed under the Digital Personal Data Protection Act, 2023. We never see your WhatsApp messages.
          </p>
        </div>
      </div>
    </div>
  );
}

function useCountdown() {
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait]);
  return [wait, setWait] as const;
}

function CodeInput({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" aria-label="Verification code"
      className="w-full rounded-lg border border-line bg-surface px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
  );
}

function PasswordInput({ value, onChange, autoComplete, placeholder }: {
  value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
        placeholder={placeholder} className="py-2.5 pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function PhoneInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-line bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
      <span className="flex items-center border-r border-line bg-surface-2 px-3 text-sm text-ink-2">+91</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" autoComplete="tel-national" autoFocus={autoFocus}
        placeholder="98765 43210" className="w-full bg-transparent px-3 py-2.5 text-base tracking-wide text-ink placeholder:text-muted focus:outline-none" />
    </div>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
      <ArrowLeft className="h-4 w-4" /> {children}
    </button>
  );
}

function Resend({ wait, onClick }: { wait: number; onClick: () => void }) {
  return (
    <div className="text-center text-sm text-ink-2">
      {wait > 0 ? <>Resend code in {wait}s</> : <button type="button" onClick={onClick} className={linkCls}>Resend code</button>}
    </div>
  );
}

function ConfirmPassword({ password, confirm, setConfirm }: { password: string; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <div>
      <Label>Confirm password</Label>
      <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {confirm && password !== confirm && <p className="mt-1 text-xs text-bad-ink">Passwords don&apos;t match.</p>}
      {password && !isStrong(password) && <p className="mt-1 text-xs text-warn-ink">Use 8+ characters with both letters and numbers.</p>}
    </div>
  );
}

/* ------------------------------------------------------------- Log in */

function LogIn({ onDone, onRegister }: { onDone: Done; onRegister: () => void }) {
  const [method, setMethod] = useState<"password" | "whatsapp">("password");
  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
        {([["password", "Password", KeyRound], ["whatsapp", "WhatsApp code", MessageCircle]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={method === id} onClick={() => setMethod(id)}
            className={clsx("flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition",
              method === id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      <div className="mt-6">{method === "password" ? <PasswordLogin onDone={onDone} /> : <WhatsAppLogin onDone={onDone} />}</div>
      <p className="mt-6 text-center text-sm text-ink-2">
        New to Nyay Apex? <button type="button" onClick={onRegister} className={linkCls}>Create an account</button>
      </p>
    </>
  );
}

function WhatsAppLogin({ onDone }: { onDone: Done }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useCountdown();
  const [byEmail, setByEmail] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const digits = phoneDigits(phone);

  async function sendCode() {
    setLoading(true); setError(null);
    try {
      const r = await api<Sent>("/api/auth/otp/send", { method: "POST", json: { phone: digits } });
      setStep("code"); setWait(r.resend_after); setCode(""); setByEmail(!!r.channels?.includes("email"));
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  async function verify() {
    setLoading(true); setError(null);
    try { onDone(await api<Session>("/api/auth/otp/verify", { method: "POST", json: { phone: digits, code } })); }
    catch (e) { setError((e as Error).message); setLoading(false); }
  }

  if (step === "phone") return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (isPhone(phone)) sendCode(); }}>
      <p className="text-sm text-ink-2">Enter the WhatsApp number linked to your account. We&apos;ll send it a one-time code.</p>
      <div><Label>WhatsApp number</Label><PhoneInput value={phone} onChange={setPhone} autoFocus /></div>
      {error && <Alert tone="bad">{error}</Alert>}
      <Button type="submit" className="w-full py-2.5" loading={loading} disabled={!isPhone(phone)}>
        <MessageCircle className="h-4 w-4" /> Send code on WhatsApp
      </Button>
    </form>
  );

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (code.length >= 4) verify(); }}>
      <BackLink onClick={() => { setStep("phone"); setError(null); }}>Change number</BackLink>
      <p className="text-sm text-ink-2">Code sent on WhatsApp to <span className="font-medium text-ink">{showPhone(digits)}</span>
        {byEmail && <> and to your account email</>}. {byEmail && "Check the spam folder too."}</p>
      <CodeInput value={code} onChange={setCode} inputRef={codeRef} />
      {error && <Alert tone="bad">{error}</Alert>}
      <Button type="submit" className="w-full py-2.5" loading={loading} disabled={code.length < 4}>Verify &amp; continue</Button>
      <Resend wait={wait} onClick={sendCode} />
    </form>
  );
}

function PasswordLogin({ onDone }: { onDone: Done }) {
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState({ hint: "", channel: "email" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useCountdown();

  const idOk = isEmail(loginId) || isPhone(loginId);
  const id = isEmail(loginId) ? loginId.trim() : phoneDigits(loginId);
  const go = (m: typeof mode) => { setMode(m); setError(null); setPassword(""); setConfirm(""); setCode(""); };

  async function run(fn: () => Promise<void>) {
    setLoading(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  const requestCode = () => run(async () => {
    const r = await api<{ hint: string; channel: string; resend_after: number }>("/api/auth/password/forgot", { method: "POST", json: { email: id } });
    setSentTo({ hint: r.hint, channel: r.channel }); setWait(r.resend_after); setMode("reset");
  });

  const submit = () => {
    if (mode === "forgot") return requestCode();
    return run(async () => {
      if (mode === "login") onDone(await api<Session>("/api/auth/login", { method: "POST", json: { email: id, password } }));
      else onDone(await api<Session>("/api/auth/password/reset", { method: "POST", json: { email: id, code, new_password: password } }));
    });
  };

  const canSubmit = idOk && (mode === "login" ? password.length > 0
    : mode === "forgot" ? true : code.length >= 4 && isStrong(password) && password === confirm);

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(); }}>
      {mode !== "login" && <BackLink onClick={() => go("login")}>Back to log in</BackLink>}
      {mode === "forgot" && <p className="text-sm text-ink-2">We&apos;ll send a reset code to your email, or on WhatsApp if you enter your number. Check the spam folder too.</p>}

      <div>
        <Label>Email or WhatsApp number</Label>
        <Input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoFocus
          disabled={mode === "reset"} placeholder="you@chamber.in or 98765 43210" className="py-2.5" />
      </div>

      {mode === "reset" && (
        <div>
          <Label>{sentTo.channel === "email" ? "Code sent by email to" : "Code sent on WhatsApp to"} {sentTo.hint}</Label>
          <CodeInput value={code} onChange={setCode} />
        </div>
      )}

      {mode !== "forgot" && (
        <div>
          <div className="flex items-center justify-between">
            <Label>{mode === "reset" ? "New password" : "Password"}</Label>
            {mode === "login" && <button type="button" onClick={() => go("forgot")} className="mb-1.5 text-xs font-medium text-brand hover:underline dark:text-accent">Forgot password?</button>}
          </div>
          <PasswordInput value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "login" ? "" : "At least 8 characters, letters + numbers"} />
        </div>
      )}

      {mode === "reset" && <ConfirmPassword password={password} confirm={confirm} setConfirm={setConfirm} />}

      {error && <Alert tone="bad">{error}</Alert>}
      <Button type="submit" className="w-full py-2.5" loading={loading} disabled={!canSubmit}>
        {mode === "login" ? "Log in" : mode === "forgot" ? "Send reset code" : "Reset password & log in"}
      </Button>
      {mode === "reset" && <Resend wait={wait} onClick={requestCode} />}
    </form>
  );
}

/* ------------------------------------------------------------- Create account */

function Register({ onDone, onLogin }: { onDone: Done; onLogin: () => void }) {
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [channels, setChannels] = useState<string[]>(["whatsapp"]);
  const [wait, setWait] = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);

  const digits = phoneDigits(phone);
  const hasPhone = phone.trim().length > 0;
  const base = { name: name.trim(), email: email.trim(), password };
  const canSubmit = name.trim().length >= 2 && isEmail(email) && (!hasPhone || isPhone(phone)) && isStrong(password) && password === confirm;

  async function run(fn: () => Promise<void>) {
    setLoading(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  const create = (extra: { phone?: string; code?: string } = {}) => run(async () => {
    onDone(await api<Session>("/api/auth/register", { method: "POST", json: { ...base, ...extra } }));
  });

  const sendCode = () => {
    setSendFailed(false);
    return run(async () => {
      try {
        const r = await api<Sent>("/api/auth/register/start", { method: "POST", json: { ...base, phone: digits } });
        setStep("code"); setWait(r.resend_after); setCode(""); setChannels(r.channels ?? ["whatsapp"]);
        setTimeout(() => codeRef.current?.focus(), 50);
      } catch (e) {
        if ((e as { status?: number }).status === 502) setSendFailed(true);
        throw e;
      }
    });
  };

  // A number is saved only after its code is verified; without one the account is created and it can be added from the profile.
  const skipNumber = (
    <button type="button" onClick={() => create()} disabled={loading} className={clsx(linkCls, "disabled:opacity-50")}>Create account without WhatsApp number</button>
  );

  if (step === "code") return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (code.length >= 4) create({ phone: digits, code }); }}>
      <BackLink onClick={() => { setStep("form"); setError(null); }}>Back</BackLink>
      <p className="text-sm text-ink-2">Enter the code sent to{" "}
        {channels.includes("whatsapp") && <>WhatsApp <span className="font-medium text-ink">{showPhone(digits)}</span></>}
        {channels.length > 1 && " and "}
        {channels.includes("email") && <>email <span className="font-medium text-ink">{maskEmail(email)}</span></>}.
        {channels.includes("email") && " It is the same code; check the email spam folder too."}</p>
      <CodeInput value={code} onChange={setCode} inputRef={codeRef} />
      {error && <Alert tone="bad">{error}</Alert>}
      <Button type="submit" className="w-full py-2.5" loading={loading} disabled={code.length < 4}>Verify &amp; create account</Button>
      <Resend wait={wait} onClick={sendCode} />
      <div className="border-t border-line pt-4 text-center text-sm text-ink-2">
        <p className="mb-1">Didn&apos;t get the code?</p>
        {skipNumber}
        <p className="mt-1 text-xs text-muted">You can add your number later from your profile.</p>
      </div>
    </form>
  );

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!canSubmit) return; if (hasPhone) sendCode(); else create(); }}>
      <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus placeholder="Adv. Priya Sharma" className="py-2.5" /></div>
      <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@chamber.in" className="py-2.5" /></div>
      <div>
        <Label hint="for login and alerts">WhatsApp number</Label>
        <PhoneInput value={phone} onChange={setPhone} />
        {hasPhone && !isPhone(phone) ? <p className="mt-1 text-xs text-warn-ink">Enter a 10-digit Indian mobile number.</p>
          : <p className="mt-1 text-xs text-muted">We&apos;ll verify it with a code. You can also add it later from your profile.</p>}
      </div>
      <div><Label>Password</Label><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters, letters + numbers" /></div>
      <ConfirmPassword password={password} confirm={confirm} setConfirm={setConfirm} />
      {error && <Alert tone="bad">{error}</Alert>}
      {sendFailed && <p className="text-center text-sm">{skipNumber}</p>}
      <Button type="submit" className="w-full py-2.5" loading={loading} disabled={!canSubmit}>
        {hasPhone ? <><MessageCircle className="h-4 w-4" /> Continue &amp; verify number</> : "Create account"}
      </Button>
      <p className="text-center text-sm text-ink-2">Already have an account? <button type="button" onClick={onLogin} className={linkCls}>Log in</button></p>
    </form>
  );
}

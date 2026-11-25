"use client";

import { BellRing, CalendarDays, CheckCircle2, Copy, KeyRound, Mail, MessageCircle, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Label, PageHeader, Select } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Msg = { tone: "good" | "bad"; text: string } | null;

export default function AccountPage() {
  const { user, refresh } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Login & Security" subtitle="Ways to sign in, password, and profile preferences." />
      <div className="grid gap-6 lg:grid-cols-2">
        <PasswordCard user={user} onSaved={refresh} />
        <PhoneCard user={user} onSaved={refresh} />
        <ProfileCard user={user} onSaved={refresh} />
        {user.kind !== "client" && <CalendarCard />}
        <AlertsCard user={user} onSaved={refresh} />
      </div>
    </>
  );
}

function PasswordCard({ user, onSaved }: { user: Me; onSaved: () => Promise<unknown> }) {
  const [email, setEmail] = useState(user.email ?? "");
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const strong = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api("/api/auth/password", { method: "POST", json: { email: user.has_password ? undefined : email, current_password: current || undefined, new_password: pw } });
      await onSaved();
      setMsg({ tone: "good", text: user.has_password ? "Password changed." : "Email login added. You can now sign in with email and password." });
      setCurrent(""); setPw(""); setConfirm("");
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setSaving(false);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted" />Email &amp; password</span>}>
      <div className="space-y-3">
        {user.has_password ? (
          <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 className="h-4 w-4 text-good-ink" />Signs in as <b>{user.email}</b></p>
        ) : (
          <>
            <p className="text-sm text-ink-2">Add an email and password as a second way to sign in.</p>
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
          </>
        )}
        {user.has_password && <div><Label>Current password</Label><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></div>}
        <div><Label>{user.has_password ? "New password" : "Password"}</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="8+ characters, letters + numbers" /></div>
        <div><Label>Confirm</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
        {confirm && pw !== confirm && <p className="text-xs text-bad-ink">Passwords don&apos;t match.</p>}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button onClick={save} loading={saving} disabled={!strong || pw !== confirm || (!user.has_password && !email) || (user.has_password && !current)}>
          <KeyRound className="h-4 w-4" />{user.has_password ? "Change password" : "Add email login"}
        </Button>
      </div>
    </Card>
  );
}

function PhoneCard({ user, onSaved }: { user: Me; onSaved: () => Promise<unknown> }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  async function step() {
    setSaving(true); setMsg(null);
    try {
      if (!sent) { await api("/api/auth/phone", { method: "POST", json: { phone } }); setSent(true); }
      else {
        await api("/api/auth/phone", { method: "POST", json: { phone, code } }); await onSaved();
        setChanging(false); setSent(false); setPhone(""); setCode("");
        setMsg({ tone: "good", text: "WhatsApp number saved." });
      }
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setSaving(false);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-muted" />WhatsApp number</span>}>
      {user.phone && !changing ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 className="h-4 w-4 text-good-ink" />Linked: <b>+91 {user.phone}</b></p>
          <p className="text-sm text-ink-2">You can sign in with a WhatsApp code or use this number with your password.</p>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button variant="secondary" onClick={() => { setChanging(true); setMsg(null); }}>Change number</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">{changing ? "Enter the new number. It replaces the current one once its code is verified." : "Link a WhatsApp number to sign in with a code and to reset your password if you forget it."}</p>
          <div><Label>Mobile</Label><Input inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} placeholder="98765 43210" /></div>
          {sent && <div><Label>Code sent on WhatsApp</Label><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono tracking-widest" /></div>}
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button onClick={step} loading={saving} disabled={!sent ? phone.replace(/\D/g, "").length < 10 : code.length < 4}>
            {sent ? "Verify & save" : "Send code"}
          </Button>
          {changing && <Button variant="ghost" onClick={() => { setChanging(false); setSent(false); setPhone(""); setCode(""); setMsg(null); }}>Cancel</Button>}
        </div>
      )}
    </Card>
  );
}

function ProfileCard({ user, onSaved }: { user: Me; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: user.name, language: user.language, citation_pref: user.citation_pref });
  const [msg, setMsg] = useState<Msg>(null);
  async function save() {
    setMsg(null);
    try { await api("/api/auth/me", { method: "PATCH", json: f }); await onSaved(); setMsg({ tone: "good", text: "Saved." }); }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted" />Profile</span>}>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Language</Label>
            <Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as Me["language"] })}>
              <option value="en">English</option><option value="hi">हिन्दी</option>
            </Select></div>
          <div><Label>Citation format</Label>
            <Select value={f.citation_pref} onChange={(e) => setF({ ...f, citation_pref: e.target.value as Me["citation_pref"] })}>
              <option>SCC</option><option>AIR</option><option>MANU</option>
            </Select></div>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button onClick={save} disabled={f.name.trim().length < 2}>Save</Button>
      </div>
    </Card>
  );
}

/** Secret iCalendar link: hearings, limitation dates and the user's task due dates in Google / Outlook / Apple Calendar. */
function CalendarCard() {
  const [cal, setCal] = useState<{ url: string | null; show_titles: boolean } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { api<{ url: string | null; show_titles: boolean }>("/api/calendar/link").then(setCal).catch((e) => setMsg({ tone: "bad", text: e.message })); }, []);
  const set = (json: object, method = "POST") => api<{ url: string | null; show_titles: boolean }>("/api/calendar/link", { method, json })
    .then((r) => { setCal(r); setMsg(null); }).catch((e) => setMsg({ tone: "bad", text: e.message }));

  return (
    <Card title={<span id="calendar" className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted" />Calendar (Google / Outlook)</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-ink-2">Subscribe once and every hearing date, limitation date and task due to you appears in your calendar, updated every few hours.</p>
        {cal?.url ? (
          <>
            <div className="flex gap-2"><Input readOnly value={cal.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button variant="secondary" title="Copy" onClick={() => navigator.clipboard.writeText(cal.url!).then(() => setMsg({ tone: "good", text: "Link copied." }))}><Copy className="h-4 w-4" /></Button></div>
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">
              <li><b>Google Calendar:</b> Other calendars → + → From URL → paste.</li>
              <li><b>Outlook:</b> Add calendar → Subscribe from web → paste.</li>
              <li><b>iPhone:</b> Settings → Calendar → Accounts → Add Subscribed Calendar.</li>
            </ul>
            <label className="flex items-start gap-2 text-ink">
              <input type="checkbox" className="mt-1" checked={cal.show_titles} onChange={(e) => set({ show_titles: e.target.checked })} />
              <span>Show matter names in events<span className="block text-xs text-muted">Off: events show only the case or diary number. Names then reach Google / Microsoft.</span></span>
            </label>
            <p className="text-xs text-muted">Anyone with this link can see these dates. If it is shared by mistake, make a new link.</p>
            <div className="flex gap-2"><Button variant="secondary" onClick={() => set({ regenerate: true })}>Make a new link</Button>
              <Button variant="ghost" onClick={() => set({}, "DELETE")}>Turn off</Button></div>
          </>
        ) : <Button onClick={() => set({})} disabled={!cal}>Create calendar link</Button>}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </Card>
  );
}

function AlertsCard({ user, onSaved }: { user: Me; onSaved: () => Promise<unknown> }) {
  const on = user.profile?.whatsapp_alerts !== false;
  const mailOn = user.profile?.email_alerts === true;
  const [msg, setMsg] = useState<Msg>(null);
  async function toggle(v: boolean) {
    try { await api("/api/auth/me", { method: "PATCH", json: { whatsapp_alerts: v } }); await onSaved(); setMsg({ tone: "good", text: v ? "WhatsApp alerts on." : "WhatsApp alerts off. You still see every alert in the app." }); }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  }
  async function toggleMail(v: boolean) {
    try { await api("/api/auth/me", { method: "PATCH", json: { email_alerts: v } }); await onSaved(); setMsg({ tone: "good", text: v ? "Email alerts on." : "Email alerts off." }); }
    catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4 text-muted" />Alerts</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-ink-2">In the app you always see every update. On WhatsApp you get only the important ones: a cause-list listing, a hearing date change, the evening-before hearing reminder, limitation 7/3/1 days ahead, tasks assigned or due, and @mentions.</p>
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} disabled={!user.phone} />
          Send these alerts on WhatsApp{user.phone ? ` to +91 ${user.phone}` : ""}
        </label>
        {!user.phone && <p className="text-xs text-muted">Link a WhatsApp number above first.</p>}
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={mailOn} onChange={(e) => toggleMail(e.target.checked)} disabled={!user.email} />
          Also send them by email{user.email ? ` to ${user.email}` : ""}
        </label>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </Card>
  );
}

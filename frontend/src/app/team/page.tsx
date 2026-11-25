"use client";

import { Clock, Trash2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Spinner, fmtDate } from "@/components/ui";
import { api, contactOf, inviteContact } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Member { id: number; name: string; phone: string | null; email: string | null; role: string; role_label: string; verification: string; last_login_at: string | null }
interface Team {
  workspace: { id: number; name: string; type: string };
  roles: { id: string; label: string }[];
  members: Member[];
  invites: { id: number; phone: string | null; email: string | null; name: string; role: string; role_label: string; created_at: string }[];
  can_manage: boolean;
  settings: { junior_scope: "assigned" | "all" };
}

const VERIFY_TONE = { verified: "good", pending: "warn", rejected: "bad" } as const;

export default function TeamPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", role: "" });
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api<Team>("/api/team").then((t) => { setTeam(t); setForm((f) => ({ ...f, role: f.role || t.roles[0]?.id || "" })); })
    .catch((e) => setMsg({ tone: "bad", text: e.message })), []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    setSaving(true); setMsg(null);
    try {
      await api("/api/team/invites", { method: "POST", json: { name: form.name, role: form.role, ...inviteContact(form.phone) } });
      setMsg({ tone: "good", text: `Invited ${form.name || form.phone}. They join by logging in with this number / email.` });
      setForm({ name: "", phone: "", role: form.role });
      load();
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
    setSaving(false);
  }

  if (!team) return msg ? <Alert tone="bad">{msg.text}</Alert> : <Spinner />;

  return (
    <>
      <PageHeader title="Team & Roles" subtitle={`${team.workspace.name} · ${team.members.length} member(s)`} />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title="Members" pad={false}>
            <ul className="divide-y divide-line">
              {team.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-ink-2">
                    {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium text-ink">
                      {m.name}{m.id === user?.id && <span className="text-xs font-normal text-muted">(you)</span>}
                      {m.verification in VERIFY_TONE && <Badge tone={VERIFY_TONE[m.verification as keyof typeof VERIFY_TONE]}>{m.verification}</Badge>}
                    </div>
                    <div className="text-xs text-muted">{contactOf(m)} · last login {m.last_login_at ? fmtDate(m.last_login_at) : "never"}</div>
                  </div>
                  {team.can_manage && m.id !== user?.id ? (
                    <div className="flex items-center gap-1">
                      <Select value={m.role} className="w-44 py-1.5"
                        onChange={async (e) => { await api(`/api/team/members/${m.id}`, { method: "PATCH", json: { role: e.target.value } }); load(); }}>
                        {team.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </Select>
                      <Button variant="danger" title="Remove from team"
                        onClick={async () => { if (confirm(`Remove ${m.name}? They lose access immediately.`)) { await api(`/api/team/members/${m.id}`, { method: "DELETE" }); load(); } }}>
                        <Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ) : <Badge tone="brand">{m.role_label}</Badge>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`Pending invites (${team.invites.length})`} pad={false}>
            {team.invites.length ? (
              <ul className="divide-y divide-line">
                {team.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                    <Clock className="h-4 w-4 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{i.name || contactOf(i)}</div>
                      <div className="text-xs text-muted">{contactOf(i)} · {i.role_label} · invited {fmtDate(i.created_at)}</div>
                    </div>
                    {team.can_manage && (
                      <Button variant="danger" title="Cancel invite" onClick={async () => { await api(`/api/team/invites/${i.id}`, { method: "DELETE" }); load(); }}>
                        <Trash2 className="h-4 w-4" /></Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Users} title="No pending invites" />}
          </Card>
        </div>

        <div className="space-y-6">
        {team.can_manage && (
          <Card title="Matter visibility">
            <p className="mb-3 text-sm text-ink-2">Advocates-on-Record, seniors and admins always see every matter. Juniors, clerks and paralegals see:</p>
            {(["assigned", "all"] as const).map((v) => (
              <label key={v} className="mb-2 flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="scope" checked={team.settings.junior_scope === v} className="mt-1 accent-[var(--brand)]"
                  onChange={async () => { await api("/api/team/settings", { method: "PATCH", json: { junior_scope: v } }); load(); }} />
                <span>{v === "assigned" ? "Only matters they are added to (recommended)" : "Every matter in the chamber"}</span>
              </label>
            ))}
          </Card>
        )}
        {team.can_manage ? (
          <Card title="Invite a member">
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Mobile or email</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210 or name@firm.in" /></div>
              <div><Label>Role</Label>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {team.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select></div>
              <Button className="w-full" onClick={invite} loading={saving} disabled={!form.phone.trim()}><UserPlus className="h-4 w-4" />Invite</Button>
              <p className="text-xs text-muted">No message is sent automatically — tell them to log in at Nyay Apex with this number or email.</p>
            </div>
          </Card>
        ) : <Alert tone="info">Only the account admin can invite or change members.</Alert>}
        </div>
      </div>
    </>
  );
}

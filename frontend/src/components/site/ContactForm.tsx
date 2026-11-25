"use client";

import { CheckCircle2, Send } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

const TOPICS = [
  ["demo", "A walk-through of Nyay Apex"],
  ["pilot", "A pilot for my chamber / firm"],
  ["support", "Help with my account"],
  ["partnership", "Partnership"],
  ["privacy", "Privacy or data request"],
  ["other", "Something else"],
];

export function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", phone: "", organisation: "", topic: "demo", message: "", website: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const ready = f.name.trim().length > 1 && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(f.email.trim()) && f.message.trim().length >= 10;

  async function submit() {
    setBusy(true); setError(null);
    try { await api("/api/public/contact", { method: "POST", json: f }); setSent(true); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (sent) return (
    <div className="rounded-2xl border border-good/40 bg-good/10 p-6 text-ink">
      <CheckCircle2 className="h-6 w-6 text-good-ink" />
      <p className="mt-3 font-medium">Thank you — we have your message.</p>
      <p className="mt-1 text-sm text-ink-2">We will reply to {f.email}.</p>
    </div>
  );

  return (
    <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>Name</Label><Input value={f.name} onChange={set("name")} autoComplete="name" required /></div>
        <div><Label>Email</Label><Input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></div>
        <div><Label hint="optional">Mobile</Label><Input value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" /></div>
        <div><Label hint="optional">Chamber / firm / organisation</Label><Input value={f.organisation} onChange={set("organisation")} autoComplete="organization" /></div>
      </div>
      <div><Label>What is it about?</Label>
        <Select value={f.topic} onChange={set("topic")}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
      <div><Label>Message</Label><Textarea value={f.message} onChange={set("message")} className="min-h-32" placeholder="Tell us about your practice and what you would like to do." required /></div>
      {/* honeypot: hidden from people, filled by bots */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden"><label>Website<input tabIndex={-1} value={f.website} onChange={set("website")} autoComplete="off" /></label></div>
      <p className="text-xs text-muted">Please do not send case papers or privileged details through this form.</p>
      {error && <Alert tone="bad">{error}</Alert>}
      <Button type="submit" loading={busy} disabled={!ready}><Send className="h-4 w-4" />Send message</Button>
    </form>
  );
}

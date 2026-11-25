"use client";

import clsx from "clsx";
import { ExternalLink, Gavel, Mic, MicOff, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BriefPack, LiveNotes } from "@/components/BriefPack";
import { ReportAI } from "@/components/ReportAI";
import { Alert, Button, Card, Empty, PageHeader, Select } from "@/components/ui";
import { api, type Case, type Source } from "@/lib/api";
import { useQueryParam } from "@/lib/hooks";

interface Answer { q: string; answer: string; sources: Source[]; at: string; ai_log_id?: number | null }

// The model sometimes adds markdown emphasis; on a big courtroom screen show plain text.
const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");

function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
      {sources.map((s, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
          <span className="font-medium text-ink">{s.document}</span>
          {(s.neutral_citation || s.scr_citation) && <span className="font-mono text-xs">{s.neutral_citation || s.scr_citation}</span>}
          <span className="text-xs">p.{s.pages[0]}{s.pages[1] !== s.pages[0] ? `–${s.pages[1]}` : ""}</span>
          {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline dark:text-accent"><ExternalLink className="h-3 w-3" />PDF</a>}
        </li>
      ))}
    </ul>
  );
}

// Minimal typing for the browser Speech Recognition API
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: (e: { error: string }) => void };

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission is blocked. Click the lock/mic icon in the address bar, allow the microphone for this site and try again.",
  "service-not-allowed": "Microphone permission is blocked. Click the lock/mic icon in the address bar, allow the microphone for this site and try again.",
  "audio-capture": "No microphone found. Check that a microphone is connected and selected in Windows sound settings.",
  "network": "Voice recognition needs internet (Chrome/Edge send audio to their speech service). Check the connection. Brave blocks this service - use Chrome or Edge.",
  "language-not-supported": "This language is not supported by the browser's speech service.",
};

export default function CourtroomPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState("en-IN");
  const rec = useRef<Rec | null>(null);
  const [level, setLevel] = useState(0);
  const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number; peak: number } | null>(null);
  const caseParam = useQueryParam("case");
  const [cases, setCases] = useState<Case[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const caseId = picked !== null ? (picked ? Number(picked) : null) : caseParam ? Number(caseParam) : null;
  useEffect(() => { api<Case[]>("/api/cases").then(setCases).catch(() => {}); }, []);

  // Live mic level, so the advocate can see whether sound reaches the browser at all
  async function startMeter() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const m = { stream, ctx, raf: 0, peak: 0 };
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const l = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        m.peak = Math.max(m.peak, l);
        setLevel(l);
        m.raf = requestAnimationFrame(tick);
      };
      tick();
      meter.current = m;
    } catch { /* recognition reports permission / device errors itself */ }
  }
  function stopMeter(): number {
    const m = meter.current;
    meter.current = null;
    setLevel(0);
    if (!m) return -1;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    m.ctx.close().catch(() => {});
    return m.peak;
  }

  async function ask(text = q) {
    if (!text.trim()) return;
    setLoading(true); setError(null);
    try {
      const r = await api<{ answer: string; sources: Source[]; ai_log_id?: number | null }>("/api/courtroom", { method: "POST", json: { query: text, case_id: caseId } });
      setHistory((h) => [{ q: text, ...r, at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) }, ...h]);
      setQ("");
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  function toggleVoice() {
    if (listening) { rec.current?.stop(); return; }
    setError(null);
    if (!window.isSecureContext) {
      setError("Voice works only on https:// or http://localhost. Open the app at http://localhost:3000.");
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setError("This browser has no voice input. Use Google Chrome or Microsoft Edge."); return; }
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true; // show words while the Bench question is being spoken
    r.continuous = true; // keep listening until the question is finished (or the mic is clicked again)
    let finalText = "";
    let silence: ReturnType<typeof setTimeout> | undefined;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setQ((finalText + interim).trim());
      clearTimeout(silence);
      if (finalText.trim() && !interim) silence = setTimeout(() => r.stop(), 1500); // 1.5 s pause = question over
    };
    r.onend = () => {
      clearTimeout(silence);
      stopMeter();
      setListening(false);
      if (finalText.trim()) ask(finalText.trim());
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      if (e.error === "no-speech") {
        const peak = meter.current?.peak ?? -1;
        setError(peak >= 0 && peak < 0.08
          ? "The microphone is sending no sound. The wrong mic may be selected or it is muted: click the mic icon in the address bar → choose the right microphone (or chrome://settings/content/microphone), and check Windows Settings → Sound → Input."
          : "Sound was heard but no words were recognised. Speak a little closer and clearly, or switch the language (English / हिंदी).");
        return;
      }
      setError(VOICE_ERRORS[e.error] ?? `Voice input failed (${e.error}).`);
    };
    rec.current = r;
    try { r.start(); setListening(true); startMeter(); }
    catch { setError("Could not start the microphone. Reload the page and try again."); }
  }

  const [latest, ...older] = history;

  return (
    <>
      <PageHeader title="Courtroom Assistant" subtitle="Answer a Bench question in seconds: authority + holding + page, nothing else. Tip: switch on Courtroom mode (top bar)." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="court-matter" className="text-sm font-medium text-ink-2">Matter being heard</label>
        <Select id="court-matter" value={caseId ? String(caseId) : ""} onChange={(e) => setPicked(e.target.value)} className="max-w-md">
          <option value="">None — search the library only</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.title}{c.next_hearing ? ` · ${c.next_hearing}` : ""}</option>)}
        </Select>
        {caseId && <span className="text-xs text-muted">Answers check this matter&apos;s record first, then the library.</span>}
      </div>

      <div className={clsx(caseId && "grid gap-6 xl:grid-cols-[1fr_26rem]")}>
      <div>
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex flex-wrap gap-2 sm:flex-nowrap">
          <button type="button" onClick={toggleVoice} aria-label="Voice query"
            className={clsx("grid h-14 w-14 shrink-0 place-items-center rounded-xl transition",
              listening ? "animate-pulse bg-bad text-white" : "bg-accent-soft text-accent hover:opacity-80")}>
            {listening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </button>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language" disabled={listening}
            className="h-14 shrink-0 rounded-xl border border-line bg-surface px-2 text-sm text-ink">
            <option value="en-IN">English</option>
            <option value="hi-IN">हिंदी</option>
          </select>
          {listening && (
            <div className="flex h-14 w-3 shrink-0 flex-col justify-end overflow-hidden rounded-full bg-surface-2" title="Microphone level">
              <div className="w-full rounded-full bg-good transition-[height] duration-75" style={{ height: `${Math.round(level * 100)}%` }} />
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={listening ? "Listening… speak now (the green bar should move)" : "e.g. Authority that a writ is not maintainable against a private body?"}
            className="order-first h-14 min-w-0 flex-1 basis-full rounded-xl border border-line bg-surface px-4 text-lg sm:order-none sm:basis-0 text-ink placeholder:text-muted focus:border-brand focus:outline-none" />
          <Button type="submit" loading={loading} disabled={!q.trim()} className="ml-auto h-14 px-5 sm:ml-0"><Send className="h-5 w-5" /></Button>
        </form>
      </Card>

      <div className="mt-6 space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {latest ? (
          <div className="rounded-xl border-2 border-accent bg-surface p-6">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{latest.at} · {latest.q}</div>
            <p className="mt-3 whitespace-pre-wrap text-xl leading-relaxed text-ink">{plain(latest.answer)}</p>
            <Sources sources={latest.sources} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">AI-generated from your library — confirm the page before reading it out.</p>
              <ReportAI feature="courtroom" excerpt={latest.answer} context={{ question: latest.q }} logId={latest.ai_log_id} />
            </div>
          </div>
        ) : <Card><Empty icon={Gavel} title="Ready for the hearing">Speak or type the Bench&apos;s question. Answers come only from judgments in your library.</Empty></Card>}

        {older.map((h, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-xs text-muted">{h.at} · {h.q}</div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{plain(h.answer)}</p>
          </div>
        ))}
        <LiveNotes caseId={caseId} />
      </div>
      </div>
      {caseId && <aside><BriefPack caseId={caseId} /></aside>}
      </div>
    </>
  );
}

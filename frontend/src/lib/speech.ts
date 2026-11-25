"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the browser Speech Recognition API
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: (e: { error: string }) => void;
};

export const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission is blocked. Click the lock/mic icon in the address bar, allow the microphone for this site and try again.",
  "service-not-allowed": "Microphone permission is blocked. Click the lock/mic icon in the address bar, allow the microphone for this site and try again.",
  "audio-capture": "No microphone found. Check that a microphone is connected and selected.",
  "network": "Voice typing needs internet (Chrome/Edge send audio to their speech service). Brave blocks this service - use Chrome or Edge.",
  "language-not-supported": "This language is not supported by the browser's speech service.",
};

/** Long-form dictation for notes: keeps listening across pauses (the browser restarts itself after silence)
 *  and hands each finished phrase to onText. Audio goes to the browser maker's speech service, not to Nyay Apex. */
export function useDictation(onText: (text: string) => void, lang: string) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const wanted = useRef(false);
  const cb = useRef(onText);
  useEffect(() => { cb.current = onText; }, [onText]);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (!window.isSecureContext) { setError("Voice typing works only on https:// or http://localhost."); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setError("This browser has no voice typing. Use Google Chrome or Microsoft Edge."); return; }
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return; // silence: onend restarts
      wanted.current = false;
      setError(VOICE_ERRORS[e.error] ?? `Voice typing failed (${e.error}).`);
    };
    r.onend = () => {
      setInterim("");
      if (wanted.current) { try { r.start(); return; } catch { /* fall through */ } }
      setListening(false);
    };
    rec.current = r;
    wanted.current = true;
    try { r.start(); setListening(true); } catch { setError("Could not start the microphone. Reload the page and try again."); }
  }, [lang]);

  useEffect(() => () => { wanted.current = false; rec.current?.stop(); }, []);
  return { listening, interim, error, start, stop };
}

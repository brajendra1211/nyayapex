"use client";

import clsx from "clsx";
import { BookMarked, FileText, Paperclip, Quote, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Select } from "@/components/ui";
import { api, type Attachment, type ChatMessage } from "@/lib/api";

const POLL_MS = 15_000;

function when(iso: string) {
  return new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ICON = { document: FileText, judgment: BookMarked, citation: Quote };

export function AttachmentChip({ a, onOpen }: { a: Attachment; onOpen?: (a: Attachment) => void }) {
  const Icon = ICON[a.type];
  return (
    <button type="button" onClick={() => onOpen?.(a)} disabled={!onOpen}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2 enabled:hover:border-brand/40">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{a.label}</span>
      {a.citation && <span className="shrink-0 font-mono text-muted">{a.citation}</span>}
    </button>
  );
}

export function Chat({ listUrl, postUrl, myId, canPost = true, placeholder, attachOptions = [], onOpenAttachment, note }: {
  listUrl: string;
  postUrl: string;
  myId: number;
  canPost?: boolean;
  placeholder?: string;
  attachOptions?: Attachment[];
  onOpenAttachment?: (a: Attachment) => void;
  note?: string;
}) {
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<ChatMessage[]>(listUrl).then(setItems).catch((e) => setError(e.message)), [listUrl]);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [items.length]);

  async function send() {
    if (!text.trim()) return;
    setSending(true); setError(null);
    try {
      const m = await api<ChatMessage>(postUrl, { method: "POST", json: { channel: listUrl.includes("channel=client") ? "client" : "team", body: text, attachments: attached } });
      setItems((xs) => [...xs, m]);
      setText(""); setAttached([]);
    } catch (e) { setError((e as Error).message); }
    setSending(false);
  }

  return (
    <div className="flex h-[32rem] flex-col">
      {note && <div className="border-b border-line px-4 py-2 text-xs text-muted">{note}</div>}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {items.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet.</p>}
        {items.map((m) => {
          const mine = m.author?.id === myId;
          return (
            <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
              <div className={clsx("max-w-[80%] rounded-2xl px-3.5 py-2.5", mine ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink")}>
                {!mine && (
                  <div className="mb-0.5 text-xs font-semibold">
                    {m.author?.name} <span className="font-normal opacity-70">· {m.author?.role_label}</span>
                  </div>
                )}
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                {m.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} onOpen={onOpenAttachment} />)}</div>
                )}
                <div className={clsx("mt-1 text-[10px]", mine ? "text-brand-ink/70" : "text-muted")}>{when(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <div className="px-4 pb-2"><Alert tone="bad">{error}</Alert></div>}
      {canPost ? (
        <div className="border-t border-line p-3">
          {attached.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attached.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <AttachmentChip a={a} />
                  <button onClick={() => setAttached(attached.filter((_, j) => j !== i))} className="text-muted hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
            {attachOptions.length > 0 && (
              <div className="relative">
                <Paperclip className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Select value="" className="w-10 cursor-pointer pl-8 pr-0 text-transparent" title="Attach a document or reference"
                  onChange={(e) => { const a = attachOptions[Number(e.target.value)]; if (a) setAttached([...attached, a]); }}>
                  <option value="">Attach…</option>
                  {attachOptions.map((a, i) => <option key={i} value={i} className="text-ink">{a.type === "judgment" ? "⚖ " : "📄 "}{a.label}</option>)}
                </Select>
              </div>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder ?? "Write a message…"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-10 flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none" />
            <Button type="submit" loading={sending} disabled={!text.trim()}><Send className="h-4 w-4" /></Button>
          </form>
        </div>
      ) : <div className="border-t border-line px-4 py-3 text-xs text-muted">Only the matter lead or a senior can write to the client.</div>}
    </div>
  );
}

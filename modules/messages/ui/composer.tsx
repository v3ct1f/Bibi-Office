import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { FileText, Music, SendHorizontal, Smile, X } from "lucide-react";
import { Button, cn, toast } from "@office/ui";
import { AttachMenu, CameraDialog, ContactDialog, EventDialog, makeSticker, PollDialog, type AttachKind } from "./attach.tsx";
import { ExpressionPanel, type Gif } from "./emoji.tsx";
import { MicButton, RecordingBar, useRecorder } from "./voice.tsx";
import { ACCEPT, errorMessage, fileType, fmtSize, MAX_FILE_BYTES } from "./shared.tsx";

/** What the composer hands to the chat to send (the chat adds the conversation). */
export type Outgoing = Record<string, unknown>;

interface Props {
  name: string;
  /** Sends one message. */
  send: (payload: Outgoing) => Promise<void>;
  /** Uploads a file into this chat and returns its id. */
  upload: (file: Blob, name: string, contentType: string, onProgress: (share: number) => void) => Promise<string>;
}

function Preview({ file }: { file: File }) {
  const [url] = useState(() => (file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null));
  useLayoutEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (url && file.type.startsWith("image/")) return <img src={url} alt="" className="size-12 shrink-0 rounded object-cover" />;
  if (url) return <video src={url} muted className="size-12 shrink-0 rounded bg-black object-cover" />;
  const Icon = file.type.startsWith("audio/") ? Music : FileText;
  return <span className="grid size-12 shrink-0 place-items-center rounded bg-surface"><Icon className="size-5 text-muted-foreground" /></span>;
}

export function Composer({ name, send, upload }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [dialog, setDialog] = useState<"camera" | "contact" | "poll" | "event" | null>(null);
  const rec = useRecorder();
  const area = useRef<HTMLTextAreaElement>(null);
  const inputs = {
    document: useRef<HTMLInputElement>(null), media: useRef<HTMLInputElement>(null), audio: useRef<HTMLInputElement>(null),
    sticker: useRef<HTMLInputElement>(null), gif: useRef<HTMLInputElement>(null),
  };
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  /** Runs one send with the busy flag and error toast; returns whether it worked. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(false); setProgress(null); }
  };
  const uploadOne = (f: Blob, fname: string, type: string) => { setProgress(0); return upload(f, fname, type, setProgress); };

  const check = (f: File | undefined) => {
    if (!f) return null;
    const type = fileType(f.name);
    if (!type) { toast.error("This kind of file can't be sent. Try a photo, video, audio, PDF, text, Word, Excel or PowerPoint file."); return null; }
    if (f.size > MAX_FILE_BYTES) { toast.error("Files can be at most 16 MB"); return null; }
    if (!f.size) { toast.error("That file is empty"); return null; }
    return f.type === type ? f : new File([f], f.name, { type });
  };
  const pickFile = (f: File | undefined) => { const ok = check(f); if (ok) { setFile(ok); area.current?.focus(); } };
  const onInput = (key: keyof typeof inputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (key === "sticker") { if (f) void newSticker(f); return; }
    pickFile(f);
  };

  const sendMain = async () => {
    if (busy || (!text.trim() && !file)) return;
    const ok = await run(async () => {
      if (file) {
        const fileId = await uploadOne(file, file.name, file.type);
        await send({ body: text.trim(), fileId });
      } else await send({ body: text });
    });
    if (ok) { setText(""); setFile(null); area.current?.focus(); }
  };
  const newSticker = async (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("Pick a picture for your sticker");
    await run(async () => {
      const s = await makeSticker(f);
      const fileId = await uploadOne(s, s.name, s.type);
      await send({ kind: "sticker", fileId });
    });
  };
  const sendVoice = async () => {
    const r = await rec.stop(true);
    if (!r) return toast.info("That recording was too short");
    await run(async () => {
      const fileId = await uploadOne(r.file, r.file.name, r.file.type);
      await send({ body: "", fileId, voice: { durationMs: Math.round(r.durationMs) } });
    });
  };
  const sendGif = (g: Gif) => void run(() => send({ kind: "gif", url: g.url, width: g.width, height: g.height, title: g.title.slice(0, 200) }));
  const sendSticker = (emoji: string) => void run(() => send({ kind: "sticker", emoji }));

  const onPick = (k: AttachKind) => {
    if (k === "camera" || k === "contact" || k === "poll" || k === "event") setDialog(k);
    else inputs[k].current?.click();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMain(); }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files][0];
    if (f) { e.preventDefault(); pickFile(new File([f], f.name || `pasted.${f.type.split("/")[1] ?? "png"}`, { type: f.type })); }
  };
  const insertEmoji = (emoji: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, at) + emoji + text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + emoji.length, at + emoji.length); });
  };
  const close = () => setDialog(null);
  const empty = !text.trim() && !file;

  return (
    <div className="relative border-t p-3">
      <input ref={inputs.document} type="file" accept={ACCEPT.documents} className="hidden" aria-label="Choose a document" onChange={onInput("document")} />
      <input ref={inputs.media} type="file" accept={ACCEPT.media} className="hidden" aria-label="Choose a photo or video" onChange={onInput("media")} />
      <input ref={inputs.audio} type="file" accept={ACCEPT.audio} className="hidden" aria-label="Choose an audio file" onChange={onInput("audio")} />
      <input ref={inputs.sticker} type="file" accept={ACCEPT.images} className="hidden" aria-label="Choose a picture for a sticker" onChange={onInput("sticker")} />
      <input ref={inputs.gif} type="file" accept=".gif" className="hidden" aria-label="Choose a GIF file" onChange={onInput("gif")} />

      {panel && (
        <ExpressionPanel onEmoji={insertEmoji} onGif={sendGif} onSticker={(s) => { sendSticker(s); setPanel(false); }}
          onNewSticker={() => { setPanel(false); inputs.sticker.current?.click(); }} onGifFile={() => inputs.gif.current?.click()} onClose={() => setPanel(false)} />
      )}
      {file && (
        <div className="mb-2 flex w-fit max-w-full items-center gap-3 rounded-md border bg-muted p-2 text-sm">
          <Preview key={`${file.name}-${file.size}-${file.lastModified}`} file={file} />
          <span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="block text-xs text-muted-foreground">{fmtSize(file.size)}{progress !== null ? ` · sending ${Math.round(progress * 100)}%` : ""}</span></span>
          {!busy && <button type="button" aria-label="Remove file" className="cursor-pointer rounded p-0.5 hover:bg-accent" onClick={() => setFile(null)}><X className="size-3.5" /></button>}
        </div>
      )}
      {progress !== null && !file && <p className="mb-2 px-2 text-xs text-muted-foreground" role="status">Sending… {Math.round(progress * 100)}%</p>}

      <div className="flex items-end gap-1 rounded-2xl border bg-background px-1.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
        {rec.state === "recording" ? (
          <RecordingBar elapsed={rec.elapsed} onCancel={() => void rec.stop(false)} onSend={() => void sendVoice()} />
        ) : (
          <>
            <AttachMenu onPick={onPick} />
            <Button variant="ghost" size="icon" data-expression-toggle className={cn("size-8 shrink-0 rounded-full", panel && "bg-accent")} aria-label="Emoji, GIFs and stickers"
              aria-expanded={panel} onClick={() => setPanel((p) => !p)}><Smile /></Button>
            <textarea ref={area} aria-label="Message" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} maxLength={10_000}
              placeholder={file ? "Add a caption" : `Message ${name}`} className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground" />
            {empty && !busy
              ? <MicButton onClick={() => void rec.start()} />
              : <Button size="icon" className="size-8 shrink-0 rounded-full" aria-label="Send" loading={busy} disabled={empty} onClick={() => void sendMain()}><SendHorizontal /></Button>}
          </>
        )}
      </div>
      <p className="mt-1 hidden px-2 text-[11px] text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line · + for files, polls and more</p>

      <CameraDialog open={dialog === "camera"} onOpenChange={(o) => !o && close()} onPhoto={(f) => { close(); pickFile(f); }} />
      <ContactDialog open={dialog === "contact"} onOpenChange={(o) => !o && close()} onSend={async (c) => { await send({ kind: "contact", ...c }); close(); }} />
      <PollDialog open={dialog === "poll"} onOpenChange={(o) => !o && close()} onSend={async (p) => { await send({ kind: "poll", ...p }); close(); }} />
      <EventDialog open={dialog === "event"} onOpenChange={(o) => !o && close()} onSend={async (ev) => { await send({ kind: "event", ...ev }); close(); }} />
    </div>
  );
}

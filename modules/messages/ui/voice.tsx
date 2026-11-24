import { useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Trash2 } from "lucide-react";
import { Button, toast } from "@office/ui";
import { fmtDuration } from "./shared.tsx";

const MAX_MS = 10 * 60_000;
/** Formats the browser can record, in order of preference, with the type the server accepts. */
const FORMATS = [
  { mime: "audio/webm;codecs=opus", type: "audio/webm", ext: "webm" },
  { mime: "audio/webm", type: "audio/webm", ext: "webm" },
  { mime: "audio/ogg;codecs=opus", type: "audio/ogg", ext: "ogg" },
  { mime: "audio/mp4", type: "audio/mp4", ext: "m4a" },
];

export interface Recording { file: File; durationMs: number }

/** Records a voice message with the microphone. */
export function useRecorder() {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const done = useRef<((r: Recording | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setState("idle"); setElapsed(0);
  };
  useEffect(() => () => { if (rec.current?.state === "recording") { done.current = null; rec.current.stop(); } cleanup(); }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast.error("This browser can't record voice messages");
    const fmt = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!fmt) return toast.error("This browser can't record voice messages");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast.error("Microphone blocked. Allow the microphone for this site in your browser, then try again."); }
    const r = new MediaRecorder(stream, { mimeType: fmt.mime });
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const durationMs = Date.now() - started.current;
      const blob = new Blob(chunks.current, { type: fmt.type });
      const cb = done.current; done.current = null;
      cleanup();
      cb?.(blob.size && durationMs > 500 ? { file: new File([blob], `voice-message.${fmt.ext}`, { type: fmt.type }), durationMs } : null);
    };
    rec.current = r;
    started.current = Date.now();
    r.start(250);
    setState("recording");
    timer.current = setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= MAX_MS) { toast.info("Voice messages can be up to 10 minutes"); r.stop(); }
    }, 200);
  };
  /** Stops and hands back the recording (null when cancelled or too short). */
  const stop = (keep: boolean) => new Promise<Recording | null>((resolve) => {
    if (!rec.current || rec.current.state !== "recording") return resolve(null);
    done.current = keep ? resolve : () => resolve(null);
    rec.current.stop();
  });
  return { state, elapsed, start, stop };
}

export function RecordingBar({ elapsed, onCancel, onSend }: { elapsed: number; onCancel: () => void; onSend: () => void }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-1" role="status" aria-label="Recording voice message">
      <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full text-destructive" aria-label="Cancel recording" onClick={onCancel}><Trash2 /></Button>
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
      <span className="flex-1 text-sm tabular-nums">{fmtDuration(elapsed)} <span className="text-muted-foreground">Recording…</span></span>
      <Button size="icon" className="size-8 shrink-0 rounded-full" aria-label="Send voice message" onClick={onSend}><SendHorizontal /></Button>
    </div>
  );
}

export const MicButton = ({ onClick }: { onClick: () => void }) => (
  <Button size="icon" variant="ghost" className="size-8 shrink-0 rounded-full" aria-label="Record voice message" onClick={onClick}><Mic /></Button>
);

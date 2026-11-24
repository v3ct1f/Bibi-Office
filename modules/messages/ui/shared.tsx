import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@office/ui";

// ── Types (mirror the API) ───────────────────────────────────────────────────
export interface Member { userId: string; name: string; email: string | null; role: "manager" | "member"; active: boolean; me: boolean }
export interface Conversation {
  id: string; kind: "direct" | "group"; name: string; members: Member[]; myRole: "manager" | "member"; createdBy: string | null;
  unread: number; lastMessageAt: string;
  lastMessage: { kind: MessageKind; senderName: string; mine: boolean; preview: string } | null;
}
export interface FileRef { id: string; name: string; contentType: string; sizeBytes: number; partCount: number }
export type MessageKind = "text" | "system" | "poll" | "event" | "contact" | "sticker" | "gif";
export interface PollData { question: string; multiple: boolean; voters: number; options: { id: string; text: string; votes: number; voters: string[]; mine: boolean }[] }
export interface EventData {
  title: string; startsAt: string; endsAt: string | null; location: string | null; description: string | null;
  going: string[]; maybe: string[]; no: string[]; myAnswer: "going" | "maybe" | "no" | null;
}
export interface ContactData { name: string; phone: string | null; email: string | null; company: string | null; jobTitle: string | null }
export interface Message {
  id: string; conversationId: string; kind: MessageKind; senderId: string | null; senderName: string; mine: boolean;
  body: string; file: FileRef | null; data: Record<string, unknown> | null; editedAt: string | null; deletedAt: string | null; createdAt: string;
}
export interface MessagePage { data: Message[]; changed: Message[]; hasMore: boolean; now: string }
export interface Person { userId: string; name: string; email: string }

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
/** Tells the menu to refresh the unread count now instead of waiting for its next check. */
export const refreshBadges = () => window.dispatchEvent(new Event("office:refresh-badges"));

// ── Formatting ───────────────────────────────────────────────────────────────
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const fmtTime = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** List timestamps: time today, weekday this week, otherwise a short date. */
export function fmtWhen(iso: string) {
  const d = new Date(iso), now = new Date();
  if (sameDay(d, now)) return fmtTime(iso);
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(d);
}
export function fmtDay(iso: string) {
  const d = new Date(iso), now = new Date();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(d);
}
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// Stable colour per person, from a small palette that works in light and dark.
const TONES = [
  "bg-sky-500/20 text-sky-700 dark:text-sky-300", "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-700 dark:text-amber-300", "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  "bg-violet-500/20 text-violet-700 dark:text-violet-300", "bg-teal-500/20 text-teal-700 dark:text-teal-300",
];
const tone = (key: string) => TONES[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length]!;

export function Avatar({ name, id, group, size = "md" }: { name: string; id: string; group?: boolean; size?: "sm" | "md" }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-semibold", size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs",
      group ? "bg-primary/15 text-primary" : tone(id))}>
      {group ? <Users className={size === "sm" ? "size-3.5" : "size-4"} /> : initials(name)}
    </span>
  );
}

/** Runs fn every `ms` while the tab is visible (and once right away when it becomes visible again). */
export function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") ref.current(); };
    const t = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

// ── Files: sent and fetched in parts of 4 MB ─────────────────────────────────
type Api = { get<T>(p: string, q?: Record<string, string | number | boolean | undefined>): Promise<T>; post<T>(p: string, b?: unknown): Promise<T>; put<T>(p: string, b?: unknown): Promise<T> };

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Downloads every part of a file and joins them into one Blob. */
export async function fetchFile(api: Api, f: FileRef): Promise<Blob> {
  const parts = await Promise.all(Array.from({ length: f.partCount || 1 }, (_, part) =>
    api.get<{ data: string }>(`/files/${f.id}`, { part }).then((r) => b64ToBytes(r.data))));
  return new Blob(parts as BlobPart[], { type: f.contentType });
}

/** Uploads a file into a chat, part by part; returns its id for the message. */
export async function uploadFile(api: Api, conversationId: string, file: Blob, name: string, contentType: string, onProgress?: (share: number) => void) {
  const up = await api.post<{ id: string; partSize: number; partCount: number }>(`/conversations/${conversationId}/uploads`, { name, contentType, sizeBytes: file.size });
  for (let i = 0; i < up.partCount; i++) {
    const chunk = new Uint8Array(await file.slice(i * up.partSize, (i + 1) * up.partSize).arrayBuffer());
    await api.put(`/uploads/${up.id}/parts/${i}`, { data: bytesToB64(chunk) });
    onProgress?.((i + 1) / up.partCount);
  }
  return up.id;
}

/** An object URL for a message's file, fetched when `enabled` (revoked when no longer shown). */
export function useFileUrl(api: Api, f: FileRef | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled || !f) return;
    let alive = true, made: string | null = null;
    fetchFile(api, f).then((b) => { if (!alive) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, f?.id]);
  return { url, error };
}

export async function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", weba: "audio/webm",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const fileType = (name: string) => EXT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const ACCEPT = {
  documents: ".pdf,.txt,.csv,.docx,.xlsx,.pptx",
  media: ".jpg,.jpeg,.png,.webp,.gif,.mp4,.m4v,.webm,.mov",
  audio: ".mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.weba",
  images: ".jpg,.jpeg,.png,.webp,.gif",
};
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const fmtDuration = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

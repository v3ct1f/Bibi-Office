import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@office/ui";

// ── Types (mirror the API) ───────────────────────────────────────────────────
export interface Member { userId: string; name: string; email: string | null; role: "manager" | "member"; active: boolean; me: boolean }
export interface Conversation {
  id: string; kind: "direct" | "group"; name: string; members: Member[]; myRole: "manager" | "member"; createdBy: string | null;
  unread: number; lastMessageAt: string;
  lastMessage: { kind: "text" | "system"; senderName: string; mine: boolean; preview: string } | null;
}
export interface FileRef { id: string; name: string; contentType: string; sizeBytes: number }
export interface Message {
  id: string; conversationId: string; kind: "text" | "system"; senderId: string | null; senderName: string; mine: boolean;
  body: string; file: FileRef | null; editedAt: string | null; deletedAt: string | null; createdAt: string;
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

/** Loads a file of a message as an object URL (images are shown inline). */
export function useFileUrl(get: () => Promise<{ data: string; contentType: string }>, enabled: boolean, key: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, made: string | null = null;
    void get().then((f) => {
      if (!alive) return;
      made = URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.contentType }));
      setUrl(made);
    }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return url;
}

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

export const FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx,.pptx";
const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const fileType = (name: string) => EXT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

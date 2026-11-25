import { cn } from "@office/ui";
import { tt } from "./i18n.ts";

// ── Types (mirror the API) ───────────────────────────────────────────────────
export interface Addr { name: string; email: string }
export interface Account { id: string; address: string; name: string; signature: string; source: "workmail" | "local"; status: "active" | "paused"; lastSyncedAt: string | null; lastSyncError?: string | null }
export interface AccountInfo {
  available: boolean; account: Account | null; limits: { maxFileBytes: number; maxTotalBytes: number; trashDays?: number };
  /** A real mail server: new mail is fetched by the server every minute. */
  background?: boolean;
  storage?: { usedBytes: number; quotaBytes: number; full: boolean } | null;
}
export interface Label { id: string; name: string; color: string }
export interface FolderInfo { key: string; unread: number; total?: number }
export interface Folders { folders: FolderInfo[]; labels: (Label & { unread: number })[] }
export interface ThreadItem {
  id: string; messageId: string; isDraft: boolean; folder: string; subject: string; snippet: string; date: string; count: number; unread: number;
  isStarred: boolean; hasAttachments: boolean; people: { name: string; email: string; me: boolean }[]; labels: Label[];
}
export interface AttachmentInfo { id: string; name: string; contentType: string; sizeBytes: number; risky: boolean }
export interface MailMessage {
  id: string; threadId: string; folder: string; isDraft: boolean; mine: boolean; from: Addr; to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; date: string;
  isRead: boolean; isStarred: boolean; snippet: string; bodyText: string; bodyHtml: string | null; hasRemoteImages: boolean; attachments: AttachmentInfo[];
  labels: Label[]; contact: { id: string; name: string } | null;
}
export interface Thread { id: string; subject: string; messages: MailMessage[] }

export const FOLDER_ORDER = ["inbox", "starred", "sent", "drafts", "spam", "archive", "trash"] as const;
export const LABEL_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export const DOT: Record<string, string> = {
  gray: "bg-gray-400", red: "bg-red-500", orange: "bg-orange-500", yellow: "bg-yellow-500", green: "bg-green-500",
  teal: "bg-teal-500", blue: "bg-blue-500", purple: "bg-purple-500", pink: "bg-pink-500",
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtListDate(iso: string): string {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d);
  if (d.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(d);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
}
export const fmtFull = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
export const displayName = (a: Addr) => a.name.trim() || a.email;

/** "Anna <anna@x.com>, bob@y.com" (also separated by ; or new lines) into addresses. Entries that aren't addresses are kept as typed so the sender can fix them. */
export function parseAddrs(text: string): Addr[] {
  return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(.*?)\s*<([^>]*)>$/.exec(s);
    return m ? { name: m[1]!.replace(/^"|"$/g, "").trim(), email: m[2]!.trim().toLowerCase() } : { name: "", email: s.toLowerCase() };
  });
}
export const addrsToText = (list: Addr[]) => list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");

const COLORS = ["bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-orange-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600", "bg-amber-600"];
export function Avatar({ name, email, size = "md" }: { name: string; email: string; size?: "sm" | "md" }) {
  const key = email || name;
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  return (
    <span aria-hidden className={cn("flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", COLORS[h % COLORS.length], size === "sm" ? "size-7 text-xs" : "size-9 text-sm")}>
      {initial}
    </span>
  );
}

export const folderName = (key: string): string => tt(key as "inbox");

// ── Attachments ──────────────────────────────────────────────────────────────
export const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error("Couldn't read the file"));
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.readAsDataURL(file);
});

/** Saves a file the person asked for. Always as a plain download (never opened in the browser), so nothing in it can run. */
export function saveFile(name: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the keyboard is typing into something (so single-letter shortcuts must stay quiet). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

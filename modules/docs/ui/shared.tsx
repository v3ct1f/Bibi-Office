import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Status = "file" | "draft" | "sent" | "completed" | "declined" | "expired" | "cancelled";
export type FieldKind = "signature" | "initials" | "date" | "name" | "text";
export interface Config {
  me: string | null; canSend: boolean; canManage: boolean; emailReady: boolean; emailMissing: string[];
  defaults: { remindEveryDays: number; expiryDays: number }; fileTypes: string[];
}
export interface DocRow {
  id: string; title: string; folder: string; visibility: "team" | "private"; status: Status; fileName: string; contentType: string; sizeBytes: number;
  pageCount: number | null; createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; sentAt: string | null;
  completedAt: string | null; expiresOn: string | null; isPdf: boolean; signers: { name: string; status: string }[]; signedCount: number; canEdit: boolean;
}
export interface SignerInfo {
  id: string; position: number; name: string; email: string; userId: string | null; contactId: string | null; status: "pending" | "signed" | "declined";
  viewedAt: string | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null; notifiedAt: string | null;
  lastRemindedAt: string | null; remindersSent: number; mailError: string | null; canSignNow: boolean; isMe: boolean; link: string | null;
}
export interface FieldInfo { id: string; signerId: string; kind: FieldKind; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null; value: string | null }
export interface DocDetail {
  id: string; title: string; folder: string; visibility: "team" | "private"; status: Status; fileName: string; contentType: string; sizeBytes: number;
  sha256: string; pageCount: number | null; isPdf: boolean; signedSha256: string | null; ordered: boolean; message: string | null; expiresOn: string | null;
  remindEveryDays: number; employeeId: string | null; employeeName: string | null; contactId: string | null; templateId: string | null; templateName: string | null;
  createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; sentAt: string | null; completedAt: string | null;
  signers: SignerInfo[]; fields: FieldInfo[];
  activity: { id: string; at: string; action: string; actorName: string | null; signerId: string | null; detail: string | null }[];
  can: { edit: boolean; setup: boolean; send: boolean; cancel: boolean; remind: boolean; delete: boolean; toRequest: boolean };
  delivery?: Record<string, { emailed: boolean; error: string | null }>;
}
export interface Template { id: string; name: string; body: string; folder: string; placeholders: string[]; updatedAt: string }
export interface TeamPerson { userId: string; name: string; email: string }
export interface Waiting { id: string; title: string; sentAt: string | null; expiresOn: string | null; createdByName: string | null; signerId: string }
export interface Summary { waitingForMe: number; outForSignature: number; drafts: number; completedThisMonth: number }

// ── Labels & formatting ──────────────────────────────────────────────────────
export const STATUS: Record<Status, { label: string; variant: "default" | "neutral" | "success" | "warning" | "destructive" | "outline" }> = {
  file: { label: "File", variant: "outline" },
  draft: { label: "Draft", variant: "neutral" },
  sent: { label: "Out for signature", variant: "warning" },
  completed: { label: "Signed", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};
export const StatusBadge = ({ status }: { status: Status }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;
export const FIELD_LABEL: Record<FieldKind, string> = { signature: "Signature", initials: "Initials", date: "Date signed", name: "Name", text: "Text" };
/** One colour per signer (boxes and chips), in order. */
export const SIGNER_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f", "#9333ea", "#475569"];
export const KNOWN_FILLINS: Record<string, string> = {
  "contact.name": "Contact's full name", "contact.firstName": "Contact's first name", "contact.lastName": "Contact's last name",
  "contact.email": "Contact's email", "contact.phone": "Contact's phone", "contact.company": "Contact's company",
  "employee.name": "Team member's name", "employee.email": "Team member's email",
  "workspace.name": "Your company's name", today: "Today's date",
};

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const today = () => new Date().toISOString().slice(0, 10);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const fileTitle = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200);
export const folderLabel = (f: string) => f || "All documents";

/** A link inside the module that navigates without a full reload. */
export function ModLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  const host = useModuleHost();
  return <a href={host.href(to)} className={className ?? "hover:underline"} onClick={(e) => { e.preventDefault(); host.navigate(to); }}>{children}</a>;
}

export const SECTIONS = [
  { to: "/docs", label: "Library" }, { to: "/docs/waiting", label: "To sign" }, { to: "/docs/templates", label: "Templates", perm: "docs:library.send" },
];
export function SectionTabs({ current }: { current: string }) {
  const host = useModuleHost();
  return (
    <nav aria-label="Docs sections" className="mb-4 flex gap-1.5 overflow-x-auto">
      {SECTIONS.filter((s) => !s.perm || host.can(s.perm)).map((s) => (
        <a key={s.to} href={host.href(s.to)} aria-current={current === s.to ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); host.navigate(s.to); }}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${current === s.to ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

// ── Data loading (modules use host.api, not the app's query cache) ───────────
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await run();
      if (n === seq.current) setState({ data, loading: false });
    } catch (error) {
      if (n === seq.current) setState({ error, loading: false });
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload, set: (data: T) => setState({ data, loading: false }) };
}
export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
/** Reads a picked file as base64 (without the data: prefix). */
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}
export const b64ToBytes = (data: string) => Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
export function downloadBase64(name: string, contentType: string, data: string) {
  const url = URL.createObjectURL(new Blob([b64ToBytes(data)], { type: contentType }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function openBase64(contentType: string, data: string) {
  const url = URL.createObjectURL(new Blob([b64ToBytes(data)], { type: contentType }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

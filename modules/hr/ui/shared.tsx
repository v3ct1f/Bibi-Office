import { useCallback, useEffect, useRef, useState } from "react";
import { useModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Employment = "full_time" | "part_time" | "temporary" | "freelance" | "intern";
export type Basis = "hourly" | "monthly" | "yearly";
export type LeaveKind = "vacation" | "sick" | "personal" | "other" | "adjustment" | "carry_over";
export type DocCategory = "contract" | "id" | "certificate" | "other";
export type ChecklistKind = "onboarding" | "offboarding" | "other";
export type TaskOwner = "employee" | "manager" | "hr";
export interface Config { me: string | null; canManage: boolean; canPay: boolean; currency: string; defaultAllowanceDays: number; departments: string[] }
export interface Person {
  userId: string; name: string; email: string; roles: string[]; jobTitle: string | null; department: string | null; managerId: string | null; managerName: string | null;
  employmentType: Employment | null; startDate: string | null; endDate: string | null; workPhone: string | null; birthday: string | null; active: boolean;
}
export interface PrivateDetails {
  birthDate: string | null; personalEmail: string | null; personalPhone: string | null; address: string | null;
  emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null;
  weeklyHours: number | null; allowanceDays: number | null; effectiveAllowance: number; notes: string | null;
}
export interface Profile extends Person {
  directReports: { userId: string; name: string }[];
  private: PrivateDetails | null;
  can: { edit: boolean; editOwn: boolean; seePay: boolean; editPay: boolean; seePrivate: boolean };
}
export interface PayEntry { id: string; effectiveFrom: string; basis: Basis; amountCents: number; currency: string; note: string | null; createdByName: string | null }
export interface LeaveSummary { allowance: number; adjustments: number; total: number; vacationTaken: number; vacationBooked: number; remaining: number; sick: number; other: number }
export interface LeaveEntry { id: string; year: number; kind: LeaveKind; days: number; startDate: string | null; endDate: string | null; source: "schedule" | "manual"; note: string | null; createdByName: string | null }
export interface DocumentInfo {
  id: string; userId: string; name: string; category: DocCategory; contentType: string; sizeBytes: number; expiresOn: string | null;
  expired: boolean; expiringSoon: boolean; uploadedByName: string | null; createdAt: string; personName?: string | null;
}
export interface TemplateItem { title: string; owner: TaskOwner; dueDays: number }
export interface Template { id: string; name: string; kind: ChecklistKind; items: TemplateItem[] }
export interface Task { id: string; title: string; ownerId: string | null; ownerName: string | null; dueDate: string | null; doneAt: string | null; doneByName: string | null; overdue: boolean }
export interface Checklist { id: string; userId: string; personName: string | null; name: string; kind: ChecklistKind; startDate: string; completedAt: string | null; done: number; total: number; tasks: Task[] }

// ── Labels & formatting ──────────────────────────────────────────────────────
export const EMPLOYMENT: Record<Employment, string> = { full_time: "Full-time", part_time: "Part-time", temporary: "Temporary", freelance: "Freelance", intern: "Intern" };
export const BASIS: Record<Basis, string> = { hourly: "per hour", monthly: "per month", yearly: "per year" };
export const LEAVE: Record<LeaveKind, string> = { vacation: "Vacation", sick: "Sick", personal: "Personal", other: "Other", adjustment: "Allowance adjustment", carry_over: "Carried over" };
export const DOC_CAT: Record<DocCategory, string> = { contract: "Contract", id: "ID", certificate: "Certificate", other: "Other" };
export const CL_KIND: Record<ChecklistKind, string> = { onboarding: "Onboarding", offboarding: "Offboarding", other: "Other" };
export const OWNER: Record<TaskOwner, string> = { employee: "The person", manager: "Their manager", hr: "HR (whoever assigns it)" };

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDayMonth = (md: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`2000-${md}T00:00:00Z`));
export function fmtMoney(cents: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
export const fmtDays = (n: number) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n)} day${Math.abs(n) === 1 ? "" : "s"}`;
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const today = () => new Date().toISOString().slice(0, 10);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
/** "1.234,50" / "1234.5" -> cents; null when invalid. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[\s'€$£]/g, "");
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  s = lastSep >= 0 && s.length - lastSep - 1 <= 2 ? `${s.slice(0, lastSep).replace(/[.,]/g, "")}.${s.slice(lastSep + 1)}` : s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "size-14 text-lg" : size === "sm" ? "size-7 text-xs" : "size-10 text-sm";
  return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary ${cls}`}>{initials(name)}</span>;
}

/** A link inside the module that navigates without a full reload. */
export function ModLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  const host = useModuleHost();
  return <a href={host.href(to)} className={className ?? "hover:underline"} onClick={(e) => { e.preventDefault(); host.navigate(to); }}>{children}</a>;
}

export const SECTIONS = [
  { to: "/people", label: "Directory" }, { to: "/people/org", label: "Org chart" }, { to: "/people/leave", label: "Leave" }, { to: "/people/checklists", label: "Checklists" },
];
export function SectionTabs({ current }: { current: string }) {
  const host = useModuleHost();
  return (
    <nav aria-label="People sections" className="mb-4 flex gap-1.5 overflow-x-auto">
      {SECTIONS.map((s) => (
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
  return { ...state, reload };
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
export function downloadBase64(name: string, contentType: string, data: string) {
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

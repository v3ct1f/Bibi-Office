import { Badge } from "@office/ui";
import type { LeaveStatus } from "./types.ts";

export const P = { directory: "hr:directory.read", request: "hr:leave.request", approve: "hr:leave.approve", manage: "hr:employees.manage" } as const;
export const ROOT = "/m/hr/people";
const lang = () => (typeof navigator !== "undefined" && navigator.language) || "en";
export const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang(), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
export const fmtShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang(), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
export const fmtRange = (a: string, b: string, half = false) => (a === b ? `${fmtShort(a)}${half ? " (half day)" : ""}` : `${fmtShort(a)} – ${fmtShort(b)}`);
export const fmtDays = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
export const todayLocal = () => new Date().toLocaleDateString("en-CA");
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
export const EMPLOYMENT: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contractor: "Contractor", intern: "Intern" };

const LABEL: Record<LeaveStatus, [string, "primary" | "neutral" | "success" | "danger" | "warning"]> = {
  requested: ["Waiting for approval", "warning"], approved: ["Approved", "success"], rejected: ["Rejected", "danger"], cancelled: ["Cancelled", "neutral"],
};
export const LeaveBadge = ({ s }: { s: LeaveStatus }) => <Badge tone={LABEL[s][1]}>{LABEL[s][0]}</Badge>;
export const Avatar = ({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) => (
  <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-primary/15 font-medium text-primary ${size === "lg" ? "h-14 w-14 text-lg" : size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"}`}>{initials(name)}</span>
);

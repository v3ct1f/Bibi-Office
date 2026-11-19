const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const fmtDateTime = (s: string | null | undefined) => (s ? dtf.format(new Date(s)) : "—");
export const fmtDate = (s: string | null | undefined) => (s ? df.format(new Date(s)) : "—");

export function fmtRelative(s: string | null | undefined): string {
  if (!s) return "—";
  const diff = (new Date(s).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [v, u]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"] : abs < 86400 ? [diff / 3600, "hour"]
      : abs < 86400 * 30 ? [diff / 86400, "day"] : abs < 86400 * 365 ? [diff / (86400 * 30), "month"] : [diff / (86400 * 365), "year"];
  return rtf.format(Math.round(v), u);
}

export const contactName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";

export const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

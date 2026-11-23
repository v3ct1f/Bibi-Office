import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import * as P from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib.ts";
import { fieldClass } from "./input.tsx";
import { Button } from "./button.tsx";

// ───────── Plain-date helpers (YYYY-MM-DD, no time zones) ─────────

const pad = (n: number) => String(n).padStart(2, "0");
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-23" -> local Date, or null when it isn't a real calendar day. */
export function parseIsoDate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s?.trim() ?? "");
  return m ? makeDate(+m[1]!, +m[2]! - 1, +m[3]!) : null;
}

function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function addMonths(d: Date, n: number) {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;
const clampIso = (iso: string, min?: string, max?: string) => (min && iso < min ? min : max && iso > max ? max : iso);

const displayFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** Same style as the rest of the app (fmtDate): "23 Nov 2026" / "Nov 23, 2026". */
export const formatDate = (iso: string) => {
  const d = parseIsoDate(iso);
  return d ? displayFmt.format(d) : "";
};

const monthNames: string[][] = (() => {
  const names: string[][] = [];
  for (const locale of [undefined, "en"]) {
    for (const month of ["long", "short"] as const) {
      const f = new Intl.DateTimeFormat(locale, { month });
      names.push(Array.from({ length: 12 }, (_, i) => f.format(new Date(2000, i, 1)).toLowerCase().replace(/\.$/, "")));
    }
  }
  return names;
})();

function monthFromWord(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  for (const list of monthNames) {
    const i = list.findIndex((n) => n === w || n.startsWith(w));
    if (i >= 0) return i;
  }
  return -1;
}

/** Day comes before month in numeric dates in this locale (e.g. 23/11/2026)? */
const dayFirst = (() => {
  const parts = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(2000, 10, 22));
  return parts.findIndex((p) => p.type === "day") < parts.findIndex((p) => p.type === "month");
})();

/** Reads what someone typed: "2026-11-23", "23 Nov 2026", "Nov 23, 2026" or "23/11/2026". "" for empty, null if unreadable. */
export function parseTypedDate(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  const iso = parseIsoDate(t);
  if (iso) return toIsoDate(iso);
  const tokens = t.split(/[\s,./-]+/).filter(Boolean);
  if (tokens.length !== 3) return null;
  let month = -1;
  const nums: string[] = [];
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) nums.push(tok);
    else if (month < 0 && (month = monthFromWord(tok)) >= 0) continue;
    else return null;
  }
  let y: string, d: string;
  if (month >= 0) {
    if (nums.length !== 2) return null;
    [d, y] = nums[0]!.length === 4 ? [nums[1]!, nums[0]!] : [nums[0]!, nums[1]!];
  } else {
    if (nums.length !== 3) return null;
    let m: string;
    if (nums[0]!.length === 4) [y, m, d] = nums as [string, string, string];
    else [d, m, y] = dayFirst ? (nums as [string, string, string]) : [nums[1]!, nums[0]!, nums[2]!];
    month = +m - 1;
  }
  if (y.length !== 4) return null;
  const date = makeDate(+y, month, +d);
  return date ? toIsoDate(date) : null;
}

// ───────── Calendar ─────────

export interface CalendarProps {
  /** Selected day, YYYY-MM-DD or "". */
  value: string;
  onSelect: (iso: string) => void;
  min?: string;
  max?: string;
  /** Move keyboard focus to the active day when the calendar appears. */
  autoFocus?: boolean;
  className?: string;
}

/** Month calendar, Monday first. Arrow keys move by day/week, PageUp/PageDown by month (with Shift: year), Home/End to week start/end. */
export function Calendar({ value, onSelect, min, max, autoFocus, className }: CalendarProps) {
  const todayIso = toIsoDate(new Date());
  const [active, setActive] = useState(() => clampIso(parseIsoDate(value) ? value : todayIso, min, max));
  const grid = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(!!autoFocus);

  const activeDate = parseIsoDate(active)!;
  const first = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
  const start = addDays(first, -mondayIndex(first));
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    const long = new Intl.DateTimeFormat(undefined, { weekday: "long" });
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(2024, 0, 1 + i); return { short: short.format(d).slice(0, 2), long: long.format(d) }; });
  }, []);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${active}"]`)?.focus();
  }, [active]);

  const inRange = (iso: string) => !(min && iso < min) && !(max && iso > max);
  const move = (d: Date) => { wantFocus.current = true; setActive(clampIso(toIsoDate(d), min, max)); };
  const prevMonthEnd = toIsoDate(addDays(first, -1));
  const nextMonthStart = toIsoDate(addMonths(first, 1));

  function onKeyDown(e: KeyboardEvent) {
    const k = e.key;
    const next =
      k === "ArrowLeft" ? addDays(activeDate, -1) : k === "ArrowRight" ? addDays(activeDate, 1)
      : k === "ArrowUp" ? addDays(activeDate, -7) : k === "ArrowDown" ? addDays(activeDate, 7)
      : k === "Home" ? addDays(activeDate, -mondayIndex(activeDate)) : k === "End" ? addDays(activeDate, 6 - mondayIndex(activeDate))
      : k === "PageUp" ? addMonths(activeDate, e.shiftKey ? -12 : -1) : k === "PageDown" ? addMonths(activeDate, e.shiftKey ? 12 : 1)
      : null;
    if (!next) return;
    e.preventDefault();
    move(next);
  }

  const shiftMonth = (n: number) => setActive(clampIso(toIsoDate(addMonths(activeDate, n)), min, max));

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" className="size-8" aria-label="Previous month" disabled={!!min && prevMonthEnd < min} onClick={() => shiftMonth(-1)}><ChevronLeft /></Button>
        <p className="text-sm font-semibold first-letter:uppercase" aria-live="polite">{monthFmt.format(activeDate)}</p>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Next month" disabled={!!max && nextMonthStart > max} onClick={() => shiftMonth(1)}><ChevronRight /></Button>
      </div>
      <div ref={grid} role="grid" aria-label={monthFmt.format(activeDate)} onKeyDown={onKeyDown} className="grid gap-0.5">
        <div role="row" className="grid grid-cols-7">
          {weekdays.map((w) => (
            <div key={w.long} role="columnheader" aria-label={w.long} className="py-1 text-center text-xs font-medium text-muted-foreground">{w.short}</div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} role="row" className="grid grid-cols-7 gap-0.5">
            {days.slice(row * 7, row * 7 + 7).map((d) => {
              const iso = toIsoDate(d);
              const outside = d.getMonth() !== activeDate.getMonth();
              const selected = iso === value;
              const isToday = iso === todayIso;
              const disabled = !inRange(iso);
              return (
                <div key={iso} role="gridcell" aria-selected={selected}>
                  <button
                    type="button"
                    data-day={iso}
                    tabIndex={iso === active ? 0 : -1}
                    disabled={disabled}
                    aria-label={fullFmt.format(d)}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onSelect(iso)}
                    onFocus={() => iso !== active && setActive(iso)}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
                      outside && "text-muted-foreground/60",
                      isToday && !selected && "font-semibold text-primary ring-1 ring-inset ring-primary/40",
                      selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────── DatePicker ─────────

export interface DatePickerProps {
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  /** Called with YYYY-MM-DD, or "" when cleared. */
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Date field in the app's style: type a date ("23 Nov 2026", "2026-11-23", "23/11/2026")
 * or pick one from the calendar button. Works with <Field> like <Input>.
 */
export function DatePicker({ value, onChange, id, name, min, max, disabled, required, placeholder, className, ...aria }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDate(value));
  const editing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing.current) setDraft(formatDate(value)); }, [value]);

  const unreadable = draft.trim() !== "" && parseTypedDate(draft) === null;
  const todayIso = toIsoDate(new Date());

  function pick(iso: string) {
    onChange(iso);
    setDraft(formatDate(iso));
    setOpen(false);
  }

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <div className={cn("relative", className)}>
          <input
            ref={input}
            id={id}
            name={name}
            type="text"
            inputMode="text"
            autoComplete="off"
            disabled={disabled}
            required={required}
            placeholder={placeholder ?? formatDate(todayIso)}
            value={draft}
            data-value={value}
            aria-label={aria["aria-label"]}
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"] || unreadable || undefined}
            className={cn(fieldClass, "h-9 pr-10")}
            onFocus={() => { editing.current = true; }}
            onBlur={() => { editing.current = false; setDraft(formatDate(value)); }}
            onChange={(e) => {
              setDraft(e.target.value);
              const iso = parseTypedDate(e.target.value);
              if (iso !== null && iso !== value) onChange(iso);
            }}
            onKeyDown={(e) => {
              if ((e.altKey && e.key === "ArrowDown") || (e.key === "Enter" && !draft.trim())) { e.preventDefault(); setOpen(true); }
            }}
          />
          <P.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Open calendar"
              className={cn(
                "absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground transition-colors",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
                open && "text-primary",
              )}
            >
              <CalendarDays className="size-4" />
            </button>
          </P.Trigger>
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[17.5rem] rounded-lg border bg-surface p-3 text-foreground shadow-lg"
        >
          <Calendar value={value} onSelect={pick} min={min} max={max} autoFocus />
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <Button variant="ghost" size="sm" disabled={!value} onClick={() => pick("")}>Clear</Button>
            <Button variant="ghost" size="sm" className="text-primary" disabled={(!!min && todayIso < min) || (!!max && todayIso > max)} onClick={() => pick(todayIso)}>Today</Button>
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

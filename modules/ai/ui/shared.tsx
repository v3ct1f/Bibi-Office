import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export interface Person { userId: string; name: string; email: string }
export interface Config {
  ready: boolean; model: string; modelLabel: string; language: string; canWrite: boolean; canManage: boolean; canCreateTasks: boolean;
  me: string | null; people: Person[]; usage: { usedThisMonth: number; limit: number } | null;
}
export type Kind = "meeting" | "ticket";
export interface Row {
  id: string; kind: Kind; title: string; visibility: "team" | "private"; meetingDate: string | null; sourceRef: string | null; sourceLabel: string | null;
  contactId: string | null; dealId: string | null; summary: string; createdBy: string | null; createdByName: string | null; createdAt: string;
  actionItemCount: number; openActionItems: number;
}
export interface ActionItem { id: string; text: string; ownerName: string | null; ownerUserId: string | null; ownerLabel: string | null; dueOn: string | null; taskId: string | null }
export interface Detail {
  id: string; kind: Kind; title: string; visibility: "team" | "private"; sourceText: string; sourceChars: number; sourceName: string | null;
  sourceRef: string | null; sourceLabel: string | null; meetingDate: string | null; attendees: { name: string; email?: string }[];
  contactId: string | null; contactName: string | null; dealId: string | null;
  summary: string; keyPoints: string[]; decisions: string[]; openQuestions: string[];
  followUpSubject: string | null; followUpBody: string | null; suggestedReply: string | null;
  model: string; inputTokens: number; outputTokens: number; edited: boolean;
  createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; canEdit: boolean; actionItems: ActionItem[];
}
export interface UsageMonth { month: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; meetings: number; tickets: number }

// ── Formatting ───────────────────────────────────────────────────────────────
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
export const fmtNum = (n: number) => new Intl.NumberFormat().format(n);
export const today = () => new Date().toISOString().slice(0, 10);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A link inside the module that navigates without a full reload. */
export function ModLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const host = useModuleHost();
  return <a href={host.href(to)} className={className ?? "hover:underline"} onClick={(e) => { e.preventDefault(); host.navigate(to); }}>{children}</a>;
}

export function SectionTabs({ current }: { current: string }) {
  const host = useModuleHost();
  const tabs = [
    { to: "/ai", label: "Meetings" }, { to: "/ai/tickets", label: "Tickets" },
    ...(host.can("ai:summary.manage") ? [{ to: "/ai/usage", label: "Usage" }] : []),
  ];
  return (
    <nav aria-label="Summaries sections" className="mb-4 flex gap-1.5 overflow-x-auto">
      {tabs.map((s) => (
        <a key={s.to} href={host.href(s.to)} aria-current={current === s.to ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); host.navigate(s.to); }}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${current === s.to ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** Shown until an owner/admin adds the API key. */
export function SetupNotice({ compact }: { compact?: boolean }) {
  const host = useModuleHost();
  const admin = host.can("core:modules.manage");
  return (
    <Card className={`flex flex-wrap items-center gap-3 border-warning/50 bg-warning/5 ${compact ? "p-3 text-sm" : "mb-4 p-4"}`} role="status">
      <Sparkles className="size-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">AI summaries aren't set up yet</p>
        <p className="text-sm text-muted-foreground">
          {admin ? "Add your company's Anthropic API key in the settings to start." : "Ask an owner or admin to add the Anthropic API key under Add features → AI summaries → Settings."}
        </p>
      </div>
      {admin && <Button size="sm" variant="outline" asChild><a href={`/t/${host.tenant.slug}/features`}>Open settings</a></Button>}
    </Card>
  );
}

/** Copies text to the clipboard and says so on the button for a moment. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); }
    catch { /* clipboard blocked: the text is visible to copy by hand */ }
  };
  return { copied, copy };
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

/** Is the CRM module on (to offer linking a deal)? */
export function useCrmOn() {
  const host = useModuleHost();
  return useLoad(async () => {
    if (!host.can("crm:deal.read")) return false;
    try {
      const mods = await host.core.get<{ key: string; enabled: boolean }[]>("/modules");
      return mods.some((m) => m.key === "crm" && m.enabled);
    } catch { return true; } // can read deals: CRM must be on
  }, [host]);
}

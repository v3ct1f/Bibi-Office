import { useState } from "react";
import { Check, Copy, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton, toast } from "@office/ui";
import { useModuleHost, type SlotProps } from "@office/ui/module-ui";
import { SummaryList } from "./List.tsx";
import { errorMessage, fmtDateTime, ModLink, SetupNotice, useCopy, useLoad, type Config, type Detail, type Row } from "./shared.tsx";

export function AiWidget(_: SlotProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Row[]>("/summaries", { kind: "meeting", limit: 3 }), [host]);
  return (
    <Card className="grid gap-2 p-4" data-testid="ai-widget">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold"><Sparkles className="size-4" /> Meeting summaries</span>
        {host.can("ai:summary.write") && <Button size="sm" variant="ghost" onClick={() => host.navigate("/ai/new")}><Plus /> New</Button>}
      </div>
      {list.error ? <p className="text-sm text-destructive">Couldn't load summaries</p> : !list.data ? <Skeleton className="h-16" />
        : list.data.length ? (
          <ul className="grid gap-1 text-sm">
            {list.data.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-2">
                <ModLink to={`/ai/${r.id}`} className="truncate hover:underline">{r.title}</ModLink>
                {r.openActionItems > 0 && <span className="shrink-0 text-xs text-muted-foreground">{r.openActionItems} to do</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No meeting summaries yet.</p>}
    </Card>
  );
}

/** Summaries linked to a contact (tab on the contact page). */
export function ContactSummariesTab({ entityId }: SlotProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Row[]>("/summaries", { contactId: entityId }), [host, entityId]);
  const create = host.can("ai:summary.write") && (
    <Button size="sm" onClick={() => host.navigate(`/ai/new?contact=${entityId}`)}><Plus /> New meeting summary</Button>
  );
  if (list.error) return <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>;
  if (!list.data) return <Card className="p-4"><Skeleton className="h-16" /></Card>;
  if (!list.data.length) return <Card><EmptyState icon={<Sparkles />} title="No summaries yet" description="Meeting and ticket summaries linked to this contact show up here." action={create} /></Card>;
  return <div className="grid gap-2">{create && <div>{create}</div>}<SummaryList rows={list.data} /></div>;
}

/** Side panel on a CRM deal: meeting summaries for it. */
export function DealSummariesPanel({ entityId, entity }: SlotProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Row[]>("/summaries", { dealId: entityId }), [host, entityId]);
  const contact = (entity?.contactId as string | null | undefined) ?? null;
  return (
    <Card className="grid gap-3 p-5 text-sm" role="group" aria-label="Meeting summaries">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4" /> Meeting summaries</h2>
        {host.can("ai:summary.write") && (
          <Button size="sm" variant="outline" onClick={() => host.navigate(`/ai/new?deal=${entityId}${contact ? `&contact=${contact}` : ""}`)}><Plus /> New</Button>
        )}
      </div>
      {list.error ? <p className="text-destructive">Couldn't load summaries</p> : !list.data ? <Skeleton className="h-10" />
        : list.data.length ? <SummaryList rows={list.data} compact />
        : <p className="text-muted-foreground">Summarise a call or meeting about this deal to keep its decisions and to-dos here.</p>}
    </Card>
  );
}

interface TicketEntity { ref?: string; subject?: string; contactId?: string | null; messages?: { kind: string; from: string; at: string; body: string }[] }

/** Side panel on a Support ticket: a short recap and a suggested reply. */
export function TicketAiPanel({ entityId, entity }: SlotProps) {
  const host = useModuleHost();
  const t = (entity ?? {}) as TicketEntity;
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const latest = useLoad(async () => {
    const rows = await host.api.get<Row[]>("/summaries", { ticketId: entityId, limit: 1 });
    return rows[0] ? host.api.get<Detail>(`/summaries/${rows[0].id}`) : null;
  }, [host, entityId]);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const canWrite = host.can("ai:summary.write");
  const messages = t.messages ?? [];

  async function summarise() {
    setBusy(true);
    try {
      const r = await host.api.post<Detail>("/summaries/ticket", {
        ticketId: entityId, label: [t.ref, t.subject].filter(Boolean).join(" ") || "Ticket", subject: t.subject ?? "",
        contactId: t.contactId ?? null, messages, companyName: host.tenant.name,
      });
      latest.set(r); toast.success("Ticket summarised");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  if (cfg.data && !cfg.data.ready) return canWrite ? <SetupNotice compact /> : null;
  if (!cfg.data || latest.loading && latest.data === undefined) return <Card className="p-4"><Skeleton className="h-10" /></Card>;
  const d = latest.data;
  // Newer messages than the summary? Offer to refresh it.
  const stale = !!d && messages.some((m) => m.at > d.createdAt);
  return (
    <Card className="grid gap-3 p-4 text-sm" role="group" aria-label="AI summary">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4" /> AI summary</p>
        {canWrite && d && <Button size="icon" variant="ghost" aria-label="Summarise again" title="Summarise again" loading={busy} onClick={() => void summarise()}><RefreshCw /></Button>}
      </div>
      {latest.error ? <p className="text-destructive">Couldn't load the summary</p> : !d ? (
        <>
          <p className="text-muted-foreground">Get a short recap of this ticket and a suggested reply.</p>
          {canWrite && <Button size="sm" loading={busy} disabled={!messages.length} onClick={() => void summarise()}><Sparkles /> Summarise</Button>}
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap">{d.summary}</p>
          {d.actionItems.length > 0 && (
            <ul className="grid list-disc gap-0.5 pl-5 text-muted-foreground" aria-label="To do">{d.actionItems.map((i) => <li key={i.id}>{i.text}</li>)}</ul>
          )}
          {d.suggestedReply && (
            <div className="grid gap-1.5">
              <p className="font-medium">Suggested reply</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">{d.suggestedReply}</p>
              <Button size="sm" variant="outline" onClick={() => void copy("reply", d.suggestedReply!)}>{copied === "reply" ? <Check /> : <Copy />} {copied === "reply" ? "Copied" : "Copy reply"}</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {stale ? "New messages since this summary. " : ""}{fmtDateTime(d.createdAt)} · <ModLink to={`/ai/${d.id}`} className="text-primary hover:underline">Open full summary</ModLink>
          </p>
        </>
      )}
    </Card>
  );
}

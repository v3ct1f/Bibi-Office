import { useState } from "react";
import {
  ArrowLeft, Building2, CalendarClock, Check, FileText, Mail, MessageSquare, Pencil, Phone, RotateCcw, Trash2, Trophy, User, Users, X,
} from "lucide-react";
import { Button, Card, ConfirmDialog, ErrorState, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger, Textarea, cn, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { LostDialog } from "./LostDialog.tsx";
import {
  coreHref, errorMessage, fmtDate, fmtDateTime, fmtMoney, StatusBadge, today, useLoad, type Activity, type DealDetail as Deal,
} from "./shared.tsx";

const KINDS = [
  { value: "note", label: "Note", icon: MessageSquare }, { value: "call", label: "Call", icon: Phone },
  { value: "meeting", label: "Meeting", icon: Users }, { value: "email", label: "Email", icon: Mail },
] as const;
const ICONS: Record<Activity["kind"], typeof Phone> = { note: MessageSquare, call: Phone, meeting: Users, email: Mail, stage: Check, system: FileText };
const PLACEHOLDER: Record<string, string> = {
  note: "What did you learn? e.g. budget, decision makers, timing…", call: "Who did you speak to and what was agreed?",
  meeting: "Who was there, and what are the next steps?", email: "What did you send or receive?",
};

/** Clickable stage bar: open stages in order, then the outcome. */
function StageBar({ deal, canWrite, onMove }: { deal: Deal; canWrite: boolean; onMove: (stageId: string) => void }) {
  const open = deal.stages.filter((s) => s.kind === "open");
  const idx = open.findIndex((s) => s.id === deal.stageId);
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Stages">
      {open.map((s, i) => {
        const done = deal.status !== "open" || i < idx, current = s.id === deal.stageId;
        return (
          <li key={s.id} className="min-w-24 flex-1">
            <button type="button" disabled={!canWrite || current} onClick={() => onMove(s.id)} aria-current={current ? "step" : undefined}
              title={canWrite && !current ? `Move to ${s.name}` : undefined}
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                current ? "bg-primary text-primary-foreground" : done ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground",
                canWrite && !current && "cursor-pointer hover:bg-primary/40",
              )}>
              {s.name}
            </button>
          </li>
        );
      })}
      <li className="min-w-24 flex-1">
        <span className={cn("block rounded-sm px-2 py-1.5 text-center text-xs font-medium",
          deal.status === "won" ? "bg-success text-white" : deal.status === "lost" ? "bg-muted-foreground/30" : "bg-muted text-muted-foreground")}>
          {deal.status === "won" ? "Won" : deal.status === "lost" ? "Lost" : "Won / lost"}
        </span>
      </li>
    </ol>
  );
}

function Composer({ dealId, onAdded }: { dealId: string; onAdded: () => void }) {
  const host = useModuleHost();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("note");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="grid gap-2" onSubmit={async (e) => {
      e.preventDefault();
      if (!body.trim()) return;
      setBusy(true);
      try { await host.api.post(`/deals/${dealId}/activities`, { kind, body: body.trim() }); setBody(""); toast.success("Added to the timeline"); onAdded(); }
      catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
    }}>
      <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <TabsList>{KINDS.map((k) => <TabsTrigger key={k.value} value={k.value}><k.icon className="size-4" /> {k.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      <Textarea aria-label="Activity" rows={3} maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={PLACEHOLDER[kind]} />
      <Button type="submit" className="justify-self-end" size="sm" loading={busy} disabled={!body.trim()}>Add {KINDS.find((k) => k.value === kind)!.label.toLowerCase()}</Button>
    </form>
  );
}

export function DealDetail({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const canWrite = host.can("crm:deal.write");
  const deal = useLoad(() => host.api.get<Deal>(`/deals/${id}`), [host, id]);
  const invoicingOn = useLoad(async () => {
    if (!host.can("core:modules.read")) return false;
    const mods = await host.core.get<{ key: string; enabled: boolean }[]>("/modules");
    return mods.some((m) => m.key === "invoicing" && m.enabled);
  }, [host]);
  const [dialog, setDialog] = useState<"lost" | "delete" | null>(null);

  if (deal.loading && !deal.data) return <><Skeleton className="h-8 w-72" /><Skeleton className="mt-6 h-96" /></>;
  if (deal.error || !deal.data) return <ErrorState error={deal.error} onRetry={() => void deal.reload()} />;
  const d = deal.data;
  const first = (kind: "open" | "won" | "lost") => d.stages.find((s) => s.kind === kind)!;

  const move = async (stageId: string, lostReason?: string | null) => {
    try {
      const r = await host.api.post<Deal>(`/deals/${d.id}/move`, { stageId, lostReason: lostReason ?? null });
      deal.set(r);
      toast.success(r.status === "won" ? "Deal won 🎉" : r.status === "lost" ? "Deal marked as lost" : `Moved to ${r.stageName}`);
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  };
  const due = d.status === "open" && d.nextStepDate && d.nextStepDate <= today();

  return (
    <>
      <a href={host.href("/deals")} onClick={(e) => { e.preventDefault(); host.navigate("/deals"); }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Deals
      </a>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{d.title} <StatusBadge status={d.status} /></span>}
        description={<span className="text-base font-semibold text-foreground tabular-nums">{fmtMoney(d.valueCents, d.currency)}</span>}
        actions={canWrite && <>
          <Button variant="ghost" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
          <Button variant="outline" onClick={() => host.navigate(`/deals/${d.id}/edit`)}><Pencil /> Edit</Button>
          {d.status === "open" ? <>
            <Button variant="outline" onClick={() => setDialog("lost")}><X /> Mark as lost</Button>
            <Button onClick={() => void move(first("won").id).catch(() => {})}><Trophy /> Mark as won</Button>
          </> : <Button variant="outline" onClick={() => void move(first("open").id).catch(() => {})}><RotateCcw /> Reopen</Button>}
        </>}
      />

      <Card className="mb-4 grid gap-3 p-4">
        <StageBar deal={d} canWrite={canWrite} onMove={(sid) => void move(sid).catch(() => {})} />
        {d.status === "open" && (
          <p className={cn("flex items-center gap-2 text-sm", due ? "text-destructive" : "text-muted-foreground")}>
            <CalendarClock className="size-4" />
            {d.nextStep ? <>Next step: <span className="font-medium text-foreground">{d.nextStep}</span>{d.nextStepDate && <> · {due ? "due " : ""}{fmtDate(d.nextStepDate)}</>}</>
              : <>No next step yet. <button type="button" className="cursor-pointer underline" onClick={() => host.navigate(`/deals/${d.id}/edit`)}>Add one</button> so this deal doesn't go quiet.</>}
          </p>
        )}
        {d.status === "won" && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-success/10 p-3 text-sm" data-testid="won-callout">
            <Trophy className="size-4 text-success" /> Won on {fmtDate(d.closedAt)}.
            {invoicingOn.data ? <>A draft invoice was created in <a className="underline" href={`/t/${host.tenant.slug}/m/invoicing/invoices?status=draft`}>Invoices</a>: check it and finalize it.</>
              : <>Turn on Invoicing in Settings → Modules to get a draft invoice for won deals automatically.</>}
          </p>
        )}
        {d.status === "lost" && <p className="text-sm text-muted-foreground">Lost on {fmtDate(d.closedAt)}{d.lostReason ? `: ${d.lostReason}` : ""}.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="grid content-start gap-4 p-5">
          <h2 className="font-semibold">Activity</h2>
          {canWrite && <Composer dealId={d.id} onAdded={() => void deal.reload()} />}
          <ol className="grid gap-3" aria-label="Timeline">
            {d.activities.map((a) => {
              const Icon = ICONS[a.kind];
              const auto = a.kind === "stage" || a.kind === "system";
              return (
                <li key={a.id} className="flex gap-3">
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", auto ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}><Icon className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("whitespace-pre-wrap break-words text-sm", auto && "text-muted-foreground")}>{a.body}</p>
                    <p className="text-xs text-muted-foreground">{auto ? "" : `${KINDS.find((k) => k.value === a.kind)?.label ?? a.kind} · `}{fmtDateTime(a.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="grid content-start gap-4">
        <Card className="grid content-start gap-4 p-5 text-sm">
          <h2 className="font-semibold">Details</h2>
          <dl className="grid gap-3">
            <div><dt className="text-xs text-muted-foreground">Company</dt><dd>{d.companyId
              ? <a className="inline-flex items-center gap-1.5 hover:underline" href={coreHref(host, "companies", d.companyId)}><Building2 className="size-3.5" />{d.companyName ?? "Company"}</a> : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{d.contactId
              ? <a className="inline-flex items-center gap-1.5 hover:underline" href={coreHref(host, "contacts", d.contactId)}><User className="size-3.5" />{d.contactName ?? "Contact"}</a> : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Stage</dt><dd>{d.stageName}{d.status === "open" && <span className="text-muted-foreground"> · {d.probability}% chance</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Expected close</dt><dd>{fmtDate(d.expectedClose)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Created</dt><dd>{fmtDate(d.createdAt)}</dd></div>
          </dl>
          {d.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap">{d.notes}</p></div>}
        </Card>
        {host.Slot && <host.Slot name="entity.sidebar:deal" entityType="deal" entityId={d.id} entity={{ title: d.title, contactId: d.contactId }} />}
        </div>
      </div>

      <LostDialog open={dialog === "lost"} onOpenChange={(o) => !o && setDialog(null)} title={d.title} onConfirm={(reason) => move(first("lost").id, reason)} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} destructive confirmLabel="Delete deal"
        title="Delete this deal?" description="The deal and its activity timeline are removed. Invoices created from it are kept. To keep a record, mark it as lost instead."
        onConfirm={async () => {
          try { await host.api.del(`/deals/${d.id}`); toast.success("Deal deleted"); host.navigate("/deals"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}

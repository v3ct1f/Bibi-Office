import { useState, type DragEvent } from "react";
import { CalendarClock, Columns3, Handshake, List, Plus, Search, Settings2, Trophy } from "lucide-react";
import {
  Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsList, TabsTrigger, cn, toast,
} from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { LostDialog } from "./LostDialog.tsx";
import {
  customerOf, errorMessage, fmtDate, goWithQuery, fmtMoney, StatusBadge, today, useDebounced, useLoad, type Board, type Deal, type Stage, type Summary,
} from "./shared.tsx";

export function SummaryCards({ summary }: { summary: Summary | undefined }) {
  if (!summary?.currencies.length) return null;
  const c = summary.currencies[0]!;
  const more = summary.currencies.length > 1 ? ` ${c.currency}` : "";
  const cards = [
    { label: `Open pipeline${more}`, value: fmtMoney(c.openCents, c.currency), sub: `${c.openCount} open deal${c.openCount === 1 ? "" : "s"}` },
    { label: "Expected (weighted)", value: fmtMoney(c.weightedCents, c.currency), sub: "Each deal × its stage's chance" },
    { label: "Won this month", value: fmtMoney(c.wonMonthCents, c.currency), sub: `${c.wonMonthCount} deal${c.wonMonthCount === 1 ? "" : "s"}` },
    { label: "Win rate", value: summary.winRate90d === null ? "—" : `${summary.winRate90d}%`, sub: "Won vs lost, last 90 days" },
  ];
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((k) => (
        <Card key={k.label} className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
          <p className="text-xs text-muted-foreground">{k.sub}</p>
        </Card>
      ))}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Plus, title: "1. Add a deal", text: "A possible sale: who it's for, what it's worth, and your next step." },
    { icon: Columns3, title: "2. Move it along", text: "Drag the card to the next stage as the conversation progresses. Log calls and notes on the deal." },
    { icon: Trophy, title: "3. Win (or lose) it", text: "Mark it won and, with Invoicing on, a draft invoice is created for you. Lost deals keep the reason." },
  ];
  return (
    <div className="grid gap-3 border-t p-4 sm:grid-cols-3">
      {steps.map((s) => (
        <div key={s.title} className="flex gap-3 rounded-md bg-muted/40 p-3">
          <s.icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div><p className="text-sm font-medium">{s.title}</p><p className="text-xs text-muted-foreground">{s.text}</p></div>
        </div>
      ))}
    </div>
  );
}

function DealCard({ deal, stages, canWrite, onOpen, onMove }: {
  deal: Deal; stages: Stage[]; canWrite: boolean; onOpen: () => void; onMove: (stageId: string) => void;
}) {
  const due = deal.status === "open" && deal.nextStepDate && deal.nextStepDate <= today();
  return (
    <div
      draggable={canWrite}
      onDragStart={(e) => { e.dataTransfer.setData("text/deal-id", deal.id); e.dataTransfer.effectAllowed = "move"; }}
      className={cn("grid gap-1.5 rounded-md border bg-surface p-3 text-sm shadow-xs", canWrite && "cursor-grab active:cursor-grabbing", deal.status !== "open" && "opacity-75")}
      data-testid="deal-card"
    >
      <button type="button" className="cursor-pointer text-left font-medium hover:underline" onClick={onOpen}>{deal.title}</button>
      {customerOf(deal) && <p className="truncate text-xs text-muted-foreground">{customerOf(deal)}</p>}
      <p className="font-semibold tabular-nums">{fmtMoney(deal.valueCents, deal.currency)}</p>
      {deal.status === "open" && deal.nextStep && (
        <p className={cn("flex items-center gap-1 text-xs", due ? "text-destructive" : "text-muted-foreground")}>
          <CalendarClock className="size-3 shrink-0" /><span className="truncate">{deal.nextStep}{deal.nextStepDate ? ` · ${fmtDate(deal.nextStepDate)}` : ""}</span>
        </p>
      )}
      {deal.status === "lost" && deal.lostReason && <p className="truncate text-xs text-muted-foreground">{deal.lostReason}</p>}
      {canWrite && (
        <Select aria-label={`Move ${deal.title}`} className="mt-1 h-7 text-xs" value={deal.stageId} onChange={(e) => onMove(e.target.value)}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.kind === "open" ? `Stage: ${s.name}` : s.kind === "won" ? `✓ ${s.name}` : `✗ ${s.name}`}</option>)}
        </Select>
      )}
    </div>
  );
}

function BoardView({ board, canWrite, onChanged }: { board: Board; canWrite: boolean; onChanged: () => void }) {
  const host = useModuleHost();
  const [over, setOver] = useState<string | null>(null);
  const [lost, setLost] = useState<{ deal: Deal; stageId: string } | null>(null);
  const stages = board.columns.map((c) => c.stage);

  const move = async (deal: Deal, stageId: string, lostReason?: string | null) => {
    if (deal.stageId === stageId) return;
    const target = stages.find((s) => s.id === stageId)!;
    if (target.kind === "lost" && lostReason === undefined) { setLost({ deal, stageId }); return; }
    try {
      await host.api.post(`/deals/${deal.id}/move`, { stageId, lostReason: lostReason ?? null });
      if (target.kind === "won") toast.success(`“${deal.title}” won 🎉`);
      else if (target.kind === "lost") toast.success(`“${deal.title}” marked as lost`);
      else toast.success(`Moved to ${target.name}`);
      onChanged();
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  };
  const drop = (e: DragEvent, stageId: string) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData("text/deal-id");
    const deal = board.columns.flatMap((c) => c.deals).find((d) => d.id === id);
    if (deal) void move(deal, stageId).catch(() => {});
  };

  return (
    <>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3" aria-label="Pipeline board">
        {board.columns.map(({ stage, deals, totals }) => (
          <section
            key={stage.id} aria-label={stage.name}
            onDragOver={(e) => { if (canWrite) { e.preventDefault(); setOver(stage.id); } }}
            onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
            onDrop={(e) => drop(e, stage.id)}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors",
              over === stage.id && "border-primary bg-primary/5",
              stage.kind === "won" && "bg-success/5", stage.kind === "lost" && "bg-muted/60",
            )}
          >
            <header className="border-b px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
                <span className="text-xs text-muted-foreground">{deals.length}</span>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {Object.entries(totals).map(([c, v]) => fmtMoney(v, c, true)).join(" · ") || "—"}
                {stage.kind === "open" && <span> · {stage.probability}% chance</span>}
                {stage.kind !== "open" && <span> · last 30 days</span>}
              </p>
            </header>
            <div className="grid min-h-24 content-start gap-2 p-2">
              {deals.map((d) => (
                <DealCard key={d.id} deal={d} stages={stages} canWrite={canWrite} onOpen={() => host.navigate(`/deals/${d.id}`)}
                  onMove={(sid) => void move(d, sid).catch(() => {})} />
              ))}
              {!deals.length && <p className="p-2 text-center text-xs text-muted-foreground">{canWrite ? "Drop deals here" : "No deals"}</p>}
            </div>
          </section>
        ))}
      </div>
      <LostDialog open={!!lost} onOpenChange={(o) => !o && setLost(null)} title={lost?.deal.title ?? ""}
        onConfirm={async (reason) => { if (lost) await move(lost.deal, lost.stageId, reason); }} />
    </>
  );
}

const LIST_FILTERS = [{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All" }] as const;

export function DealTable({ rows, onOpen, showCustomer = true }: { rows: Deal[]; onOpen: (d: Deal) => void; showCustomer?: boolean }) {
  return (
    <Table>
      <THead><TR><TH>Deal</TH>{showCustomer && <TH className="hidden md:table-cell">Customer</TH>}<TH>Stage</TH><TH className="hidden lg:table-cell">Expected close</TH><TH className="text-right">Value</TH></TR></THead>
      <TBody>
        {rows.map((d) => (
          <TR key={d.id} className="cursor-pointer" onClick={() => onOpen(d)}>
            <TD className="font-medium">{d.title}</TD>
            {showCustomer && <TD className="hidden md:table-cell text-muted-foreground">{customerOf(d) ?? "—"}</TD>}
            <TD><span className="flex items-center gap-2">{d.status === "open" ? d.stageName : <StatusBadge status={d.status} />}</span></TD>
            <TD className="hidden lg:table-cell text-muted-foreground">{fmtDate(d.expectedClose)}</TD>
            <TD className="text-right tabular-nums">{fmtMoney(d.valueCents, d.currency)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function ListView({ pipelineId }: { pipelineId: string }) {
  const host = useModuleHost();
  const [status, setStatus] = useState<(typeof LIST_FILTERS)[number]["value"]>("open");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<{ data: Deal[] }>("/deals", {
    pipelineId, limit: 200, ...(status === "all" ? {} : { status }), ...(dq ? { q: dq } : {}),
  }), [host, pipelineId, status, dq]);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <TabsList>{LIST_FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search deals" className="pl-8" placeholder="Search deals…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {list.loading && !list.data ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
        : !list.data?.data.length ? <EmptyState icon={<Handshake />} title="No deals here" />
        : <DealTable rows={list.data.data} onOpen={(d) => host.navigate(`/deals/${d.id}`)} />}
    </Card>
  );
}

export function DealBoard() {
  const host = useModuleHost();
  const canWrite = host.can("crm:deal.write");
  const [pipelineId, setPipelineId] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get("pipeline") ?? undefined);
  const [view, setView] = useState<"board" | "list">("board");
  const board = useLoad(() => host.api.get<Board>("/board", pipelineId ? { pipelineId } : undefined), [host, pipelineId]);
  const summary = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const reload = () => { void board.reload(); void summary.reload(); };
  const empty = board.data && !board.data.columns.some((c) => c.deals.length) && !summary.data?.currencies.length;

  return (
    <>
      <PageHeader
        title="Deals"
        description="Your sales pipeline: every possible sale, the stage it's in and what happens next."
        actions={<>
          {host.can("crm:pipeline.manage") && <Button variant="outline" onClick={() => host.navigate("/settings")}><Settings2 /> Pipeline settings</Button>}
          {canWrite && <Button onClick={() => (pipelineId ? goWithQuery(host, "/deals/new", { pipeline: pipelineId }) : host.navigate("/deals/new"))}><Plus /> New deal</Button>}
        </>}
      />
      <SummaryCards summary={summary.data} />
      {board.loading && !board.data ? <div className="flex gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-64" />)}</div>
        : board.error || !board.data ? <Card><ErrorState error={board.error} onRetry={() => void board.reload()} /></Card>
        : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              {board.data.pipelines.length > 1 ? (
                <Select aria-label="Pipeline" className="w-56" value={board.data.pipeline.id} onChange={(e) => setPipelineId(e.target.value)}>
                  {board.data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              ) : <p className="text-sm font-medium">{board.data.pipeline.name} pipeline</p>}
              <Tabs value={view} onValueChange={(v) => setView(v as "board" | "list")}>
                <TabsList>
                  <TabsTrigger value="board"><Columns3 className="size-4" /> Board</TabsTrigger>
                  <TabsTrigger value="list"><List className="size-4" /> List</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {empty ? (
              <Card>
                <EmptyState icon={<Handshake />} title="No deals yet"
                  description="A deal is a sale you're working on. Add your first one and move it through the stages."
                  action={canWrite && <Button onClick={() => host.navigate("/deals/new")}><Plus /> New deal</Button>} />
                <HowItWorks />
              </Card>
            ) : view === "board" ? <BoardView board={board.data} canWrite={canWrite} onChanged={reload} />
              : <ListView pipelineId={board.data.pipeline.id} />}
          </>
        )}
    </>
  );
}

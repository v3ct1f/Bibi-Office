import { useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, DatePicker, Field, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, cn } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { REASONS, fmtDateTime, fmtQty, fmtSigned, useLoad, type Movement, type Reason } from "./shared.tsx";

const PAGE = 50;
const REASON_VARIANT: Record<Reason, "success" | "neutral" | "destructive" | "outline"> = { delivery: "success", usage: "neutral", waste: "destructive", count: "outline" };

export function MovementTable({ rows, showItem = true }: { rows: Movement[]; showItem?: boolean }) {
  const host = useModuleHost();
  return (
    <Table aria-label="Stock history">
      <THead><TR>
        <TH>When</TH>{showItem && <TH>Item</TH>}<TH>Why</TH><TH className="text-right">Change</TH><TH className="text-right">Stock after</TH><TH>Note</TH><TH>By</TH>
      </TR></THead>
      <TBody>
        {rows.map((m) => (
          <TR key={m.id}>
            <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(m.at)}</TD>
            {showItem && <TD><button type="button" className="font-medium hover:underline" onClick={() => host.navigate(`/inventory/${m.itemId}`)}>{m.itemName}</button></TD>}
            <TD><Badge variant={REASON_VARIANT[m.reason]}>{m.reasonLabel}</Badge></TD>
            <TD className={cn("whitespace-nowrap text-right font-medium tabular-nums", m.delta > 0 ? "text-green-700 dark:text-green-400" : m.delta < 0 ? "text-destructive" : "")}>{fmtSigned(m.delta)} {m.unit}</TD>
            <TD className="whitespace-nowrap text-right tabular-nums">{fmtQty(m.stockAfter)} {m.unit}</TD>
            <TD className="max-w-64 text-muted-foreground">
              {m.orderNumber && m.orderId
                ? <button type="button" className="mr-1 font-medium text-foreground hover:underline" onClick={() => host.navigate(`/purchase-orders/${m.orderId}`)}>{m.orderNumber}</button> : null}
              <span className="break-words">{m.note}</span>
            </TD>
            <TD className="whitespace-nowrap text-muted-foreground">{m.actorName ?? "System"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function History(_: PageProps) {
  const host = useModuleHost();
  const [reason, setReason] = useState<Reason | "">("");
  const [itemId, setItemId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const items = useLoad(() => host.api.get<{ data: { id: string; name: string }[] }>("/items"), []);
  const query = { reason: reason || undefined, itemId: itemId || undefined, from: from || undefined, to: to || undefined };
  const list = useLoad(() => host.api.get<{ data: Movement[]; total: number }>("/movements", { ...query, limit: PAGE, offset }), [JSON.stringify(query), offset]);
  const filtered = !!(reason || itemId || from || to);
  const set = <T,>(f: (v: T) => void) => (v: T) => { f(v); setOffset(0); };
  const reset = () => { setReason(""); setItemId(""); setFrom(""); setTo(""); setOffset(0); };
  const d = list.data;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/inventory")}><ArrowLeft /> Inventory</Button>
      <PageHeader title="Stock history" description="Every delivery, usage, waste and count, newest first." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Why">{(a) => (
          <Select {...a} value={reason} onChange={(e) => set(setReason)(e.target.value as Reason | "")} className="w-44">
            <option value="">All reasons</option>{REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        )}</Field>
        <Field label="Item">{(a) => (
          <Select {...a} value={itemId} onChange={(e) => set(setItemId)(e.target.value)} className="w-52">
            <option value="">All items</option>{items.data?.data.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        )}</Field>
        <Field label="From">{(a) => <DatePicker {...a} value={from} onChange={(iso) => set(setFrom)(iso)} />}</Field>
        <Field label="To">{(a) => <DatePicker {...a} value={to} onChange={(iso) => set(setTo)(iso)} />}</Field>
        {filtered && <Button variant="ghost" size="sm" onClick={reset}><X /> Clear filters</Button>}
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !d ? <Skeleton className="h-64" />
        : !d.data.length ? <Card><EmptyState title={filtered ? "Nothing matches these filters" : "No stock changes yet"} /></Card>
        : (
          <>
            <Card className="overflow-x-auto"><MovementTable rows={d.data} /></Card>
            {d.total > PAGE && (
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>{offset + 1}–{Math.min(offset + PAGE, d.total)} of {d.total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                  <Button size="sm" variant="outline" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
    </>
  );
}

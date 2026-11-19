import { useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Pencil } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, ErrorState, PageHeader, Skeleton, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { AdjustDialog } from "./Adjust.tsx";
import { MovementTable } from "./History.tsx";
import { LowBadge, OrderBadge, errorMessage, fmtMoney, fmtQty, useLoad, type Config, type ItemDetail as Detail, type Reason } from "./shared.tsx";

export function ItemDetail({ params }: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const it = useLoad(() => host.api.get<Detail>(`/items/${params.id}`), [params.id]);
  const [adjust, setAdjust] = useState<Reason | null>(null);
  const [archiving, setArchiving] = useState(false);

  if (it.error || cfg.error) return <Card><ErrorState error={it.error ?? cfg.error} onRetry={() => { void it.reload(); void cfg.reload(); }} /></Card>;
  const x = it.data, c = cfg.data;
  if (!x || !c) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;

  async function restore() {
    try { await host.api.patch(`/items/${x!.id}`, { archived: false }); toast.success("Item restored"); await it.reload(); }
    catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/inventory")}><ArrowLeft /> Inventory</Button>
      <PageHeader title={x.name}
        description={[x.category, x.sku ? `SKU ${x.sku}` : null, x.archived ? "Archived" : null].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {c.canManage && !x.archived && <Button variant="outline" onClick={() => setArchiving(true)}><Archive /> Archive</Button>}
          {c.canManage && x.archived && <Button variant="outline" onClick={() => void restore()}><ArchiveRestore /> Restore</Button>}
          {c.canManage && <Button variant="outline" onClick={() => host.navigate(`/inventory/${x.id}/edit`)}><Pencil /> Edit</Button>}
          {c.canAdjust && !x.archived && <Button onClick={() => setAdjust("usage")}>Change stock</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="grid content-start gap-4">
          <Card className="grid gap-3 p-5" data-testid="stock-card">
            <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">In stock</p>{x.low && <LowBadge />}</div>
            <p className={`text-3xl font-semibold tabular-nums ${x.low ? "text-destructive" : ""}`}>{fmtQty(x.stock)} <span className="text-lg font-normal">{x.unit}</span></p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Minimum</dt><dd className="text-right tabular-nums">{fmtQty(x.minStock)} {x.unit}</dd>
              <dt className="text-muted-foreground">Reorder</dt><dd className="text-right tabular-nums">{fmtQty(x.suggestedQty)} {x.unit}{x.reorderQty === null && <span className="text-muted-foreground"> (auto)</span>}</dd>
              <dt className="text-muted-foreground">On order</dt><dd className="text-right tabular-nums">{fmtQty(x.onOrder)} {x.unit}</dd>
              <dt className="text-muted-foreground">Unit cost</dt><dd className="text-right tabular-nums">{fmtMoney(x.unitCostCents, c.currency)}</dd>
              <dt className="text-muted-foreground">Stock value</dt><dd className="text-right tabular-nums">{fmtMoney(x.valueCents, c.currency)}</dd>
              <dt className="text-muted-foreground">Supplier</dt><dd className="truncate text-right">{x.supplierName ?? "None"}</dd>
            </dl>
            {c.canAdjust && !x.archived && (
              <div className="grid grid-cols-2 gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={() => setAdjust("delivery")}>Delivery</Button>
                <Button size="sm" variant="outline" onClick={() => setAdjust("usage")}>Usage</Button>
                <Button size="sm" variant="outline" onClick={() => setAdjust("waste")}>Waste</Button>
                <Button size="sm" variant="outline" onClick={() => setAdjust("count")}>Count</Button>
              </div>
            )}
            {x.notes && <p className="border-t pt-3 text-sm text-muted-foreground">{x.notes}</p>}
          </Card>
          {x.openOrders.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Open orders</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {x.openOrders.map((o) => (
                  <button key={o.id} type="button" className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left hover:bg-accent" onClick={() => host.navigate(`/purchase-orders/${o.id}`)}>
                    <span className="font-medium">{o.number}</span><span className="tabular-nums">{fmtQty(o.quantity)} {x.unit}</span><OrderBadge status={o.status} />
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>History</CardTitle>
            {x.history.length >= 100 && <Button variant="link" size="sm" onClick={() => host.navigate("/inventory/history")}>See all</Button>}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {x.history.length ? <MovementTable rows={x.history} showItem={false} /> : <p className="text-sm text-muted-foreground">No stock changes yet.</p>}
            {x.archived && <Badge variant="neutral" className="mt-3">Archived items keep their history</Badge>}
          </CardContent>
        </Card>
      </div>

      {adjust && <AdjustDialog item={x} initial={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); void it.reload(); }} />}
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} confirmLabel="Archive" title={`Archive ${x.name}?`}
        description="It disappears from the list and won't be reordered. Its history stays, and you can restore it any time."
        onConfirm={async () => {
          try { await host.api.del(`/items/${x.id}`); toast.success("Item archived"); await it.reload(); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}

import { useState } from "react";
import { History, Package, Plus, ShoppingCart, X } from "lucide-react";
import {
  Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Input, Label, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { AdjustDialog } from "./Adjust.tsx";
import { LowBadge, errorMessage, fmtMoney, fmtQty, useDebounced, useLoad, type Config, type Item, type ItemList } from "./shared.tsx";

export function Items(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  return <List cfg={cfg.data} />;
}

function List({ cfg }: { cfg: Config }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [low, setLow] = useState(false);
  const [archived, setArchived] = useState(false);
  const [adjusting, setAdjusting] = useState<Item | null>(null);
  const [generating, setGenerating] = useState(false);
  const dq = useDebounced(q.trim(), 300);
  const query = { q: dq || undefined, category: category || undefined, supplierId: supplierId || undefined, low: low ? "true" : undefined, archived: archived ? "true" : undefined };
  const list = useLoad(() => host.api.get<ItemList>("/items", query), [JSON.stringify(query)]);
  const suppliers = useLoad(() => host.api.get<{ id: string; name: string }[]>("/suppliers"), []);
  const filtered = !!(q || category || supplierId || low || archived);
  const reset = () => { setQ(""); setCategory(""); setSupplierId(""); setLow(false); setArchived(false); };
  const d = list.data;

  async function generate() {
    try {
      const r = await host.api.post<{ created: { id: string; number: string; supplierName: string | null }[]; skipped: { name: string; reason: string }[] }>("/orders/generate", {});
      if (r.created.length) toast.success(`Created ${r.created.map((c) => `${c.number} (${c.supplierName})`).join(", ")}`);
      else toast.info("No new orders needed");
      if (r.skipped.length) toast.warning(`Not ordered: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);
      if (r.created.length === 1) host.navigate(`/purchase-orders/${r.created[0]!.id}`);
      else if (r.created.length) host.navigate("/purchase-orders");
      else await list.reload();
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  }

  return (
    <>
      <PageHeader title="Inventory" description="Everything you keep in stock. Record deliveries, usage, waste and counts; low items turn red."
        actions={<>
          <Button variant="outline" onClick={() => host.navigate("/inventory/history")}><History /> Stock history</Button>
          {cfg.canManage && <Button variant="outline" disabled={!d?.lowCount && !low} onClick={() => setGenerating(true)}><ShoppingCart /> Order low stock</Button>}
          {cfg.canManage && <Button onClick={() => host.navigate("/inventory/new")}><Plus /> New item</Button>}
        </>} />

      {!!d?.lowCount && !low && !archived && (
        <button type="button" onClick={() => setLow(true)} data-testid="low-banner"
          className="mb-4 flex w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10">
          <strong>{d.lowCount} item{d.lowCount === 1 ? " is" : "s are"} at or below the minimum.</strong> Show only those
        </button>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input aria-label="Search items" placeholder="Search name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
          <option value="">All categories</option>
          {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-44">
          <option value="">All suppliers</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <div className="flex h-9 items-center gap-2"><Checkbox id="low-only" checked={low} onCheckedChange={(v) => setLow(v === true)} /><Label htmlFor="low-only">Low stock only</Label></div>
        <div className="flex h-9 items-center gap-2"><Checkbox id="archived" checked={archived} onCheckedChange={(v) => setArchived(v === true)} /><Label htmlFor="archived">Archived</Label></div>
        {filtered && <Button variant="ghost" size="sm" onClick={reset}><X /> Clear filters</Button>}
      </div>

      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !d ? <Skeleton className="h-64" />
        : !d.data.length ? (
          <Card>
            <EmptyState icon={<Package />} title={filtered ? "Nothing matches these filters" : "No items yet"}
              description={filtered ? "Try other filters." : "Add the things you buy and keep in stock, with a minimum so you know when to reorder."}
              action={filtered ? <Button variant="outline" onClick={reset}>Clear filters</Button> : cfg.canManage ? <Button onClick={() => host.navigate("/inventory/new")}><Plus /> New item</Button> : undefined} />
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <Table aria-label="Items">
              <THead><TR>
                <TH>Item</TH><TH>Category</TH><TH className="text-right">In stock</TH><TH className="text-right">Minimum</TH><TH>Supplier</TH>
                <TH className="text-right">Unit cost</TH><TH className="text-right">Value</TH>{cfg.canAdjust && !archived && <TH><span className="sr-only">Actions</span></TH>}
              </TR></THead>
              <TBody>
                {d.data.map((i) => (
                  <TR key={i.id} className={cn(i.low && "bg-destructive/5")}>
                    <TD>
                      <a href={host.href(`/inventory/${i.id}`)} onClick={(e) => { e.preventDefault(); host.navigate(`/inventory/${i.id}`); }} className="font-medium hover:underline">{i.name}</a>
                      {i.sku && <span className="ml-2 text-xs text-muted-foreground">{i.sku}</span>}
                    </TD>
                    <TD className="text-muted-foreground">{i.category ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      <span className={cn("font-medium", i.low && "text-destructive")}>{fmtQty(i.stock)} {i.unit}</span>
                      {i.low && <span className="ml-2"><LowBadge /></span>}
                      {i.onOrder > 0 && <span className="block text-xs text-muted-foreground">+{fmtQty(i.onOrder)} on order</span>}
                    </TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{fmtQty(i.minStock)}</TD>
                    <TD className="text-muted-foreground">{i.supplierName ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(i.unitCostCents, d.currency)}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(i.valueCents, d.currency)}</TD>
                    {cfg.canAdjust && !archived && <TD className="text-right"><Button size="sm" variant="outline" aria-label={`Change stock of ${i.name}`} onClick={() => setAdjusting(i)}>Change stock</Button></TD>}
                  </TR>
                ))}
                <TR className="font-semibold hover:bg-transparent">
                  <TD colSpan={6}>Total stock value</TD>
                  <TD className="text-right tabular-nums" data-testid="stock-value">{fmtMoney(d.valueCents, d.currency)}</TD>
                  {cfg.canAdjust && !archived && <TD />}
                </TR>
              </TBody>
            </Table>
          </Card>
        )}

      {adjusting && <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); void list.reload(); }} />}
      <ConfirmDialog open={generating} onOpenChange={setGenerating} confirmLabel="Create orders" title="Create purchase orders for low stock?"
        description="One draft order per supplier with every low item that isn't already on an open order. You can change them before sending."
        onConfirm={generate} />
    </>
  );
}

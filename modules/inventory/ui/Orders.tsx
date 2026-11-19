import { useState, type FormEvent } from "react";
import { ArrowLeft, Plus, ShoppingCart } from "lucide-react";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { OrderBadge, SupplierPicker, errorMessage, fmtDate, fmtMoney, useLoad, type Config, type Order, type OrderSummary, type Supplier } from "./shared.tsx";

type Tab = "open" | "received" | "cancelled" | "all";
const TABS: { key: Tab; label: string }[] = [{ key: "open", label: "Open" }, { key: "received", label: "Received" }, { key: "cancelled", label: "Cancelled" }, { key: "all", label: "All" }];

export function Orders(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const [tab, setTab] = useState<Tab>("open");
  const [generating, setGenerating] = useState(false);
  const list = useLoad(() => host.api.get<OrderSummary[]>("/orders", tab === "all" ? {} : { status: tab }), [tab]);
  const manage = !!cfg.data?.canManage;

  async function generate() {
    try {
      const r = await host.api.post<{ created: { number: string; supplierName: string | null }[]; skipped: { name: string; reason: string }[] }>("/orders/generate", {});
      if (r.created.length) toast.success(`Created ${r.created.map((c) => `${c.number} (${c.supplierName})`).join(", ")}`);
      else toast.info("Nothing to order: no low items that aren't already on an open order");
      if (r.skipped.length) toast.warning(`Not ordered: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);
      setTab("open");
      await list.reload();
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  }

  return (
    <>
      <PageHeader title="Purchase orders" description="Orders to your suppliers. Receiving an order adds what arrived to stock."
        actions={manage && <>
          <Button variant="outline" onClick={() => setGenerating(true)}><ShoppingCart /> Order low stock</Button>
          <Button onClick={() => host.navigate("/purchase-orders/new")}><Plus /> New order</Button>
        </>} />
      <div role="tablist" aria-label="Which orders" className="mb-4 flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>{t.label}</Button>)}
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : !list.data.length ? (
          <Card><EmptyState icon={<ShoppingCart />} title={tab === "open" ? "No open orders" : "No orders here"}
            description={manage ? "Use “Order low stock” to create orders for everything that's running low, one per supplier." : undefined} /></Card>
        ) : (
          <Card className="overflow-x-auto">
            <Table aria-label="Purchase orders">
              <THead><TR><TH>Order</TH><TH>Supplier</TH><TH>Status</TH><TH className="text-right">Items</TH><TH className="text-right">Total</TH><TH>Created</TH><TH>Expected</TH></TR></THead>
              <TBody>
                {list.data.map((o) => (
                  <TR key={o.id}>
                    <TD><a href={host.href(`/purchase-orders/${o.id}`)} onClick={(e) => { e.preventDefault(); host.navigate(`/purchase-orders/${o.id}`); }} className="font-medium hover:underline">{o.number}</a></TD>
                    <TD>{o.supplierName}</TD>
                    <TD><OrderBadge status={o.status} /></TD>
                    <TD className="text-right tabular-nums">{o.lineCount}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(o.totalCents, o.currency)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(o.createdAt)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(o.expectedOn)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      <ConfirmDialog open={generating} onOpenChange={setGenerating} confirmLabel="Create orders" title="Create purchase orders for low stock?"
        description="One draft order per supplier with every low item that isn't already on an open order. You can change them before sending."
        onConfirm={generate} />
    </>
  );
}

export function NewOrder(_: PageProps) {
  const host = useModuleHost();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [expectedOn, setExpectedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!supplier) { setError("Choose a supplier"); return; }
    setBusy(true); setError(null);
    try {
      const o = await host.api.post<Order>("/orders", { supplierId: supplier.id, expectedOn: expectedOn || null, notes: notes.trim() || null });
      toast.success(`${o.number} created. Add the items next.`);
      host.navigate(`/purchase-orders/${o.id}`);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/purchase-orders")}><ArrowLeft /> Purchase orders</Button>
      <PageHeader title="New purchase order" />
      <form onSubmit={(e) => void create(e)} noValidate>
        <Card className="grid max-w-xl gap-4 p-5">
          <Field label="Supplier" required error={error === "Choose a supplier" ? error : undefined}>{(a) => <SupplierPicker id={a.id} value={supplier} onChange={setSupplier} invalid={!!a["aria-invalid"]} />}</Field>
          <Field label="Expected delivery">{(a) => <Input {...a} type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />}</Field>
          <Field label="Notes for the supplier">{(a) => <Textarea {...a} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          {error && error !== "Choose a supplier" && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div><Button type="submit" loading={busy}>Create order</Button></div>
        </Card>
      </form>
    </>
  );
}

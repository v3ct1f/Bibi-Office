import { useState } from "react";
import { ArrowLeft, ClipboardPaste, Plus, Rocket, X } from "lucide-react";
import { Button, Card, Checkbox, ErrorState, Input, PageHeader, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { errorMessage, useLoad, type Config } from "./shared.tsx";

interface Row { name: string; supplier: string; unit: string; stock: string; min: string; reorder: string; cost: string }
const blank = (): Row => ({ name: "", supplier: "", unit: "", stock: "", min: "", reorder: "", cost: "" });
interface Result {
  created: string[]; failed: { name: string; reason: string }[]; addedSuppliers: string[];
  orders: { created: { number: string; supplierName: string | null }[]; skipped: { name: string; reason: string }[] };
}

const num = (s: string) => { const n = Number(s.replace(",", ".").trim()); return s.trim() === "" || !Number.isFinite(n) || n < 0 ? 0 : n; };
const cents = (s: string) => Math.round(num(s) * 100);

/** "Name, supplier, unit, in stock, minimum, reorder amount, cost": one item per line, tab or comma separated (paste from a spreadsheet). */
function parsePaste(text: string): Row[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const c = (l.includes("\t") ? l.split("\t") : l.split(/[;,]/)).map((x) => x.trim());
    return { name: c[0] ?? "", supplier: c[1] ?? "", unit: c[2] ?? "", stock: c[3] ?? "", min: c[4] ?? "", reorder: c[5] ?? "", cost: c[6] ?? "" };
  });
}

export function QuickSetup(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const [rows, setRows] = useState<Row[]>([blank(), blank(), blank()]);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [createOrders, setCreateOrders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <Skeleton className="h-64" />;
  if (!cfg.data.canManage) return <Card className="p-5 text-sm">Only managers can set up inventory.</Card>;

  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const filled = rows.filter((r) => r.name.trim());

  async function go() {
    if (!filled.length) { setError("Type at least one item"); return; }
    setBusy(true); setError(null);
    try {
      const r = await host.api.post<Result>("/setup", {
        createOrders,
        items: filled.map((x) => ({
          name: x.name.trim(), supplier: x.supplier.trim() || null, unit: x.unit.trim() || "unit", stock: num(x.stock), minStock: num(x.min),
          reorderQty: num(x.reorder) > 0 ? num(x.reorder) : null, unitCostCents: cents(x.cost),
        })),
      });
      const bits = [`${r.created.length} item${r.created.length === 1 ? "" : "s"} added`];
      if (r.addedSuppliers.length) bits.push(`${r.addedSuppliers.length} new supplier${r.addedSuppliers.length === 1 ? "" : "s"} (${r.addedSuppliers.join(", ")})`);
      if (r.orders.created.length) bits.push(`orders ${r.orders.created.map((o) => o.number).join(", ")} created`);
      toast.success(bits.join(" · "));
      if (r.failed.length) {
        toast.warning(`Not added: ${r.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}`);
        const left = new Set(r.failed.map((f) => f.name));
        setRows(rows.filter((x) => left.has(x.name.trim())));
        return;
      }
      host.navigate(r.orders.created.length ? "/purchase-orders" : "/inventory");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const head = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/inventory")}><ArrowLeft /> Inventory</Button>
      <PageHeader title="Quick setup" description="Type what you buy, who you buy it from and when to reorder. Office adds the suppliers for you and makes your first purchase orders." />
      <Card className="grid gap-4 p-4">
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li>List your items. Only the name is required.</li>
          <li>Type the supplier&apos;s name. If it&apos;s new, Office adds it to Companies.</li>
          <li>Set a <strong className="text-foreground">minimum</strong>: when stock drops to it, the item counts as low and gets ordered.</li>
        </ol>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr>
              <th className={head}>Item</th><th className={head}>Supplier</th><th className={head}>Counted in</th><th className={head}>In stock</th>
              <th className={head}>Minimum</th><th className={head}>Reorder amount</th><th className={head}>Cost each ({cfg.data.currency})</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} name`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="e.g. Coffee beans" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} supplier`} value={r.supplier} onChange={(e) => set(i, "supplier", e.target.value)} placeholder="e.g. Acme Roasters" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} unit`} value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} placeholder="kg, box…" list="qs-units" className="w-24" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} in stock`} inputMode="decimal" value={r.stock} onChange={(e) => set(i, "stock", e.target.value)} className="w-24" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} minimum`} inputMode="decimal" value={r.min} onChange={(e) => set(i, "min", e.target.value)} className="w-24" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} reorder amount`} inputMode="decimal" value={r.reorder} onChange={(e) => set(i, "reorder", e.target.value)} className="w-28" placeholder="optional" /></td>
                  <td className="p-1"><Input aria-label={`Item ${i + 1} cost`} inputMode="decimal" value={r.cost} onChange={(e) => set(i, "cost", e.target.value)} className="w-24" /></td>
                  <td className="p-1"><Button type="button" variant="ghost" size="sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [blank()]))}><X /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="qs-units">{cfg.data.units.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, blank(), blank(), blank()])}><Plus /> More rows</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPasting((p) => !p)}><ClipboardPaste /> Paste from a spreadsheet</Button>
        </div>
        {pasting && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">One item per line, columns in this order: <em>item, supplier, counted in, in stock, minimum, reorder amount, cost</em>. Copy the cells from Excel or Google Sheets and paste them here.</p>
            <Textarea aria-label="Pasted items" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <div><Button type="button" size="sm" disabled={!pasted.trim()} onClick={() => { setRows([...rows.filter((x) => x.name.trim()), ...parsePaste(pasted)]); setPasted(""); setPasting(false); }}>Add to the table</Button></div>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={createOrders} onCheckedChange={(v) => setCreateOrders(v === true)} className="mt-0.5" aria-label="Create purchase orders for items that are already low" />
          <span>Also create purchase orders for items that are already low (one draft per supplier; you can change them before sending).</span>
        </label>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div><Button onClick={() => void go()} loading={busy}><Rocket /> Set up {filled.length ? `${filled.length} item${filled.length === 1 ? "" : "s"}` : ""}</Button></div>
      </Card>
    </>
  );
}

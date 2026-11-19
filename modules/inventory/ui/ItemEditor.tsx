import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Card, ErrorState, Field, Input, PageHeader, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { SupplierPicker, centsToInput, errorMessage, parseMoney, parseQty, useLoad, type Config, type ItemDetail, type Supplier } from "./shared.tsx";

type Form = { name: string; sku: string; category: string; unit: string; stock: string; minStock: string; reorderQty: string; cost: string; notes: string };
const EMPTY: Form = { name: "", sku: "", category: "", unit: "unit", stock: "", minStock: "", reorderQty: "", cost: "", notes: "" };

export function ItemEditor({ params }: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const item = useLoad(() => (params.id ? host.api.get<ItemDetail>(`/items/${params.id}`) : Promise.resolve(null)), [params.id]);
  if (cfg.error || item.error) return <Card><ErrorState error={cfg.error ?? item.error} onRetry={() => { void cfg.reload(); void item.reload(); }} /></Card>;
  if (!cfg.data || item.data === undefined) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96" /></div>;
  return <Editor cfg={cfg.data} item={item.data} />;
}

function Editor({ cfg, item }: { cfg: Config; item: ItemDetail | null }) {
  const host = useModuleHost();
  const [f, setF] = useState<Form>(EMPTY);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!item) return;
    setF({
      name: item.name, sku: item.sku ?? "", category: item.category ?? "", unit: item.unit, stock: String(item.stock), minStock: String(item.minStock),
      reorderQty: item.reorderQty === null ? "" : String(item.reorderQty), cost: centsToInput(item.unitCostCents), notes: item.notes ?? "",
    });
    setSupplier(item.supplierId ? { id: item.supplierId, name: item.supplierName ?? "Supplier" } : null);
  }, [item]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const stock = parseQty(f.stock), minStock = parseQty(f.minStock), reorder = parseQty(f.reorderQty), cost = parseMoney(f.cost);
  const errs = {
    name: !f.name.trim() ? "Give the item a name" : undefined,
    unit: !f.unit.trim() ? "Say how you count it" : undefined,
    stock: stock === null ? "Use a number with at most 3 decimals" : undefined,
    minStock: minStock === null ? "Use a number with at most 3 decimals" : undefined,
    reorderQty: reorder === null || reorder === 0 ? "Use a number above 0, or leave empty" : undefined,
    cost: cost === null ? "Use an amount like 12.50" : undefined,
  };
  const show = (k: keyof typeof errs) => (touched ? errs[k] : undefined);

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean)) { setError("Check the highlighted fields"); return; }
    setBusy(true); setError(null);
    const body = {
      name: f.name.trim(), sku: f.sku.trim() || null, category: f.category.trim() || null, unit: f.unit.trim(),
      minStock: minStock ?? 0, reorderQty: reorder ?? null, supplierId: supplier?.id ?? null, unitCostCents: cost ?? 0, notes: f.notes.trim() || null,
    };
    try {
      const saved = item
        ? await host.api.patch<ItemDetail>(`/items/${item.id}`, body)
        : await host.api.post<ItemDetail>("/items", { ...body, stock: stock ?? 0 });
      toast.success(item ? "Item saved" : "Item added");
      host.navigate(`/inventory/${saved.id}`);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate(item ? `/inventory/${item.id}` : "/inventory")}><ArrowLeft /> Back</Button>
      <PageHeader title={item ? `Edit ${item.name}` : "New item"} description="Set a minimum so the item shows up as low stock and gets reordered." />
      <form onSubmit={(e) => void save(e)} noValidate>
        <Card className="grid max-w-3xl gap-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={show("name")} className="sm:col-span-2">{(a) => <Input {...a} value={f.name} maxLength={120} onChange={set("name")} placeholder="e.g. Whole milk" />}</Field>
            <Field label="Category" hint="Pick one you used before or type a new one.">
              {(a) => <><Input {...a} list="inv-categories" value={f.category} maxLength={60} onChange={set("category")} placeholder="e.g. Dairy" />
                <datalist id="inv-categories">{cfg.categories.map((c) => <option key={c} value={c} />)}</datalist></>}
            </Field>
            <Field label="SKU / code">{(a) => <Input {...a} value={f.sku} maxLength={60} onChange={set("sku")} placeholder="Optional" />}</Field>
            <Field label="Unit" required error={show("unit")} hint="How you count it: kg, bottle, box…">
              {(a) => <><Input {...a} list="inv-units" value={f.unit} maxLength={20} onChange={set("unit")} />
                <datalist id="inv-units">{cfg.units.map((u) => <option key={u} value={u} />)}</datalist></>}
            </Field>
            <Field label={`Unit cost (${cfg.currency})`} error={show("cost")}>{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={set("cost")} placeholder="0.00" />}</Field>
          </div>

          <div className="grid gap-4 border-t pt-5 sm:grid-cols-3">
            {item
              ? <div className="grid gap-1.5 text-sm"><span className="font-medium">In stock</span><span className="flex h-9 items-center text-muted-foreground">{item.stock} {item.unit}. Change it with “Change stock”.</span></div>
              : <Field label="Stock now" error={show("stock")} hint="What you have today.">{(a) => <Input {...a} inputMode="decimal" value={f.stock} onChange={set("stock")} placeholder="0" />}</Field>}
            <Field label="Minimum stock" error={show("minStock")} hint="At or below this it's low.">{(a) => <Input {...a} inputMode="decimal" value={f.minStock} onChange={set("minStock")} placeholder="0" />}</Field>
            <Field label="Reorder amount" error={show("reorderQty")} hint="Empty: order back up to twice the minimum.">{(a) => <Input {...a} inputMode="decimal" value={f.reorderQty} onChange={set("reorderQty")} placeholder="Automatic" />}</Field>
          </div>

          <div className="grid gap-4 border-t pt-5">
            <Field label="Supplier" hint="Suppliers are companies. Low items are ordered from this supplier.">{(a) => <SupplierPicker id={a.id} value={supplier} onChange={setSupplier} />}</Field>
            <Field label="Notes">{(a) => <Textarea {...a} rows={2} maxLength={1000} value={f.notes} onChange={set("notes")} placeholder="e.g. Keep refrigerated" />}</Field>
          </div>

          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>{item ? "Save item" : "Add item"}</Button>
            <Button type="button" variant="outline" onClick={() => host.navigate(item ? `/inventory/${item.id}` : "/inventory")}>Cancel</Button>
          </div>
        </Card>
      </form>
    </>
  );
}


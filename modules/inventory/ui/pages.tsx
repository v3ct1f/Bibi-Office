import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch, Table, TBody, TD, TH, THead, TR, Textarea,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtMoney, fmtQty, fmtWhen, fromMinor, KindBadge, numOrNull, P, ROOT, StockBadge, toMinor } from "./common.tsx";
import type { Item, ItemDetail, ItemList, Location, Movement, MovementKind, ReorderRow } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "inventory", ...rest];
const useLocations = ({ api, tenantId }: SlotProps) =>
  useQuery({ queryKey: key(tenantId, "locations"), queryFn: () => api.get<{ data: Location[] }>("/locations") });
const useInvalidate = (tenantId: string) => { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: key(tenantId) }); };

/** /m/inventory/inventory[/<item id>] */
export function InventoryPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <ItemPage {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Overview {...props} />;
}

type Tab = "items" | "movements" | "reorder" | "locations";
function Overview(props: SlotProps) {
  const tabs: [Tab, string][] = [["items", "Items"], ["movements", "Movements"], ["reorder", "Reorder"], ["locations", "Locations"]];
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem("inventory.tab") as Tab | null) ?? "items"; } catch { return "items"; } });
  const current = tabs.some((t) => t[0] === tab) ? tab : "items";
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("inventory.tab", t); } catch { /* ignore */ } };
  return (
    <>
      <PageHeader title="Inventory" description="What you have, where it is, and what to reorder." />
      <div role="tablist" aria-label="Inventory view" className="mb-4 flex flex-wrap gap-1">
        {tabs.map(([k, label]) => <Button key={k} role="tab" aria-selected={current === k} size="sm" variant={current === k ? "secondary" : "ghost"} onClick={() => pick(k)}>{label}</Button>)}
      </div>
      {current === "items" && <Items {...props} />}
      {current === "movements" && <Movements {...props} />}
      {current === "reorder" && <Reorder {...props} />}
      {current === "locations" && <Locations {...props} />}
    </>
  );
}

// ───────────────────────── items ─────────────────────────
function Items(props: SlotProps) {
  const { api, tenantId, can, navigate, errorMessage } = props;
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [cat, setCat] = useState(""), [loc, setLoc] = useState("");
  const [low, setLow] = useState(false), [archived, setArchived] = useState(false), [dialog, setDialog] = useState<"add" | "count" | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const locs = useLocations(props);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { category: cat } : {}), ...(loc ? { locationId: loc } : {}), ...(low ? { low: "true" } : {}), ...(archived ? { archived: "true" } : {}) }).toString();
  const list = useInfiniteQuery({
    queryKey: key(tenantId, "items", qs), initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<ItemList>(`/items?${qs}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => { if (first && first.categories.length >= categories.length) setCategories(first.categories); }, [first, categories.length]);
  const filtered = !!(q || cat || low || archived);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search items" placeholder="Search SKU, name or scan a barcode" className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
        {categories.length > 0 && (
          <Select aria-label="Category" className="w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        {(locs.data?.data.filter((l) => !l.archived).length ?? 0) > 1 && (
          <Select aria-label="Location" className="w-auto" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">All locations</option>{locs.data!.data.filter((l) => !l.archived).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm"><Switch checked={low} onCheckedChange={setLow} label="Low stock only" />Low stock only</label>
        {can(P.manage) && <label className="flex items-center gap-2 text-sm"><Switch checked={archived} onCheckedChange={setArchived} label="Archived" />Archived</label>}
        <span className="flex-1" />
        <ExportButton {...props} />
        {can(P.adjust) && <Button variant="outline" onClick={() => setDialog("count")}>Stock count</Button>}
        {can(P.manage) && <Button onClick={() => setDialog("add")}>Add item</Button>}
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={filtered ? "No items match" : "No items yet"}>{!filtered && can(P.manage) ? "Add the things you stock, with a SKU and a reorder point, then receive what you have on hand." : null}</EmptyState>
      ) : (
        <>
          <Card className="overflow-x-auto"><Table aria-label="Items">
            <THead><TR><TH>SKU</TH><TH>Item</TH><TH>Category</TH><TH className="text-right">{loc ? "Here" : "On hand"}</TH><TH /><TH className="text-right">Value</TH></TR></THead>
            <TBody>{rows.map((i) => (
              <TR key={i.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${i.id}`)}>
                <TD className="whitespace-nowrap font-mono text-xs">{i.sku}</TD>
                <TD><a href={`${ROOT}/${i.id}`} onClick={(e) => { e.preventDefault(); }} className="font-medium">{i.name}</a></TD>
                <TD className="text-muted">{i.category ?? "—"}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{fmtQty(i.onHand, i.unit)}</TD>
                <TD><StockBadge low={i.low} onHand={i.onHand} /></TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{fmtMoney(i.value, first!.currency)}</TD>
              </TR>
            ))}</TBody>
          </Table></Card>
          {list.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
        </>
      )}
      {dialog === "add" && <ItemDialog {...props} currency={first?.currency ?? "EUR"} onClose={() => setDialog(null)} />}
      {dialog === "count" && <CountDialog {...props} onClose={() => setDialog(null)} />}
    </>
  );
}

function ExportButton({ api, errorMessage }: SlotProps) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string>();
  const download = async () => {
    setBusy(true); setErr(undefined);
    try {
      const url = URL.createObjectURL(await api.blob("/export.csv"));
      const a = document.createElement("a"); a.href = url; a.download = `stock-${new Date().toLocaleDateString("en-CA")}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return <>{err && <span role="alert" className="text-sm text-danger">{err}</span>}<Button variant="ghost" disabled={busy} onClick={() => void download()}>Export CSV</Button></>;
}

function ItemDialog({ api, tenantId, errorMessage, navigate, onClose, item, currency, ...props }: SlotProps & { onClose(): void; item?: ItemDetail; currency: string }) {
  const inval = useInvalidate(tenantId);
  const locs = useLocations({ api, tenantId, errorMessage, navigate, ...props });
  const active = locs.data?.data.filter((l) => !l.archived) ?? [];
  const [f, setF] = useState({
    sku: item?.sku ?? "", name: item?.name ?? "", category: item?.category ?? "", unit: item?.unit ?? "pcs", barcode: item?.barcode ?? "",
    cost: fromMinor(item?.cost, currency), price: fromMinor(item?.price, currency), reorderPoint: item?.reorderPoint?.toString() ?? "",
    reorderQty: item?.reorderQty?.toString() ?? "", description: item?.description ?? "", opening: "", openingLoc: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku: f.sku, name: f.name, category: f.category || null, unit: f.unit || "pcs", barcode: f.barcode || null, description: f.description || null,
        cost: toMinor(f.cost, currency) ?? 0, price: f.price ? (toMinor(f.price, currency) ?? null) : null,
        reorderPoint: numOrNull(f.reorderPoint), reorderQty: numOrNull(f.reorderQty),
      };
      if (item) return api.patch<ItemDetail>(`/items/${item.id}`, body);
      const opening = numOrNull(f.opening);
      return api.post<ItemDetail>("/items", { ...body, ...(opening ? { openingStock: { locationId: f.openingLoc || active[0]!.id, quantity: opening } } : {}) });
    },
    onSuccess: (r) => { inval(); onClose(); if (!item) navigate(`${ROOT}/${r.id}`); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? `Edit ${item.name}` : "Add item"}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SKU">{(a) => <Input {...a} required maxLength={64} autoFocus={!item} value={f.sku} onChange={set("sku")} />}</Field>
          <Field label="Name">{(a) => <Input {...a} required maxLength={200} value={f.name} onChange={set("name")} />}</Field>
          <Field label="Category (optional)">{(a) => <Input {...a} maxLength={80} value={f.category} onChange={set("category")} />}</Field>
          <Field label="Unit" hint="e.g. pcs, kg, box">{(a) => <Input {...a} required maxLength={20} value={f.unit} onChange={set("unit")} />}</Field>
          <Field label={`Unit cost (${currency})`}>{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={set("cost")} />}</Field>
          <Field label={`Sale price (${currency}, optional)`}>{(a) => <Input {...a} inputMode="decimal" value={f.price} onChange={set("price")} />}</Field>
          <Field label="Reorder point (optional)" hint="Flag it as low at or below this">{(a) => <Input {...a} type="number" min={0} step="any" value={f.reorderPoint} onChange={set("reorderPoint")} />}</Field>
          <Field label="Reorder quantity (optional)">{(a) => <Input {...a} type="number" min={0} step="any" value={f.reorderQty} onChange={set("reorderQty")} />}</Field>
          <Field label="Barcode (optional)">{(a) => <Input {...a} maxLength={64} value={f.barcode} onChange={set("barcode")} />}</Field>
        </div>
        <Field label="Description (optional)">{(a) => <Textarea {...a} rows={2} maxLength={2000} value={f.description} onChange={set("description")} />}</Field>
        {!item && active.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Opening stock (optional)">{(a) => <Input {...a} type="number" min={0} step="any" value={f.opening} onChange={set("opening")} />}</Field>
            {active.length > 1 && <Field label="At">{(a) => <Select {...a} value={f.openingLoc || active[0]!.id} onChange={set("openingLoc")}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : item ? "Save" : "Add item"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────────────────── movements ─────────────────────────
type MoveType = "receive" | "issue" | "transfer" | "adjust";
const MOVE_TITLE: Record<MoveType, string> = { receive: "Receive stock", issue: "Issue stock", transfer: "Move stock", adjust: "Adjust stock" };
function MoveDialog(props: SlotProps & { item: ItemDetail; type: MoveType; onClose(): void }) {
  const { api, tenantId, errorMessage, item, type, onClose } = props;
  const inval = useInvalidate(tenantId);
  const locs = useLocations(props);
  const active = locs.data?.data.filter((l) => !l.archived) ?? [];
  const withStock = item.stock.filter((s) => s.quantity > 0);
  const fromChoices = type === "receive" ? active.map((l) => ({ id: l.id, name: l.name })) : type === "adjust" ? item.stock.map((s) => ({ id: s.locationId, name: s.location }))
    : withStock.map((s) => ({ id: s.locationId, name: `${s.location} (${fmtQty(s.quantity, item.unit)})` }));
  const [f, setF] = useState({ locationId: "", toLocationId: "", quantity: "", direction: "-" as "+" | "-", unitCost: "", reference: "", note: "" });
  const from = f.locationId || fromChoices[0]?.id || "";
  const toChoices = active.filter((l) => l.id !== from);
  const to = f.toLocationId || toChoices[0]?.id || "";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const n = Number(f.quantity.replace(",", "."));
      const base = { itemId: item.id, locationId: from, ...(f.reference ? { reference: f.reference } : {}) };
      const note = f.note ? { note: f.note } : {};
      if (type === "adjust") return api.post("/movements", { type, ...base, delta: f.direction === "-" ? -n : n, note: f.note });
      if (type === "transfer") return api.post("/movements", { type, ...base, ...note, toLocationId: to, quantity: n });
      if (type === "receive") { const c = toMinor(f.unitCost, item.currency); return api.post("/movements", { type, ...base, ...note, quantity: n, ...(c !== undefined ? { unitCost: c } : {}) }); }
      return api.post("/movements", { type, ...base, ...note, quantity: n });
    },
    onSuccess: () => { inval(); onClose(); },
  });
  const nothing = fromChoices.length === 0 || (type === "transfer" && toChoices.length === 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${MOVE_TITLE[type]}: ${item.name}`}
      description={type === "adjust" ? "For breakage, loss or corrections. The reason is kept in the ledger." : undefined}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {nothing ? <Alert tone="warning">{type === "transfer" && fromChoices.length ? "Add a second location first." : "There is no stock of this item to move."}</Alert> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={type === "receive" ? "Into" : type === "transfer" ? "From" : "At"}>{(a) => <Select {...a} value={from} onChange={set("locationId")}>{fromChoices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
              {type === "transfer" && <Field label="To">{(a) => <Select {...a} value={to} onChange={set("toLocationId")}>{toChoices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>}
              {type === "adjust" && <Field label="Change">{(a) => <Select {...a} value={f.direction} onChange={set("direction")}><option value="-">Remove</option><option value="+">Add</option></Select>}</Field>}
              <Field label={`Quantity (${item.unit})`}>{(a) => <Input {...a} type="number" required min={0.001} step="any" autoFocus value={f.quantity} onChange={set("quantity")} />}</Field>
              {type === "receive" && <Field label={`Unit cost (${item.currency}, optional)`} hint="Updates the average cost">{(a) => <Input {...a} inputMode="decimal" value={f.unitCost} onChange={set("unitCost")} />}</Field>}
              <Field label="Reference (optional)" hint={type === "receive" ? "e.g. PO or delivery note" : type === "issue" ? "e.g. order or job" : undefined}>{(a) => <Input {...a} maxLength={120} value={f.reference} onChange={set("reference")} />}</Field>
            </div>
            <Field label={type === "adjust" ? "Reason" : "Note (optional)"}>{(a) => <Textarea {...a} rows={2} required={type === "adjust"} maxLength={1000} value={f.note} onChange={set("note")} />}</Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || nothing}>{save.isPending ? "Saving…" : MOVE_TITLE[type]}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CountDialog(props: SlotProps & { onClose(): void }) {
  const { api, tenantId, errorMessage, onClose } = props;
  const inval = useInvalidate(tenantId);
  const locs = useLocations(props);
  const active = locs.data?.data.filter((l) => !l.archived) ?? [];
  const [loc, setLoc] = useState(""), [counts, setCounts] = useState<Record<string, string>>({}), [reference, setReference] = useState("");
  const locationId = loc || active[0]?.id || "";
  const its = useQuery({ queryKey: key(tenantId, "items", "count", locationId), enabled: !!locationId, queryFn: () => api.get<ItemList>(`/items?locationId=${locationId}&limit=200`) });
  const [result, setResult] = useState<{ counted: number; differences: { sku: string; before: number; counted: number; delta: number }[] } | null>(null);
  const lines = Object.entries(counts).filter(([, v]) => v.trim() !== "").map(([itemId, v]) => ({ itemId, counted: Number(v.replace(",", ".")) }));
  const save = useMutation({
    mutationFn: () => api.post<NonNullable<typeof result>>("/counts", { locationId, lines, ...(reference ? { reference } : {}) }),
    onSuccess: (r) => { inval(); setResult(r); },
  });
  if (result) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Count saved" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm">{result.counted} item{result.counted === 1 ? "" : "s"} counted. {result.differences.length === 0 ? "Everything matched." : `${result.differences.length} difference${result.differences.length === 1 ? "" : "s"} recorded:`}</p>
        {result.differences.length > 0 && (
          <ul className="mt-2 grid gap-1 text-sm" aria-label="Differences">
            {result.differences.map((d) => <li key={d.sku} className="flex gap-2"><span className="font-mono text-xs">{d.sku}</span><span className="ml-auto tabular-nums">{fmtQty(d.before)} → {fmtQty(d.counted)} ({d.delta > 0 ? "+" : ""}{fmtQty(d.delta)})</span></li>)}
          </ul>
        )}
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Stock count" description="Enter what you counted. Items you leave blank are not changed.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location">{(a) => <Select {...a} value={locationId} onChange={(e) => { setLoc(e.target.value); setCounts({}); }}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
          <Field label="Reference (optional)">{(a) => <Input {...a} maxLength={120} placeholder="e.g. Year-end count" value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        </div>
        {its.isPending ? <Spinner /> : its.isError ? <Alert>{errorMessage(its.error)}</Alert> : its.data.data.length === 0 ? <p className="text-sm text-muted">No items yet.</p> : (
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table aria-label="Count sheet">
              <THead><TR><TH>Item</TH><TH className="text-right">Expected</TH><TH className="w-32">Counted</TH></TR></THead>
              <TBody>{its.data.data.map((i: Item) => (
                <TR key={i.id}>
                  <TD><span className="font-medium">{i.name}</span> <span className="font-mono text-xs text-muted">{i.sku}</span></TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{fmtQty(i.onHand, i.unit)}</TD>
                  <TD><Input aria-label={`Counted ${i.name}`} type="number" min={0} step="any" value={counts[i.id] ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} /></TD>
                </TR>
              ))}</TBody>
            </Table>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || lines.length === 0}>{save.isPending ? "Saving…" : `Save count${lines.length ? ` (${lines.length})` : ""}`}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function MovementTable({ rows, showItem, navigate }: { rows: Movement[]; showItem: boolean; navigate: SlotProps["navigate"] }) {
  return (
    <Card className="overflow-x-auto"><Table aria-label="Movements">
      <THead><TR><TH>When</TH>{showItem && <TH>Item</TH>}<TH>What</TH><TH>Location</TH><TH className="text-right">Qty</TH><TH>Reference</TH><TH>By</TH></TR></THead>
      <TBody>{rows.map((m) => (
        <TR key={m.id} className={showItem ? "cursor-pointer" : undefined} onClick={showItem ? () => navigate(`${ROOT}/${m.itemId}`) : undefined}>
          <TD className="whitespace-nowrap text-muted">{fmtWhen(m.createdAt)}</TD>
          {showItem && <TD><span className="font-medium">{m.itemName}</span> <span className="font-mono text-xs text-muted">{m.sku}</span></TD>}
          <TD><KindBadge k={m.kind} /></TD>
          <TD>{m.location}</TD>
          <TD className={`whitespace-nowrap text-right tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}>{m.quantity > 0 ? "+" : ""}{fmtQty(m.quantity, m.unit)}</TD>
          <TD className="max-w-64 truncate" title={m.note ?? undefined}>{m.reference ?? m.note ?? "—"}</TD>
          <TD className="whitespace-nowrap text-muted">{m.by}</TD>
        </TR>
      ))}</TBody>
    </Table></Card>
  );
}

function useMovements({ api, tenantId }: SlotProps, qs: string) {
  return useInfiniteQuery({
    queryKey: key(tenantId, "movements", qs), initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<{ data: Movement[]; nextCursor: string | null }>(`/movements?${qs}${pageParam ? `&cursor=${pageParam}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
}

const KINDS: [MovementKind | "", string][] = [["", "All movements"], ["receipt", "Received"], ["issue", "Issued"], ["transfer_out", "Moved out"], ["transfer_in", "Moved in"], ["adjustment", "Adjusted"], ["count", "Counted"]];
function Movements(props: SlotProps) {
  const [kind, setKind] = useState(""), [loc, setLoc] = useState("");
  const locs = useLocations(props);
  const list = useMovements(props, new URLSearchParams({ ...(kind ? { kind } : {}), ...(loc ? { locationId: loc } : {}) }).toString());
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label="Movement type" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {(locs.data?.data.length ?? 0) > 1 && <Select aria-label="Location" className="w-auto" value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All locations</option>{locs.data!.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{props.errorMessage(list.error)}</Alert> : rows.length === 0 ? <EmptyState title="No movements yet">Every receipt, issue, transfer and count is recorded here and can't be edited.</EmptyState> : (
        <>
          <MovementTable rows={rows} showItem navigate={props.navigate} />
          {list.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
        </>
      )}
    </>
  );
}

// ───────────────────────── reorder ─────────────────────────
function Reorder({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const r = useQuery({ queryKey: key(tenantId, "reorder"), queryFn: () => api.get<{ currency: string; data: ReorderRow[] }>("/reorder") });
  if (r.isPending) return <Spinner />;
  if (r.isError) return <Alert>{errorMessage(r.error)}</Alert>;
  if (!r.data.data.length) return <EmptyState title="Nothing to reorder">Items show up here when stock falls to their reorder point.</EmptyState>;
  const total = r.data.data.reduce((s, x) => s + x.estCost, 0);
  return (
    <Card className="overflow-x-auto"><Table aria-label="Reorder list">
      <THead><TR><TH>SKU</TH><TH>Item</TH><TH className="text-right">On hand</TH><TH className="text-right">Reorder at</TH><TH className="text-right">Suggested order</TH><TH className="text-right">Est. cost</TH></TR></THead>
      <TBody>
        {r.data.data.map((x) => (
          <TR key={x.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${x.id}`)}>
            <TD className="font-mono text-xs">{x.sku}</TD><TD className="font-medium">{x.name}</TD>
            <TD className={`text-right tabular-nums ${x.onHand <= 0 ? "text-danger" : ""}`}>{fmtQty(x.onHand, x.unit)}</TD>
            <TD className="text-right tabular-nums text-muted">{fmtQty(x.reorderPoint)}</TD>
            <TD className="text-right tabular-nums">{fmtQty(x.suggestedQty, x.unit)}</TD>
            <TD className="text-right tabular-nums">{fmtMoney(x.estCost, r.data.currency)}</TD>
          </TR>
        ))}
        <TR><TD colSpan={5} className="text-right font-medium">Total</TD><TD className="text-right font-medium tabular-nums">{fmtMoney(total, r.data.currency)}</TD></TR>
      </TBody>
    </Table></Card>
  );
}

// ───────────────────────── locations ─────────────────────────
function Locations(props: SlotProps) {
  const { api, tenantId, can, errorMessage } = props;
  const inval = useInvalidate(tenantId);
  const locs = useLocations(props);
  const [name, setName] = useState(""), [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const add = useMutation({ mutationFn: () => api.post("/locations", { name, position: locs.data?.data.length ?? 0 }), onSuccess: () => { setName(""); inval(); } });
  const patch = useMutation({ mutationFn: ({ id, b }: { id: string; b: Partial<Location> }) => api.patch(`/locations/${id}`, b), onSuccess: () => { setEditing(null); inval(); } });
  if (locs.isPending) return <Spinner />;
  if (locs.isError) return <Alert>{errorMessage(locs.error)}</Alert>;
  const manage = can(P.manage);
  return (
    <Card>
      <CardHeader><CardTitle>Locations</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {(add.error || patch.error) && <Alert>{errorMessage(add.error ?? patch.error)}</Alert>}
        <ul className="divide-y rounded-md border" aria-label="Locations">
          {locs.data.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === l.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); patch.mutate({ id: l.id, b: { name: editing.name } }); }}>
                  <Input aria-label="Location name" required maxLength={80} autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <span className="font-medium">{l.name}</span>{l.archived && <Badge>Archived</Badge>}
                  <span className="text-muted">{l.itemsInStock} item{l.itemsInStock === 1 ? "" : "s"} in stock</span>
                  <span className="flex-1" />
                  {manage && <Button size="sm" variant="ghost" onClick={() => setEditing({ id: l.id, name: l.name })}>Rename</Button>}
                  {manage && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: l.id, b: { archived: !l.archived } })}>{l.archived ? "Restore" : "Archive"}</Button>}
                </>
              )}
            </li>
          ))}
        </ul>
        {manage && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="min-w-48 flex-1"><Field label="New location">{(a) => <Input {...a} required maxLength={80} placeholder="e.g. Back room, Van 2" value={name} onChange={(e) => setName(e.target.value)} />}</Field></div>
            <Button type="submit" disabled={add.isPending}>Add location</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── item page ─────────────────────────
function ItemPage(props: SlotProps & { id: string }) {
  const { api, tenantId, can, navigate, errorMessage, id } = props;
  const q = useQuery({ queryKey: key(tenantId, "item", id), queryFn: () => api.get<ItemDetail>(`/items/${id}`) });
  const hist = useMovements(props, `itemId=${id}&limit=25`);
  const [dialog, setDialog] = useState<MoveType | "edit" | null>(null);
  const inval = useInvalidate(tenantId);
  const archive = useMutation({ mutationFn: (archived: boolean) => api.patch(`/items/${id}`, { archived }), onSuccess: inval });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const i = q.data;
  const rows = hist.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={i.name} description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{i.sku}</span>{i.category && <span>· {i.category}</span>}<StockBadge low={i.low} onHand={i.onHand} />{i.archived && <Badge>Archived</Badge>}</span>}
        actions={<Button variant="ghost" onClick={() => navigate(ROOT)}>All items</Button>} />
      {archive.error && <Alert>{errorMessage(archive.error)}</Alert>}
      {!i.archived && (
        <div className="mb-4 flex flex-wrap gap-2">
          {can(P.move) && <><Button onClick={() => setDialog("receive")}>Receive</Button><Button variant="outline" onClick={() => setDialog("issue")}>Issue</Button><Button variant="outline" onClick={() => setDialog("transfer")}>Move</Button></>}
          {can(P.adjust) && <Button variant="outline" onClick={() => setDialog("adjust")}>Adjust</Button>}
          <span className="flex-1" />
          {can(P.manage) && <Button variant="ghost" onClick={() => setDialog("edit")}>Edit</Button>}
          {can(P.manage) && <Button variant="ghost" onClick={() => archive.mutate(true)}>Archive</Button>}
        </div>
      )}
      {i.archived && can(P.manage) && <div className="mb-4"><Button variant="outline" onClick={() => archive.mutate(false)}>Restore item</Button></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Stock</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-3xl font-semibold tabular-nums" aria-label="On hand">{fmtQty(i.onHand, i.unit)}</p>
            <ul className="grid gap-1" aria-label="Stock by location">
              {i.stock.map((s) => <li key={s.locationId} className="flex justify-between"><span>{s.location}</span><span className="tabular-nums">{fmtQty(s.quantity)}</span></li>)}
            </ul>
            {i.reorderPoint != null && <p className="text-muted">Reorder at {fmtQty(i.reorderPoint)}{i.reorderQty ? `, order ${fmtQty(i.reorderQty, i.unit)}` : ""}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {([["Unit cost", fmtMoney(i.cost, i.currency)], ["Sale price", i.price == null ? "—" : fmtMoney(i.price, i.currency)], ["Stock value", fmtMoney(i.value, i.currency)],
                ["Unit", i.unit], ["Barcode", i.barcode ?? "—"]] as const).map(([l, v]) => <div key={l}><dt className="text-xs text-muted">{l}</dt><dd className="tabular-nums">{v}</dd></div>)}
            </dl>
            {i.description && <p className="mt-3 whitespace-pre-wrap text-sm">{i.description}</p>}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-2 mt-6 text-lg font-semibold">History</h2>
      {hist.isPending ? <Spinner /> : hist.isError ? <Alert>{errorMessage(hist.error)}</Alert> : rows.length === 0 ? <p className="text-sm text-muted">No movements yet.</p> : (
        <>
          <MovementTable rows={rows} showItem={false} navigate={navigate} />
          {hist.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" disabled={hist.isFetchingNextPage} onClick={() => void hist.fetchNextPage()}>Load more</Button></div>}
        </>
      )}
      {dialog === "edit" && <ItemDialog {...props} item={i} currency={i.currency} onClose={() => setDialog(null)} />}
      {dialog && dialog !== "edit" && <MoveDialog {...props} item={i} type={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Ban, ClipboardCopy, PackageCheck, Plus, Send, Trash2 } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, PageHeader, Select,
  Skeleton, Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  OrderBadge, centsToInput, errorMessage, fmtDate, fmtDateTime, fmtMoney, fmtQty, parseMoney, parseQty, useLoad, type Config, type ItemList, type Order,
} from "./shared.tsx";

type Line = { itemId: string; itemName: string; unit: string; qty: string; cost: string };
const toLines = (o: Order): Line[] => o.lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, unit: l.unit, qty: String(l.quantity), cost: centsToInput(l.unitCostCents) }));

export function OrderDetail({ params }: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const ord = useLoad(() => host.api.get<Order>(`/orders/${params.id}`), [params.id]);
  if (ord.error || cfg.error) return <Card><ErrorState error={ord.error ?? cfg.error} onRetry={() => { void ord.reload(); void cfg.reload(); }} /></Card>;
  if (!ord.data || !cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  return <View o={ord.data} cfg={cfg.data} reload={() => void ord.reload()} />;
}

function View({ o, cfg, reload }: { o: Order; cfg: Config; reload: () => void }) {
  const host = useModuleHost();
  const editable = cfg.canManage && o.can.edit;
  const [lines, setLines] = useState<Line[]>(() => toLines(o));
  const [notes, setNotes] = useState(o.notes ?? "");
  const [expectedOn, setExpectedOn] = useState(o.expectedOn ?? "");
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"send" | "cancel" | "delete" | null>(null);
  const [receiving, setReceiving] = useState(false);
  useEffect(() => { setLines(toLines(o)); setNotes(o.notes ?? ""); setExpectedOn(o.expectedOn ?? ""); }, [o]);
  const items = useLoad(() => (editable ? host.api.get<ItemList>("/items") : Promise.resolve(null)), [editable]);

  const parsed = lines.map((l) => ({ q: parseQty(l.qty), c: parseMoney(l.cost) }));
  const lineError = (n: number) => {
    const p = parsed[n]!;
    return !p.q ? "Enter a quantity above 0 (max 3 decimals)" : p.c === null ? "Use an amount like 2.50" : undefined;
  };
  const total = parsed.reduce((a, p) => a + (p.q && p.c !== null ? Math.round(p.q * p.c) : 0), 0);
  const dirty = JSON.stringify(lines) !== JSON.stringify(toLines(o)) || notes !== (o.notes ?? "") || expectedOn !== (o.expectedOn ?? "");
  const available = (items.data?.data ?? []).filter((i) => !lines.some((l) => l.itemId === i.id));

  function addItem(id: string) {
    const i = items.data?.data.find((x) => x.id === id);
    if (!i) return;
    setLines([...lines, { itemId: i.id, itemName: i.name, unit: i.unit, qty: String(i.low ? i.suggestedQty : 1), cost: centsToInput(i.unitCostCents) }]);
    setAdding("");
  }
  const setLine = (n: number, k: "qty" | "cost", v: string) => setLines(lines.map((l, i) => (i === n ? { ...l, [k]: v } : l)));

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (lines.some((_, n) => lineError(n))) { setError("Fix the highlighted lines"); return false; }
    setSaving(true); setError(null);
    try {
      await host.api.patch(`/orders/${o.id}`, {
        notes: notes.trim() || null, expectedOn: expectedOn || null,
        lines: lines.map((l, n) => ({ itemId: l.itemId, quantity: parsed[n]!.q!, unitCostCents: parsed[n]!.c! })),
      });
      toast.success("Order saved");
      reload();
      return true;
    } catch (err) { setError(errorMessage(err)); return false; } finally { setSaving(false); }
  }
  async function act(path: string, ok: string) {
    if (dirty && path !== "cancel" && !(await save())) throw new Error("not saved");
    try { await host.api.post(`/orders/${o.id}/${path}`, {}); toast.success(ok); reload(); }
    catch (e) { toast.error(errorMessage(e)); throw e; }
  }
  async function copyText() {
    const text = [
      `Purchase order ${o.number}`, o.expectedOn ? `Delivery by ${fmtDate(o.expectedOn)}` : null, "",
      ...o.lines.map((l) => `- ${fmtQty(l.quantity)} ${l.unit} ${l.itemName}${l.sku ? ` (${l.sku})` : ""}`),
      o.notes ? `\n${o.notes}` : null,
    ].filter((x) => x !== null).join("\n");
    try { await navigator.clipboard.writeText(text); toast.success("Order copied. Paste it into an email or message to your supplier."); }
    catch { toast.error("Couldn't copy. Select the lines and copy them by hand."); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/purchase-orders")}><ArrowLeft /> Purchase orders</Button>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3" data-testid="order-title">{o.number} · {o.supplierName}<OrderBadge status={o.status} /></span>}
        description={`Created ${fmtDateTime(o.createdAt)}${o.createdByName ? ` by ${o.createdByName}` : ""}${o.sentAt ? ` · Sent ${fmtDateTime(o.sentAt)}` : ""}${o.receivedAt ? ` · Received ${fmtDateTime(o.receivedAt)}${o.receivedByName ? ` by ${o.receivedByName}` : ""}` : ""}`}
        actions={<>
          {o.lines.length > 0 && <Button variant="outline" onClick={() => void copyText()}><ClipboardCopy /> Copy as text</Button>}
          {cfg.canManage && o.can.delete && <Button variant="ghost" className="text-destructive" onClick={() => setConfirm("delete")}><Trash2 /> Delete draft</Button>}
          {cfg.canManage && o.can.cancel && !o.can.delete && <Button variant="outline" onClick={() => setConfirm("cancel")}><Ban /> Cancel order</Button>}
          {cfg.canManage && o.can.send && <Button variant="outline" onClick={() => setConfirm("send")}><Send /> Mark as sent</Button>}
          {cfg.canManage && o.can.receive && <Button onClick={() => setReceiving(true)} disabled={dirty}><PackageCheck /> Receive</Button>}
        </>} />

      <form onSubmit={(e) => void save(e)} noValidate className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!lines.length ? <p className="text-sm text-muted-foreground">No items yet.{editable ? " Add them below." : ""}</p> : (
              <Table aria-label="Order lines">
                <THead><TR>
                  <TH>Item</TH><TH className="w-36 text-right">Quantity</TH><TH className="w-36 text-right">Unit cost</TH><TH className="text-right">Total</TH>
                  {o.status === "received" && <TH className="text-right">Received</TH>}{editable && <TH><span className="sr-only">Remove</span></TH>}
                </TR></THead>
                <TBody>
                  {lines.map((l, n) => {
                    const err = editable ? lineError(n) : undefined;
                    const p = parsed[n]!;
                    const saved = o.lines.find((x) => x.itemId === l.itemId);
                    return (
                      <TR key={l.itemId}>
                        <TD>
                          <button type="button" className="font-medium hover:underline" onClick={() => host.navigate(`/inventory/${l.itemId}`)}>{l.itemName}</button>
                          {err && <p className="text-xs text-destructive">{err}</p>}
                        </TD>
                        <TD className="text-right">
                          {editable
                            ? <div className="flex items-center justify-end gap-1.5"><Input aria-label={`Quantity of ${l.itemName}`} aria-invalid={!p.q || undefined} inputMode="decimal" className="w-20 text-right" value={l.qty} onChange={(e) => setLine(n, "qty", e.target.value)} /><span className="text-xs text-muted-foreground">{l.unit}</span></div>
                            : <span className="tabular-nums">{fmtQty(Number(l.qty))} {l.unit}</span>}
                        </TD>
                        <TD className="text-right">
                          {editable
                            ? <Input aria-label={`Unit cost of ${l.itemName}`} aria-invalid={p.c === null || undefined} inputMode="decimal" className="ml-auto w-24 text-right" value={l.cost} onChange={(e) => setLine(n, "cost", e.target.value)} />
                            : <span className="tabular-nums">{fmtMoney(p.c ?? 0, o.currency)}</span>}
                        </TD>
                        <TD className="text-right tabular-nums">{p.q && p.c !== null ? fmtMoney(Math.round(p.q * p.c), o.currency) : "—"}</TD>
                        {o.status === "received" && <TD className="text-right tabular-nums">{fmtQty(saved?.receivedQty ?? 0)} {l.unit}</TD>}
                        {editable && <TD className="text-right"><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.itemName}`} onClick={() => setLines(lines.filter((_, i) => i !== n))}><Trash2 /></Button></TD>}
                      </TR>
                    );
                  })}
                  <TR className="font-semibold hover:bg-transparent">
                    <TD colSpan={3}>Total</TD><TD className="text-right tabular-nums" data-testid="order-total">{fmtMoney(total, o.currency)}</TD>
                    {o.status === "received" && <TD />}{editable && <TD />}
                  </TR>
                </TBody>
              </Table>
            )}
            {editable && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <Field label="Add item" className="w-72">
                  {(a) => (
                    <Select {...a} value={adding} onChange={(e) => addItem(e.target.value)}>
                      <option value="">Choose an item…</option>
                      {available.map((i) => <option key={i.id} value={i.id}>{i.name}{i.low ? " (low)" : ""}</option>)}
                    </Select>
                  )}
                </Field>
                {!items.data?.data.length && !items.loading && (
                  <Button type="button" variant="link" onClick={() => host.navigate("/inventory/new")}><Plus /> Add an item to inventory first</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-[12rem_1fr]">
          <Field label="Expected delivery">{(a) => editable ? <Input {...a} type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /> : <p id={a.id} className="text-sm">{fmtDate(o.expectedOn)}</p>}</Field>
          <Field label="Notes for the supplier">{(a) => editable ? <Textarea {...a} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /> : <p id={a.id} className="text-sm">{o.notes || "—"}</p>}</Field>
        </Card>

        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {editable && (
          <div className="flex gap-2">
            <Button type="submit" loading={saving} disabled={!dirty}>Save changes</Button>
            {dirty && <Button type="button" variant="outline" onClick={() => { setLines(toLines(o)); setNotes(o.notes ?? ""); setExpectedOn(o.expectedOn ?? ""); setError(null); }}>Undo changes</Button>}
          </div>
        )}
      </form>

      {receiving && <ReceiveDialog o={o} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); reload(); }} />}
      <ConfirmDialog open={confirm === "send"} onOpenChange={(v) => { if (!v) setConfirm(null); }} confirmLabel="Mark as sent" title={`Mark ${o.number} as sent?`}
        description="Do this once you've sent the order to the supplier. You can still change it until it's received." onConfirm={() => act("send", "Marked as sent")} />
      <ConfirmDialog open={confirm === "cancel"} onOpenChange={(v) => { if (!v) setConfirm(null); }} destructive confirmLabel="Cancel order" title={`Cancel ${o.number}?`}
        description="Stock doesn't change. The items can be ordered again." onConfirm={() => act("cancel", "Order cancelled")} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(v) => { if (!v) setConfirm(null); }} destructive confirmLabel="Delete" title={`Delete draft ${o.number}?`}
        description="The draft is removed for good."
        onConfirm={async () => {
          try { await host.api.del(`/orders/${o.id}`); toast.success("Draft deleted"); host.navigate("/purchase-orders"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}

function ReceiveDialog({ o, onClose, onDone }: { o: Order; onClose: () => void; onDone: () => void }) {
  const host = useModuleHost();
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(o.lines.map((l) => [l.id, String(l.quantity)])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(o.lines.map((l) => [l.id, parseQty(got[l.id] ?? "")]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(parsed).some((v) => v === null || v === undefined)) { setError("Enter what arrived for every line (0 if nothing)"); return; }
    setBusy(true); setError(null);
    try {
      await host.api.post(`/orders/${o.id}/receive`, { lines: o.lines.map((l) => ({ lineId: l.id, receivedQty: parsed[l.id]! })), note: note.trim() || null });
      toast.success(`${o.number} received. Stock updated.`);
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent wide title={`Receive ${o.number}`} description="Check what arrived. Each amount is added to stock and logged as a delivery.">
        <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
          <Table aria-label="Received quantities">
            <THead><TR><TH>Item</TH><TH className="text-right">Ordered</TH><TH className="w-40 text-right">Arrived</TH></TR></THead>
            <TBody>
              {o.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.itemName}</TD>
                  <TD className="text-right tabular-nums">{fmtQty(l.quantity)} {l.unit}</TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Input aria-label={`Arrived of ${l.itemName}`} aria-invalid={!parsed[l.id] && parsed[l.id] !== 0 || undefined} inputMode="decimal" className="w-20 text-right"
                        value={got[l.id] ?? ""} onChange={(e) => setGot({ ...got, [l.id]: e.target.value })} />
                      <span className="text-xs text-muted-foreground">{l.unit}</span>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Field label="Note">{(a) => <Input {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. One box damaged" />}</Field>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Receive and update stock</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

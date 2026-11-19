import { useState, type FormEvent } from "react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, cn, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { REASONS, errorMessage, fmtQty, parseQty, type Item, type Reason } from "./shared.tsx";

/** Record a stock change with a reason. Count correction sets the counted amount; the others add or take away. */
export function AdjustDialog({ item, initial = "usage", onClose, onSaved }: { item: Item; initial?: Reason; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [reason, setReason] = useState<Reason>(initial);
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = REASONS.find((x) => x.key === reason)!;
  const q = parseQty(raw);
  const after = typeof q === "number" ? (r.sign === 0 ? q : Math.round((item.stock + r.sign * q) * 1000) / 1000) : null;
  const qtyError = q === null ? "Use a number with at most 3 decimals" : after !== null && after < 0 ? `Only ${fmtQty(item.stock)} ${item.unit} in stock` : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (q === undefined) { setError(reason === "count" ? "Enter what you counted" : "Enter a quantity"); return; }
    if (qtyError || q === null) return;
    if (reason !== "count" && q <= 0) { setError("Enter a quantity more than 0"); return; }
    setBusy(true); setError(null);
    try {
      await host.api.post(`/items/${item.id}/adjust`, { reason, quantity: q, note: note.trim() || null });
      toast.success(`${item.name}: ${fmtQty(after ?? 0)} ${item.unit} in stock`);
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Change stock: ${item.name}`} description={`Now ${fmtQty(item.stock)} ${item.unit} in stock.`}>
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">Why?</legend>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map((x) => (
                <label key={x.key} className={cn("flex cursor-pointer flex-col rounded-md border p-2.5 text-sm", reason === x.key && "border-primary bg-primary/5 ring-1 ring-primary")}>
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="reason" value={x.key} checked={reason === x.key} onChange={() => setReason(x.key)} className="accent-[var(--color-primary)]" />{x.label}
                  </span>
                  <span className="pl-5 text-xs text-muted-foreground">{x.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={reason === "count" ? `Counted (${item.unit})` : `Quantity (${item.unit})`} required error={qtyError}
            hint={after !== null && !qtyError ? `Stock after: ${fmtQty(after)} ${item.unit}` : undefined}>
            {(a) => <Input {...a} inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus placeholder="0" />}
          </Field>
          <Field label="Note">{(a) => <Input {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "waste" ? "e.g. Past the date" : "Optional"} />}</Field>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save change</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

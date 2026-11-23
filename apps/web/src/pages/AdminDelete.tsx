import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, Field, Input, toast } from "@office/ui";
import { errorMessage, request } from "../api/client.ts";

/** Deleting a business: type its name to confirm. */
export function DeleteBusinessDialog({ business, onClose, onDeleted }: {
  business: { id: string; name: string } | null; onClose: () => void; onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [erase, setErase] = useState(false);
  useEffect(() => { setTyped(""); setBusy(false); setErase(false); }, [business?.id]);
  const matches = !!business && typed.trim().toLowerCase() === business.name.trim().toLowerCase();

  const go = async () => {
    if (!business || !matches) return;
    setBusy(true);
    try {
      await request("POST", `/platform/businesses/${business.id}/delete`, { body: { confirmName: typed.trim(), ...(erase ? { erase: true } : {}) } });
      toast.success(erase ? `${business.name} and all its data were erased for good` : `${business.name} was deleted`);
      onDeleted();
      onClose();
    } catch (e) {
      toast.error(`${business.name} was not deleted: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!business} onOpenChange={(o) => !o && onClose()}>
      {business && (
        <DialogContent title={`Delete ${business.name}?`} description="This can't be undone from the app.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Everyone in <strong className="text-foreground">{business.name}</strong> loses access, and its automations, scheduled work and API keys stop.</li>
              <li>Open invitations to it stop working.</li>
              <li>Its data is kept for 30 days, then erased for good, together with the accounts of people who belong to no other business.</li>
              <li>If you only want to close it for a while, <strong className="text-foreground">pause</strong> it instead.</li>
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={erase} onCheckedChange={(v) => setErase(v === true)} className="mt-0.5" aria-label="Also erase all its data permanently right now" />
              <span><strong>Also erase all its data permanently, right now.</strong> For a privacy or deletion request. This cannot be undone and there is no 30-day wait.</span>
            </label>
            <Field label={`Type "${business.name}" to confirm`}>
              {(a) => <Input {...a} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!matches} loading={busy}><Trash2 /> {erase ? "Delete and erase everything" : "Delete business"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

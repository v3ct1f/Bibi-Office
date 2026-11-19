import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Select, Textarea } from "@office/ui";

const REASONS = ["Price too high", "Went with a competitor", "No budget", "No decision / went quiet", "Not a good fit"];

/** Ask why a deal was lost (optional) before moving it to a lost stage. */
export function LostDialog({ open, onOpenChange, title, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; onConfirm: (reason: string | null) => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPick(""); setOther(""); } }, [open]);
  const reason = pick === "other" ? other.trim() : pick;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Mark “${title}” as lost?`} description="Knowing why deals are lost helps you win the next ones. You can reopen it later.">
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await onConfirm(reason || null); onOpenChange(false); } catch { /* caller shows the error */ } finally { setBusy(false); }
        }}>
          <Field label="Reason (optional)">{(a) => (
            <Select {...a} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">No reason</option>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="other">Something else…</option>
            </Select>
          )}</Field>
          {pick === "other" && <Field label="Describe the reason">{(a) => <Textarea {...a} rows={2} maxLength={500} value={other} onChange={(e) => setOther(e.target.value)} />}</Field>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Mark as lost</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

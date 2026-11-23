import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, toast } from "@office/ui";
import { errorMessage, request } from "../api/client.ts";
import { userManager } from "../auth/auth.tsx";

/**
 * Deleting a business, in two steps: type its name, then enter your password again on the sign-in page.
 * The pending deletion waits in sessionStorage while the browser is away at the sign-in page.
 */
const KEY = "office.pendingBusinessDelete";
interface Pending { id: string; name: string; confirmName: string; at: number }

export function DeleteBusinessDialog({ business, email, onClose }: { business: { id: string; name: string } | null; email: string; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTyped(""); setBusy(false); }, [business?.id]);
  const matches = !!business && typed.trim().toLowerCase() === business.name.trim().toLowerCase();

  const go = async () => {
    if (!business || !matches) return;
    setBusy(true);
    try { sessionStorage.setItem(KEY, JSON.stringify({ id: business.id, name: business.name, confirmName: typed.trim(), at: Date.now() } satisfies Pending)); }
    catch { /* no storage: the deletion just won't continue */ }
    await userManager.signinRedirect({ prompt: "login", max_age: 0, login_hint: email, state: { returnTo: "/admin" } }).catch((e) => {
      setBusy(false);
      toast.error(errorMessage(e));
    });
  };

  return (
    <Dialog open={!!business} onOpenChange={(o) => !o && onClose()}>
      {business && (
        <DialogContent title={`Delete ${business.name}?`} description="This can't be undone from the app.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Everyone in <strong className="text-foreground">{business.name}</strong> loses access, and its automations, scheduled work and API keys stop.</li>
              <li>Open invitations to it stop working.</li>
              <li>If you only want to close it for a while, <strong className="text-foreground">pause</strong> it instead.</li>
            </ul>
            <Field label={`Type "${business.name}" to confirm`}>
              {(a) => <Input {...a} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />}
            </Field>
            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              Next, you'll be asked for your password. The business is deleted as soon as you enter it.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!matches} loading={busy}><Trash2 /> Continue with password</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** After returning from the password step: finish the deletion that was waiting (once, within 10 minutes). */
export function usePendingBusinessDelete(onDone: () => void) {
  useEffect(() => {
    let p: Pending | null = null;
    try {
      const raw = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
      p = raw ? (JSON.parse(raw) as Pending) : null;
    } catch { p = null; }
    if (!p || Date.now() - p.at > 10 * 60_000) return;
    const { id, name, confirmName } = p;
    request("POST", `/platform/businesses/${id}/delete`, { body: { confirmName } })
      .then(() => { toast.success(`${name} was deleted`); onDone(); })
      .catch((e) => toast.error(`${name} was not deleted: ${errorMessage(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

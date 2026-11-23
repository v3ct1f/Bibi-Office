import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, MailCheck, UserPlus } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, Skeleton,
} from "@office/ui";
import { errorMessage, request } from "../api/client.ts";
import { fmtDate } from "../lib/format.ts";

interface Owner { id: string; email: string; name: string | null; signedIn: boolean; addedBy: string; createdAt: string; you: boolean }

/** Program admin → Program owners: add a co-owner, remove one, or hand the program over to someone else. */
export function ProgramOwners() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const owners = useQuery({ queryKey: ["platform", "owners"], queryFn: () => request<{ items: Owner[] }>("GET", "/platform/owners") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "owners"] });

  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [added, setAdded] = useState<(Owner & { emailed: boolean }) | null>(null);
  const add = useMutation({
    mutationFn: () => request<Owner & { emailed: boolean }>("POST", "/platform/owners", { body: { email: email.trim() } }),
    onSuccess: (r) => { setAdded(r); void refresh(); },
  });
  const closeAdd = () => { setAdding(false); setAdded(null); setEmail(""); add.reset(); };

  const [removing, setRemoving] = useState<Owner | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (o: Owner) => request<{ self: boolean }>("DELETE", `/platform/owners/${o.id}`),
    onSuccess: async (r) => {
      if (r.self) { await qc.invalidateQueries({ queryKey: ["me"] }); navigate({ to: "/", replace: true }); } else void refresh();
    },
    onError: (e) => setRemoveError(errorMessage(e)),
  });

  const [transferring, setTransferring] = useState(false);
  const [to, setTo] = useState("");
  const [sure, setSure] = useState(false);
  const transfer = useMutation({
    mutationFn: () => request("POST", "/platform/owners/transfer", { body: { email: to.trim() } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["me"] }); navigate({ to: "/", replace: true }); },
  });
  const closeTransfer = () => { setTransferring(false); setTo(""); setSure(false); transfer.reset(); };

  const items = owners.data?.items ?? [];
  return (
    <section aria-labelledby="owners-title" className="mt-4 grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="owners-title" className="text-lg font-semibold">Program owners</h2>
          <p className="text-sm text-muted-foreground">People who run Office: they create businesses, pause them and choose their features.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setTransferring(true)}><Crown /> Transfer ownership</Button>
          <Button onClick={() => setAdding(true)}><UserPlus /> Add co-owner</Button>
        </div>
      </div>
      {owners.isError ? <Card><ErrorState error={owners.error} onRetry={() => owners.refetch()} /></Card>
        : owners.isPending ? <Card className="p-4"><Skeleton className="h-10" /></Card>
        : (
          <Card>
            <ul aria-label="Program owners" className="divide-y">
              {items.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{o.name || o.email}</span>
                      {o.you && <Badge variant="neutral">You</Badge>}
                      {!o.signedIn && <Badge variant="warning">Hasn't signed in yet</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {o.name ? `${o.email} · ` : ""}{o.addedBy === "config" ? "Set up with the installation" : `Added by ${o.addedBy} on ${fmtDate(o.createdAt)}`}
                    </div>
                  </div>
                  {items.length > 1 && (
                    <Button size="sm" variant="ghost" aria-label={o.you ? "Step down as owner" : `Remove ${o.email}`}
                      onClick={() => { setRemoveError(null); setRemoving(o); }}>{o.you ? "Step down" : "Remove"}</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      {removeError && <p role="alert" className="text-sm text-destructive">{removeError}</p>}

      <Dialog open={adding} onOpenChange={(o) => (o ? setAdding(true) : closeAdd())}>
        {added ? (
          <DialogContent title="Co-owner added">
            <p role="status" className="flex items-start gap-2 text-sm">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-success" />
              {added.email} is now a program owner{added.emailed ? ", and we emailed them" : ""}. They get access when they sign in with that address.
            </p>
            <DialogFooter><Button onClick={closeAdd}>Done</Button></DialogFooter>
          </DialogContent>
        ) : (
          <DialogContent title="Add a co-owner" description="They'll have the same control over Office as you, including adding and removing owners.">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <Field label="Their email" required>{(a) => <Input {...a} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />}</Field>
              {add.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(add.error)}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeAdd}>Cancel</Button>
                <Button type="submit" loading={add.isPending} disabled={!email.trim()}>Add co-owner</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={transferring} onOpenChange={(o) => (o ? setTransferring(true) : closeTransfer())}>
        <DialogContent title="Transfer ownership" description="Hand Office over to someone else. They become the program owner and you lose access to Program admin.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); transfer.mutate(); }}>
            <Field label="New owner's email" hint="They must have signed in to Office at least once." required>
              {(a) => <Input {...a} type="email" required autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />}
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              <span>I understand I'll no longer be a program owner. Businesses I'm a member of are not affected.</span>
            </label>
            {transfer.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(transfer.error)}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={closeTransfer}>Cancel</Button>
              <Button type="submit" variant="destructive" loading={transfer.isPending} disabled={!to.trim() || !sure}>Transfer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive
        confirmLabel={removing?.you ? "Step down" : "Remove"}
        title={removing?.you ? "Step down as program owner?" : `Remove ${removing?.email}?`}
        description={removing?.you
          ? "You lose access to Program admin. The other owners keep running Office."
          : "They lose access to Program admin straight away. Businesses they're a member of are not affected."}
        onConfirm={() => remove.mutateAsync(removing!)} />
    </section>
  );
}

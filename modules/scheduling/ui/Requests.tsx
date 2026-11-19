import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  KIND_LABEL, SwapBadge, TimeOffBadge, errorMessage, fmtDay, fmtRange, shiftTime, useLoad, type Config, type Swap, type TimeOff, type TimeOffKind,
} from "./shared.tsx";

type Decision = { kind: "time-off" | "swaps"; id: string; action: "approve" | "reject"; title: string };

export function Requests(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const mine = useLoad(() => host.api.get<TimeOff[]>("/time-off", { mine: "true" }), []);
  const swaps = useLoad(() => host.api.get<Swap[]>("/swaps"), []);
  const manage = !!cfg.data?.canManage;
  const pending = useLoad(() => (manage ? host.api.get<TimeOff[]>("/time-off", { status: "pending" }) : Promise.resolve([])), [manage]);
  const [decision, setDecision] = useState<Decision | null>(null);

  const reloadAll = () => { void mine.reload(); void swaps.reload(); void pending.reload(); };
  async function act(path: string, ok: string) {
    try { await host.api.post(path, {}); toast.success(ok); reloadAll(); } catch (e) { toast.error(errorMessage(e)); }
  }

  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  const me = cfg.data.me;
  const toDecide = (swaps.data ?? []).filter((s) => s.can.decide);
  const incoming = (swaps.data ?? []).filter((s) => s.to.userId === me && !s.can.decide);
  const outgoing = (swaps.data ?? []).filter((s) => s.from.userId === me && !s.can.decide);

  return (
    <>
      <PageHeader title="Time off & swaps" description={manage
        ? "Approve time off and shift swaps for your team, and ask for your own."
        : "Ask for days off or ask a colleague to take a shift. A manager approves both."} />
      <div className="grid gap-4 lg:grid-cols-2">
        {manage && (
          <Card className="lg:col-span-2" data-testid="to-approve">
            <CardHeader><CardTitle>Waiting for your approval</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {pending.loading && !pending.data ? <Skeleton className="h-16" /> : pending.error ? <ErrorState error={pending.error} onRetry={() => void pending.reload()} /> : null}
              {!pending.data?.length && !toDecide.length && !pending.loading && <p className="text-sm text-muted-foreground">Nothing waiting. 🎉</p>}
              {pending.data?.map((t) => (
                <div key={t.id} role="group" className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3" aria-label={`Time off for ${t.employeeName}`}>
                  <div className="grid gap-0.5 text-sm">
                    <p className="font-medium">{t.employeeName}: {KIND_LABEL[t.kind]}, {fmtRange(t.startDate, t.endDate)}</p>
                    {t.reason && <p className="text-muted-foreground">“{t.reason}”</p>}
                    {t.conflicts.length > 0 && (
                      <p className="text-amber-700 dark:text-amber-400">
                        Has {t.conflicts.length} shift{t.conflicts.length === 1 ? "" : "s"} then: {t.conflicts.map((c) => `${fmtDay(c.day)} ${shiftTime(c)}`).join(", ")}. Reassign them after approving.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "time-off", id: t.id, action: "reject", title: `Reject ${t.employeeName}'s time off?` })}><X /> Reject</Button>
                    <Button size="sm" onClick={() => setDecision({ kind: "time-off", id: t.id, action: "approve", title: `Approve ${t.employeeName}'s time off?` })}><Check /> Approve</Button>
                  </div>
                </div>
              ))}
              {toDecide.map((s) => (
                <div key={s.id} role="group" className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3" aria-label={`Swap from ${s.from.name} to ${s.to.name}`}>
                  <div className="grid gap-0.5 text-sm">
                    <p className="font-medium">Swap: {s.from.name} → {s.to.name}</p>
                    <p className="text-muted-foreground">{swapText(s)}</p>
                    {s.message && <p className="text-muted-foreground">“{s.message}”</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "swaps", id: s.id, action: "reject", title: "Reject this swap?" })}><X /> Reject</Button>
                    <Button size="sm" onClick={() => setDecision({ kind: "swaps", id: s.id, action: "approve", title: "Approve this swap?" })}><Check /> Approve swap</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <TimeOffForm onSaved={() => { void mine.reload(); void pending.reload(); }} />

        <Card>
          <CardHeader><CardTitle>Swap requests</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {swaps.error ? <ErrorState error={swaps.error} onRetry={() => void swaps.reload()} />
              : !swaps.data ? <Skeleton className="h-16" />
              : !incoming.length && !outgoing.length ? <p className="text-sm text-muted-foreground">No swap requests. To ask for one, click one of your shifts on the Schedule.</p>
              : null}
            {incoming.map((s) => (
              <div key={s.id} role="group" className="grid gap-2 rounded-md border p-3 text-sm" aria-label={`Swap request from ${s.from.name}`}>
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{s.from.name} asks you</p><SwapBadge status={s.status} /></div>
                <p className="text-muted-foreground">{swapText(s, true)}</p>
                {s.message && <p className="text-muted-foreground">“{s.message}”</p>}
                {s.can.respond && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void act(`/swaps/${s.id}/decline`, "Declined")}>Decline</Button>
                    <Button size="sm" onClick={() => void act(`/swaps/${s.id}/accept`, "Accepted. A manager will approve it.")}>Accept</Button>
                  </div>
                )}
              </div>
            ))}
            {outgoing.map((s) => (
              <div key={s.id} role="group" className="grid gap-2 rounded-md border p-3 text-sm" aria-label={`Your swap request to ${s.to.name}`}>
                <div className="flex items-center justify-between gap-2"><p className="font-medium">You asked {s.to.name}</p><SwapBadge status={s.status} /></div>
                <p className="text-muted-foreground">{swapText(s)}</p>
                {s.decisionComment && <p className="text-muted-foreground">{s.decidedByName}: “{s.decisionComment}”</p>}
                {s.can.cancel && <div><Button size="sm" variant="outline" onClick={() => void act(`/swaps/${s.id}/cancel`, "Swap request cancelled")}>Cancel request</Button></div>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>My time off</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.reload()} />
              : !mine.data ? <Skeleton className="h-16" />
              : !mine.data.length ? <p className="text-sm text-muted-foreground">You haven't asked for time off yet.</p>
              : mine.data.map((t) => (
                <div key={t.id} role="group" className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" aria-label={`My time off ${t.startDate}`}>
                  <div className="grid gap-0.5">
                    <p className="font-medium">{KIND_LABEL[t.kind]}: {fmtRange(t.startDate, t.endDate)}</p>
                    {t.decisionComment && <p className="text-muted-foreground">{t.decidedByName}: “{t.decisionComment}”</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <TimeOffBadge status={t.status} />
                    {(t.status === "pending" || (t.status === "approved" && t.startDate > cfg.data!.today)) && (
                      <Button size="sm" variant="ghost" onClick={() => void act(`/time-off/${t.id}/cancel`, "Time off cancelled")}>Cancel</Button>
                    )}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {decision && <DecisionDialog d={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); reloadAll(); }} />}
    </>
  );
}

function swapText(s: Swap, forThem = false) {
  const theirs = s.shift ? `${fmtDay(s.shift.day)} ${shiftTime(s.shift)}` : "a shift";
  if (s.targetShift) return `${forThem ? "Their" : "Shift"} ${theirs} in exchange for ${forThem ? "your" : "the"} ${fmtDay(s.targetShift.day)} ${shiftTime(s.targetShift)}`;
  return forThem ? `Take their shift ${theirs}` : `${s.from.name}'s shift ${theirs} goes to ${s.to.name}`;
}

function TimeOffForm({ onSaved }: { onSaved: () => void }) {
  const host = useModuleHost();
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toError = from && to && to < from ? "The last day can't be before the first day" : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!from || !to) { setError("Choose the first and last day"); return; }
    if (toError) return;
    setBusy(true); setError(null);
    try {
      await host.api.post("/time-off", { kind, startDate: from, endDate: to, reason: reason.trim() || null });
      toast.success("Time off requested. A manager will approve it.");
      setFrom(""); setTo(""); setReason("");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Ask for time off</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label="Type">
            {(a) => <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First day" required>{(a) => <Input {...a} type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to) setTo(e.target.value); }} />}</Field>
            <Field label="Last day" required error={toError}>{(a) => <Input {...a} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
          <Field label="Reason">{(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />}</Field>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div><Button type="submit" loading={busy}>Request time off</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function DecisionDialog({ d, onClose, onDone }: { d: Decision; onClose: () => void; onDone: () => void }) {
  const host = useModuleHost();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const reject = d.action === "reject";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reject && !comment.trim()) { toast.error("Say why, so they know"); return; }
    setBusy(true);
    try {
      const r = await host.api.post<{ conflicts?: { day: string }[] }>(`/${d.kind}/${d.id}/${d.action}`, comment.trim() ? { comment: comment.trim() } : {});
      toast.success(reject ? "Rejected" : "Approved");
      if (!reject && r.conflicts?.length) toast.warning(`They still have ${r.conflicts.length} shift${r.conflicts.length === 1 ? "" : "s"} in that period. Reassign them on the Schedule.`);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={d.title}>
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <Field label={reject ? "Reason" : "Comment (optional)"} required={reject}>
            {(a) => <Textarea {...a} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={reject ? "destructive" : "default"} loading={busy}>{reject ? "Reject" : "Approve"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

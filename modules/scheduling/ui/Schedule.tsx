import { useState, type FormEvent } from "react";
import { ArrowLeftRight, Copy, Plus, Send, Tags, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Textarea, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  COLORS, COLOR_CLASS, DOT_CLASS, KIND_LABEL, WeekNav, addDays, errorMessage, fmtDay, fmtDayNum, fmtHours, fmtWeekday, shiftTime, useLoad,
  weekStart, type Color, type Config, type Shift, type Week,
} from "./shared.tsx";

export function Schedule(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-80" /></div>;
  return <Board cfg={cfg.data} />;
}

type Draft = { id?: string; employeeId: string; positionId: string; day: string; start: string; end: string; breakMinutes: string; notes: string };

function Board({ cfg }: { cfg: Config }) {
  const host = useModuleHost();
  const [start, setStart] = useState(weekStart(cfg.today));
  const w = useLoad(() => host.api.get<Week>("/week", { start }), [start]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [swapFor, setSwapFor] = useState<Shift | null>(null);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copying, setCopying] = useState(false);
  const manage = cfg.canManage;

  async function publish() {
    try {
      const r = await host.api.post<{ published: number }>("/week/publish", { start });
      toast.success(`Published ${r.published} shift${r.published === 1 ? "" : "s"}. Your team can see them now.`);
      await w.reload();
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  }
  async function copyLastWeek() {
    setCopying(true);
    try {
      const r = await host.api.post<{ copied: number; skipped: string[] }>("/week/copy", { from: addDays(start, -7), to: start });
      if (r.copied) toast.success(`Copied ${r.copied} shift${r.copied === 1 ? "" : "s"} from last week as drafts`);
      else toast.info("Nothing to copy from last week");
      if (r.skipped.length) toast.warning(`Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).join("; ")}${r.skipped.length > 3 ? "…" : ""}`);
      await w.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setCopying(false); }
  }

  const d = w.data;
  const people = d ? [...d.people].sort((a, b) => (a.userId === cfg.me ? -1 : b.userId === cfg.me ? 1 : a.name.localeCompare(b.name))) : [];
  const posOf = (id: string | null) => d?.positions.find((p) => p.id === id);
  const newDraft = (employeeId: string, day: string): Draft => ({ employeeId, day, positionId: "", start: "09:00", end: "17:00", breakMinutes: "0", notes: "" });

  return (
    <>
      <PageHeader title="Schedule" description={manage
        ? "Plan shifts per person and position. New shifts are drafts until you publish the week."
        : "Your team's published shifts. Your own row is at the top."}
        actions={manage && <>
          <Button variant="outline" onClick={() => setPositionsOpen(true)}><Tags /> Positions</Button>
          <Button variant="outline" loading={copying} onClick={() => void copyLastWeek()}><Copy /> Copy last week</Button>
          <Button disabled={!d?.drafts} onClick={() => setPublishing(true)}><Send /> Publish week{d?.drafts ? ` (${d.drafts} draft${d.drafts === 1 ? "" : "s"})` : ""}</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekNav start={start} today={cfg.today} onChange={setStart} />
        {d && <p className="text-xs text-muted-foreground">Times in {d.timezone}</p>}
      </div>

      {w.error ? <Card><ErrorState error={w.error} onRetry={() => void w.reload()} /></Card>
        : !d ? <Skeleton className="h-80" />
        : !people.length ? <Card><EmptyState title="No one to schedule yet" description="Invite your team under Settings → Members first." /></Card>
        : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm" aria-label="Weekly schedule">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="w-40 px-3 py-2 text-left font-medium text-muted-foreground">Person</th>
                  {d.days.map((day) => (
                    <th key={day} scope="col" className={cn("px-2 py-2 text-left font-medium", day === d.today && "text-primary")}>
                      <span className="block">{fmtWeekday(day)}</span><span className="text-xs font-normal text-muted-foreground">{fmtDayNum(day)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const theirs = d.shifts.filter((s) => s.employeeId === p.userId);
                  const total = theirs.reduce((a, s) => a + s.minutes, 0);
                  return (
                    <tr key={p.userId} className={cn("border-b last:border-0 align-top", p.userId === cfg.me && "bg-primary/5")} data-testid={`row-${p.name}`}>
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        <span className="block truncate">{p.name}{p.userId === cfg.me && <span className="text-muted-foreground"> (you)</span>}</span>
                        <span className="text-xs font-normal text-muted-foreground">{fmtHours(total)}</span>
                      </th>
                      {d.days.map((day) => {
                        const off = d.timeOff.find((t) => t.employeeId === p.userId && t.startDate <= day && t.endDate >= day);
                        const cell = theirs.filter((s) => s.day === day);
                        return (
                          <td key={day} className={cn("px-1.5 py-1.5", day === d.today && "bg-muted/40")}>
                            <div className="grid gap-1">
                              {off && (
                                <Badge variant={off.status === "approved" ? "neutral" : "warning"} className="justify-center">
                                  {KIND_LABEL[off.kind]}{off.status === "pending" ? "?" : ""}
                                </Badge>
                              )}
                              {cell.map((s) => {
                                const pos = posOf(s.positionId);
                                const clickable = manage || (s.mine && s.published && day >= d.today && !s.swapPending);
                                return (
                                  <button key={s.id} type="button" disabled={!clickable}
                                    aria-label={`${p.name} ${fmtDay(day)} ${shiftTime(s)}${pos ? ` ${pos.name}` : ""}${s.published ? "" : " (draft)"}`}
                                    onClick={() => manage
                                      ? setEditing({ id: s.id, employeeId: s.employeeId, positionId: s.positionId ?? "", day: s.day, start: s.start, end: s.end, breakMinutes: String(s.breakMinutes), notes: s.notes ?? "" })
                                      : setSwapFor(s)}
                                    className={cn(
                                      "grid w-full rounded-md border-l-4 px-1.5 py-1 text-left text-xs transition-colors",
                                      COLOR_CLASS[pos?.color ?? "gray"],
                                      !s.published && "border border-dashed border-l-4 opacity-80",
                                      clickable ? "cursor-pointer hover:brightness-95" : "cursor-default",
                                    )}>
                                    <span className="font-medium tabular-nums">{shiftTime(s)}</span>
                                    {pos && <span className="truncate text-muted-foreground">{pos.name}</span>}
                                    {!s.published && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Draft</span>}
                                    {s.swapPending && <span className="text-[10px] text-muted-foreground">Swap requested</span>}
                                  </button>
                                );
                              })}
                              {manage && (
                                <Button variant="ghost" size="sm" className="h-7 w-full text-muted-foreground"
                                  aria-label={`Add shift for ${p.name} on ${fmtDay(day)}`} onClick={() => setEditing(newDraft(p.userId, day))}>
                                  <Plus />
                                </Button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

      {d && !manage && cfg.canSelf && (
        <p className="mt-3 text-sm text-muted-foreground"><ArrowLeftRight className="mr-1 inline size-4" />Can't make one of your shifts? Click it to ask a colleague to take it.</p>
      )}

      {d && editing && <ShiftDialog week={d} draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void w.reload(); }} />}
      {d && swapFor && <SwapDialog week={d} shift={swapFor} me={cfg.me} onClose={() => setSwapFor(null)} onSaved={() => { setSwapFor(null); void w.reload(); }} />}
      {d && positionsOpen && <PositionsDialog week={d} onClose={() => setPositionsOpen(false)} onChanged={() => void w.reload()} />}
      <ConfirmDialog open={publishing} onOpenChange={setPublishing} confirmLabel="Publish" title="Publish this week?"
        description={`${d?.drafts ?? 0} draft shift${d?.drafts === 1 ? "" : "s"} become visible to your team.`} onConfirm={publish} />
    </>
  );
}

function ShiftDialog({ week, draft, onClose, onSaved }: { week: Week; draft: Draft; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [f, setF] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const brk = Number(f.breakMinutes || 0);
  const breakError = !Number.isInteger(brk) || brk < 0 ? "Whole minutes, 0 or more" : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (breakError) return;
    if (f.start === f.end) { setError("Start and end can't be the same time"); return; }
    setBusy(true); setError(null);
    const body = { employeeId: f.employeeId, positionId: f.positionId || null, day: f.day, start: f.start, end: f.end, breakMinutes: brk, notes: f.notes.trim() || null };
    try {
      if (f.id) await host.api.patch(`/shifts/${f.id}`, body); else await host.api.post("/shifts", body);
      toast.success(f.id ? "Shift updated" : "Shift added as a draft");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={f.id ? "Edit shift" : "Add shift"} description={f.end <= f.start ? "Ends after midnight, on the next day." : undefined}>
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Person" required>
              {(a) => <Select {...a} value={f.employeeId} onChange={set("employeeId")}>{week.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</Select>}
            </Field>
            <Field label="Position">
              {(a) => (
                <Select {...a} value={f.positionId} onChange={set("positionId")}>
                  <option value="">No position</option>
                  {week.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Day" required>{(a) => <Input {...a} type="date" value={f.day} onChange={set("day")} required />}</Field>
            <Field label="Break (minutes)" error={breakError}>{(a) => <Input {...a} type="number" min={0} max={600} step={5} value={f.breakMinutes} onChange={set("breakMinutes")} />}</Field>
            <Field label="Start" required>{(a) => <Input {...a} type="time" value={f.start} onChange={set("start")} required />}</Field>
            <Field label="End" required>{(a) => <Input {...a} type="time" value={f.end} onChange={set("end")} required />}</Field>
          </div>
          <Field label="Notes">{(a) => <Textarea {...a} rows={2} maxLength={500} value={f.notes} onChange={set("notes")} placeholder="e.g. Open the terrace" />}</Field>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="sm:justify-between">
            {f.id ? <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 /> Delete shift</Button> : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>{f.id ? "Save shift" : "Add shift"}</Button>
            </div>
          </DialogFooter>
        </form>
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive confirmLabel="Delete" title="Delete this shift?"
          description="If the week was published, the person no longer sees it."
          onConfirm={async () => {
            try { await host.api.del(`/shifts/${f.id}`); toast.success("Shift deleted"); onSaved(); }
            catch (e) { toast.error(errorMessage(e)); throw e; }
          }} />
      </DialogContent>
    </Dialog>
  );
}

function SwapDialog({ week, shift, me, onClose, onSaved }: { week: Week; shift: Shift; me: string | null; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const colleagues = week.people.filter((p) => p.userId !== me);
  const [to, setTo] = useState(colleagues[0]?.userId ?? "");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theirShifts = week.shifts.filter((s) => s.employeeId === to && s.day >= week.today && s.published);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await host.api.post("/swaps", { shiftId: shift.id, toEmployeeId: to, targetShiftId: target || null, message: message.trim() || null });
      toast.success("Swap request sent. Your colleague needs to accept, then a manager approves.");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Ask to swap this shift" description={`${fmtDay(shift.day)}, ${shiftTime(shift)}`}>
        {!colleagues.length ? <p className="text-sm text-muted-foreground">There is no colleague to swap with.</p> : (
          <form className="grid gap-4" onSubmit={(e) => void send(e)}>
            <Field label="Colleague" required>
              {(a) => <Select {...a} value={to} onChange={(e) => { setTo(e.target.value); setTarget(""); }}>{colleagues.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</Select>}
            </Field>
            <Field label="In exchange for" hint="Leave empty if they just take your shift.">
              {(a) => (
                <Select {...a} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Nothing, they take it</option>
                  {theirShifts.map((s) => <option key={s.id} value={s.id}>{fmtDay(s.day)} {shiftTime(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. I have a doctor's appointment" />}</Field>
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>Send request</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PositionsDialog({ week, onClose, onChanged }: { week: Week; onClose: () => void; onChanged: () => void }) {
  const host = useModuleHost();
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Give the position a name"); return; }
    setBusy(true); setError(null);
    try { await host.api.post("/positions", { name: name.trim(), color }); setName(""); toast.success("Position added"); onChanged(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await host.api.del(`/positions/${id}`); toast.success("Position removed"); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); }
  }
  async function recolor(id: string, c: Color) {
    try { await host.api.patch(`/positions/${id}`, { color: c }); onChanged(); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Positions" description="Roles people work in, like Bar, Kitchen or Floor. Each gets a colour in the schedule.">
        <ul className="grid gap-2" aria-label="Positions">
          {!week.positions.length && <li className="text-sm text-muted-foreground">No positions yet.</li>}
          {week.positions.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className={cn("size-3 rounded-full", DOT_CLASS[p.color])} aria-hidden />
              <span className="flex-1 truncate">{p.name}</span>
              <Select aria-label={`Colour for ${p.name}`} className="w-28" value={p.color} onChange={(e) => void recolor(p.id, e.target.value as Color)}>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Button variant="ghost" size="icon" aria-label={`Remove ${p.name}`} onClick={() => void remove(p.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <form className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end" onSubmit={(e) => void add(e)}>
          <Field label="New position" error={error ?? undefined}>{(a) => <Input {...a} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen" />}</Field>
          <Field label="Colour">{(a) => <Select {...a} value={color} onChange={(e) => setColor(e.target.value as Color)}>{COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
          <Button type="submit" loading={busy}><Plus /> Add</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

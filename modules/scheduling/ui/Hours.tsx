import { Fragment, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Download, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Table, TBody, TD, TH, THead, TR, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { WeekNav, addDays, downloadText, errorMessage, fmtDay, fmtHours, useLoad, weekStart, type Config, type Entry } from "./shared.tsx";

interface Row { employeeId: string; name: string | null; scheduledMinutes: number; workedMinutes: number; clockedIn: boolean; entries: Entry[] }
interface Sheet { from: string; to: string; timezone: string; rows: Row[] }
type EntryDraft = { id?: string; employeeId: string; date: string; in: string; out: string; note: string };

export function Hours(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  if (!cfg.data.canManage) return <Card><EmptyState title="Only managers see everyone's hours" description="Your own hours are on the Time clock page." /></Card>;
  return <Sheet cfg={cfg.data} />;
}

function Sheet({ cfg }: { cfg: Config }) {
  const host = useModuleHost();
  const [mode, setMode] = useState<"week" | "range">("week");
  const [start, setStart] = useState(weekStart(cfg.today));
  const [from, setFrom] = useState(addDays(cfg.today, -13));
  const [to, setTo] = useState(cfg.today);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [exporting, setExporting] = useState(false);
  const range = mode === "week" ? { from: start, to: addDays(start, 6) } : { from, to };
  const rangeError = mode === "range" && (!from || !to) ? "Choose both dates" : mode === "range" && to < from ? "The end date is before the start date" : undefined;
  const sheet = useLoad(() => (rangeError ? Promise.reject(new Error(rangeError)) : host.api.get<Sheet>("/timesheet", range)), [range.from, range.to, rangeError]);

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await host.api.get<{ filename: string; csv: string; rows: number }>("/timesheet/export", range);
      downloadText(r.filename, r.csv);
      toast.success(`Exported ${r.rows} time entr${r.rows === 1 ? "y" : "ies"}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setExporting(false); }
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const d = sheet.data;
  const total = (k: "scheduledMinutes" | "workedMinutes") => d?.rows.reduce((a, r) => a + r[k], 0) ?? 0;

  return (
    <>
      <PageHeader title="Hours" description="Planned vs worked hours per person. Fix missed clock-ins, then export for payroll."
        actions={<>
          <Button variant="outline" disabled={!d?.rows.length} onClick={() => setEditing({ employeeId: d?.rows[0]?.employeeId ?? "", date: cfg.today, in: "09:00", out: "17:00", note: "" })}><Plus /> Add entry</Button>
          <Button loading={exporting} disabled={!!rangeError} onClick={() => void exportCsv()}><Download /> Export CSV</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label="Period" className="flex gap-1.5">
          <Button role="tab" aria-selected={mode === "week"} size="sm" variant={mode === "week" ? "default" : "outline"} onClick={() => setMode("week")}>Week</Button>
          <Button role="tab" aria-selected={mode === "range"} size="sm" variant={mode === "range" ? "default" : "outline"} onClick={() => setMode("range")}>Date range</Button>
        </div>
        {mode === "week" ? <WeekNav start={start} today={cfg.today} onChange={setStart} /> : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To" error={rangeError}>{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
        )}
      </div>

      {sheet.error ? <Card><ErrorState error={sheet.error} onRetry={rangeError ? undefined : () => void sheet.reload()} /></Card>
        : !d ? <Skeleton className="h-64" />
        : !d.rows.length ? <Card><EmptyState title="No one here yet" description="Invite your team under Settings → Members." /></Card>
        : (
          <Card className="overflow-x-auto">
            <Table aria-label="Hours per person">
              <THead><TR><TH>Person</TH><TH className="text-right">Planned</TH><TH className="text-right">Worked</TH><TH className="text-right">Difference</TH><TH>Entries</TH></TR></THead>
              <TBody>
                {d.rows.map((r) => {
                  const diff = r.workedMinutes - r.scheduledMinutes;
                  const isOpen = open.has(r.employeeId);
                  return (
                    <Fragment key={r.employeeId}>
                      <TR data-testid={`hours-${r.name}`}>
                        <TD>
                          <button type="button" className="flex items-center gap-1 font-medium" aria-expanded={isOpen} onClick={() => toggle(r.employeeId)}>
                            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{r.name}
                          </button>
                          {r.clockedIn && <Badge variant="success" className="ml-5 mt-1">Working now</Badge>}
                        </TD>
                        <TD className="text-right tabular-nums">{fmtHours(r.scheduledMinutes)}</TD>
                        <TD className="text-right font-medium tabular-nums">{fmtHours(r.workedMinutes)}</TD>
                        <TD className={cn("text-right tabular-nums", diff > 0 ? "text-amber-700 dark:text-amber-400" : diff < 0 ? "text-muted-foreground" : "")}>
                          {diff === 0 ? "—" : `${diff > 0 ? "+" : "−"}${fmtHours(Math.abs(diff))}`}
                        </TD>
                        <TD className="text-muted-foreground">{r.entries.length}</TD>
                      </TR>
                      {isOpen && (
                        <TR className="hover:bg-transparent">
                          <TD colSpan={5} className="bg-muted/30 p-0">
                            {!r.entries.length ? <p className="px-8 py-3 text-sm text-muted-foreground">No time recorded in this period.</p> : (
                              <table className="w-full text-sm" aria-label={`Entries for ${r.name}`}>
                                <tbody>
                                  {r.entries.map((e) => (
                                    <tr key={e.id} className="border-t">
                                      <td className="py-2 pl-8 pr-3 whitespace-nowrap">{fmtDay(e.date)}</td>
                                      <td className="px-3 tabular-nums">{e.in} – {e.open ? <Badge variant="success">Working</Badge> : `${e.out}${e.overnight ? " (+1)" : ""}`}</td>
                                      <td className="px-3 text-right tabular-nums">{fmtHours(e.minutes)}</td>
                                      <td className="max-w-56 truncate px-3 text-muted-foreground">
                                        {e.note}{e.source === "manual" ? <Badge variant="outline" className="ml-1">Added by manager</Badge> : e.edited ? <Badge variant="outline" className="ml-1">Edited</Badge> : null}
                                      </td>
                                      <td className="px-3 text-right whitespace-nowrap">
                                        {!e.open && <Button variant="ghost" size="icon" aria-label={`Edit entry ${e.date} ${e.in}`}
                                          onClick={() => setEditing({ id: e.id, employeeId: e.employeeId, date: e.date, in: e.in, out: e.out ?? "", note: e.note ?? "" })}><Pencil /></Button>}
                                        <Button variant="ghost" size="icon" aria-label={`Delete entry ${e.date} ${e.in}`} onClick={() => setDeleting(e)}><Trash2 /></Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  );
                })}
                <TR className="font-semibold hover:bg-transparent">
                  <TD>Total</TD>
                  <TD className="text-right tabular-nums">{fmtHours(total("scheduledMinutes"))}</TD>
                  <TD className="text-right tabular-nums" data-testid="hours-total">{fmtHours(total("workedMinutes"))}</TD>
                  <TD colSpan={2} />
                </TR>
              </TBody>
            </Table>
          </Card>
        )}

      {d && editing && <EntryDialog people={d.rows} draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setOpen((s) => new Set(s).add(editing.employeeId)); void sheet.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title="Delete this time entry?"
        description={deleting ? `${fmtDay(deleting.date)}, ${deleting.in}–${deleting.out ?? "now"}. The hours are no longer counted.` : undefined}
        onConfirm={async () => {
          try { await host.api.del(`/entries/${deleting!.id}`); toast.success("Entry deleted"); void sheet.reload(); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}

function EntryDialog({ people, draft, onClose, onSaved }: { people: Row[]; draft: EntryDraft; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [f, setF] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EntryDraft) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f.date || !f.in || !f.out) { setError("Fill in the day, clock-in and clock-out"); return; }
    if (f.in === f.out) { setError("Clock-in and clock-out can't be the same time"); return; }
    setBusy(true); setError(null);
    try {
      if (f.id) await host.api.patch(`/entries/${f.id}`, { date: f.date, in: f.in, out: f.out, note: f.note.trim() || null });
      else await host.api.post("/entries", { employeeId: f.employeeId, date: f.date, in: f.in, out: f.out, note: f.note.trim() || null });
      toast.success(f.id ? "Entry updated" : "Entry added");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={f.id ? "Edit time entry" : "Add time entry"} description={f.out && f.in && f.out < f.in ? "Clock-out is on the next day." : "For a missed or wrong clock-in."}>
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <Field label="Person" required>
            {(a) => <Select {...a} value={f.employeeId} disabled={!!f.id} onChange={set("employeeId")}>{people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name}</option>)}</Select>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Day" required>{(a) => <Input {...a} type="date" value={f.date} onChange={set("date")} />}</Field>
            <Field label="Clock in" required>{(a) => <Input {...a} type="time" value={f.in} onChange={set("in")} />}</Field>
            <Field label="Clock out" required>{(a) => <Input {...a} type="time" value={f.out} onChange={set("out")} />}</Field>
          </div>
          <Field label="Note">{(a) => <Input {...a} maxLength={300} value={f.note} onChange={set("note")} placeholder="e.g. Forgot to clock in" />}</Field>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>{f.id ? "Save entry" : "Add entry"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

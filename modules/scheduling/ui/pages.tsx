import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch,
  Table, TBody, TD, TH, THead, TR, Textarea, cn,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { addDays, byDay, fmtDayLong, fmtDayShort, fmtTime, fmtWhen, hhmmToMin, localDate, minToHHMM, P, StatusBadge, weekStart, WEEKDAYS } from "./common.tsx";
import type { Booking, HoursRule, Service, Slot, TimeOff } from "./types.ts";

type Tab = "agenda" | "hours" | "services";
const keyOf = (tenantId: string, ...k: unknown[]) => ["tenant", tenantId, "scheduling", ...k];
const useSettingsTz = ({ api, tenantId }: Pick<SlotProps, "api" | "tenantId">) =>
  useQuery({ queryKey: keyOf(tenantId, "hours", "me"), queryFn: () => api.get<{ hostId: string; timezone: string; rules: HoursRule[] }>("/hours") });
const useServices = ({ api, tenantId }: Pick<SlotProps, "api" | "tenantId">) =>
  useQuery({ queryKey: keyOf(tenantId, "services"), queryFn: () => api.get<{ data: Service[] }>("/services") });

/** /m/scheduling/calendar */
export function CalendarPage(props: SlotProps) {
  const { can } = props;
  const tabs = ([["agenda", "Bookings", true], ["hours", "My hours", can(P.own) || can(P.manage)], ["services", "Services", can(P.services)]] as const).filter((t) => t[2]);
  const [tab, setTab] = useState<Tab>("agenda");
  const [creating, setCreating] = useState(false);
  const bookingLink = props.tenantSlug ? `${window.location.origin}/p/${props.tenantSlug}/scheduling/book` : "";
  return (
    <>
      <PageHeader title="Calendar" description="Appointments with customers, your working hours, and what people can book."
        actions={<div className="flex flex-wrap gap-2">
          {bookingLink && <Button variant="outline" asChild><a href={bookingLink} target="_blank" rel="noopener noreferrer">Booking page</a></Button>}
          {can(P.write) && <Button onClick={() => setCreating(true)}>New booking</Button>}
        </div>} />
      <div role="tablist" aria-label="Calendar view" className="mb-3 flex flex-wrap gap-1">
        {tabs.map(([k, label]) => <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? "secondary" : "ghost"} onClick={() => setTab(k)}>{label}</Button>)}
      </div>
      {tab === "agenda" && <Agenda {...props} />}
      {tab === "hours" && <MyHours {...props} />}
      {tab === "services" && <Services {...props} bookingLink={bookingLink} />}
      {creating && <NewBookingDialog {...props} onClose={() => setCreating(false)} />}
    </>
  );
}

// ───────────────────────── agenda ─────────────────────────
function Agenda(props: SlotProps) {
  const { api, tenantId, errorMessage } = props;
  const me = useSettingsTz(props);
  const tz = me.data?.timezone ?? "UTC";
  const [start, setStart] = useState(() => weekStart(localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)));
  const [who, setWho] = useState<"all" | "me">("all");
  const [open, setOpen] = useState<Booking | null>(null);
  const end = addDays(start, 7);
  // Range is padded a day each side so bookings near midnight in the business time zone aren't missed.
  const q = useQuery({
    queryKey: keyOf(tenantId, "bookings", start, who), enabled: !!me.data,
    queryFn: () => api.get<{ data: Booking[] }>(`/bookings?from=${addDays(start, -1)}T00:00:00Z&to=${addDays(end, 1)}T00:00:00Z${who === "me" ? `&hostId=${me.data!.hostId}` : ""}`),
  });
  const days = useMemo(() => {
    const m = byDay((q.data?.data ?? []).map((b) => ({ ...b, start: b.startsAt })), tz);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => [d, m.get(d) ?? []] as const);
  }, [q.data, tz, start]);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>←</Button>
        <Button variant="outline" size="sm" onClick={() => setStart(weekStart(localDate(new Date(), tz)))}>This week</Button>
        <Button variant="outline" size="sm" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>→</Button>
        <span className="text-sm font-medium">{fmtDayShort(start)} – {fmtDayShort(addDays(start, 6))}</span>
        <Select aria-label="Whose bookings" className="ml-auto w-auto" value={who} onChange={(e) => setWho(e.target.value as "all" | "me")}>
          <option value="all">Everyone</option><option value="me">Only mine</option>
        </Select>
      </div>
      <p className="mb-3 text-xs text-muted">Times in {tz.replace(/_/g, " ")}.</p>
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
        <div className="grid gap-3">
          {days.map(([d, list]) => (
            <section key={d} aria-label={fmtDayLong(d)} className="grid gap-2">
              <h2 className="text-sm font-semibold">{fmtDayLong(d)}</h2>
              {list.length === 0 ? <p className="text-sm text-muted">No bookings</p> : (
                <ul className="grid gap-2">
                  {list.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => setOpen(b)}
                        className={cn("grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-surface px-3 py-2 text-left text-sm hover:border-primary/60", b.status === "cancelled" && "opacity-60")}>
                        <span className="whitespace-nowrap tabular-nums font-medium">{fmtTime(b.startsAt, tz)}–{fmtTime(b.endsAt, tz)}</span>
                        <span className="min-w-0"><span className="block truncate font-medium">{b.customerName}</span><span className="block truncate text-muted">{b.serviceName} · {b.hostName ?? "—"}</span></span>
                        <StatusBadge s={b.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {open && <BookingDialog {...props} booking={open} tz={tz} onClose={() => setOpen(null)} />}
    </>
  );
}

function BookingDialog(props: SlotProps & { booking: Booking; tz: string; onClose(): void }) {
  const { api, tenantId, can, errorMessage, navigate, tz, onClose } = props;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keyOf(tenantId, "booking", props.booking.id), queryFn: () => api.get<Booking>(`/bookings/${props.booking.id}`), initialData: props.booking });
  const b = q.data;
  const [mode, setMode] = useState<"view" | "cancel" | "move">("view");
  const [reason, setReason] = useState("");
  const act = useMutation({
    mutationFn: (fn: () => Promise<Booking>) => fn(),
    onSuccess: (d) => { qc.setQueryData(keyOf(tenantId, "booking", d.id), d); void qc.invalidateQueries({ queryKey: keyOf(tenantId) }); setMode("view"); },
  });
  const started = Date.parse(b.startsAt) <= Date.now();
  const live = b.status === "confirmed";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={b.customerName} description={`${b.serviceName ?? ""} · ${fmtWhen(b.startsAt, tz)}–${fmtTime(b.endsAt, tz)}`}
      footer={mode === "view" ? <div className="flex flex-wrap justify-end gap-2">
        {live && can(P.write) && started && <>
          <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/bookings/${b.id}/outcome`, { status: "no_show" }))}>No-show</Button>
          <Button disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/bookings/${b.id}/outcome`, { status: "completed" }))}>Completed</Button>
        </>}
        {live && can(P.write) && !started && <>
          <Button variant="outline" onClick={() => setMode("move")}>Reschedule</Button>
          <Button variant="danger" onClick={() => setMode("cancel")}>Cancel booking</Button>
        </>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div> : undefined}>
      <div className="grid gap-3">
        {act.error && <Alert>{errorMessage(act.error)}</Alert>}
        {mode === "view" && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Status</dt><dd><StatusBadge s={b.status} /></dd>
            <dt className="text-muted">With</dt><dd>{b.hostName ?? "—"}</dd>
            <dt className="text-muted">Email</dt><dd>{b.customerEmail ?? "—"}</dd>
            <dt className="text-muted">Phone</dt><dd>{b.customerPhone ?? "—"}</dd>
            <dt className="text-muted">Booked</dt><dd>{b.source === "public" ? "Online by the customer" : "By the team"}</dd>
            {b.contactId && <><dt className="text-muted">Contact</dt><dd><a className="text-primary hover:underline" href={`/contacts/${b.contactId}`} onClick={(e) => { e.preventDefault(); onClose(); navigate(`/contacts/${b.contactId}`); }}>Open contact</a></dd></>}
            {b.notes && <><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{b.notes}</dd></>}
            {b.cancelReason && <><dt className="text-muted">Cancelled</dt><dd>{b.cancelReason}</dd></>}
          </dl>
        )}
        {mode === "cancel" && (
          <>
            <Field label="Reason (optional)">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMode("view")}>Keep booking</Button>
              <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/bookings/${b.id}/cancel`, { reason: reason || undefined }))}>Cancel booking</Button>
            </div>
          </>
        )}
        {mode === "move" && (
          <SlotPicker {...props} serviceId={b.serviceId} hostId={b.hostId} tz={tz}
            onPick={(s) => act.mutate(() => api.post(`/bookings/${b.id}/reschedule`, { start: s.start }))} onCancel={() => setMode("view")} />
        )}
      </div>
    </Dialog>
  );
}

/** Free start times for a service over a week, grouped by day. */
function SlotPicker({ api, tenantId, errorMessage, serviceId, hostId, tz, onPick, onCancel }: Pick<SlotProps, "api" | "tenantId" | "errorMessage"> & {
  serviceId: string; hostId?: string | undefined; tz: string; onPick(s: Slot): void; onCancel?(): void;
}) {
  const [from, setFrom] = useState(() => localDate(new Date(), tz));
  const q = useQuery({
    queryKey: keyOf(tenantId, "slots", serviceId, hostId ?? "", from),
    queryFn: () => api.get<{ data: Slot[] }>(`/services/${serviceId}/slots?from=${from}&to=${addDays(from, 6)}${hostId ? `&hostId=${hostId}` : ""}`),
  });
  const days = useMemo(() => [...byDay(q.data?.data ?? [], tz).entries()], [q.data, tz]);
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Earlier" onClick={() => setFrom(addDays(from, -7))}>←</Button>
        <span className="text-sm">{fmtDayShort(from)} – {fmtDayShort(addDays(from, 6))}</span>
        <Button variant="outline" size="sm" aria-label="Later" onClick={() => setFrom(addDays(from, 7))}>→</Button>
        {onCancel && <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>Back</Button>}
      </div>
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : days.length === 0 ? <p className="text-sm text-muted">No free times this week.</p> : (
        <div className="grid max-h-80 gap-3 overflow-y-auto">
          {days.map(([d, list]) => (
            <div key={d} className="grid gap-1.5">
              <p className="text-sm font-medium">{fmtDayLong(d)}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => <Button key={s.start} size="sm" variant="outline" title={s.hostNames?.join(", ")} onClick={() => onPick(s)}>{fmtTime(s.start, tz)}</Button>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ContactLite { id: string; firstName: string | null; lastName: string | null; email: string | null }
function NewBookingDialog(props: SlotProps & { onClose(): void; contactId?: string }) {
  const { api, tenantId, errorMessage, onClose } = props;
  const qc = useQueryClient();
  const svcs = useServices(props);
  const me = useSettingsTz(props);
  const tz = me.data?.timezone ?? "UTC";
  const contacts = useQuery({ queryKey: ["tenant", tenantId, "contacts", "picker"], queryFn: () => api.core<{ data: ContactLite[] }>("/contacts?limit=100") });
  const [f, setF] = useState({ serviceId: "", hostId: "", contactId: props.contactId ?? "", name: "", email: "", phone: "", notes: "" });
  const [slot, setSlot] = useState<Slot | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Booking>("/bookings", {
      serviceId: f.serviceId, start: slot!.start, ...(f.hostId ? { hostId: f.hostId } : {}),
      ...(f.contactId ? { contactId: f.contactId } : { name: f.name, ...(f.email ? { email: f.email } : {}) }),
      ...(f.phone ? { phone: f.phone } : {}), ...(f.notes ? { notes: f.notes } : {}),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keyOf(tenantId) }); onClose(); },
  });
  const active = (svcs.data?.data ?? []).filter((s) => s.active && s.hosts.length);
  const svc = active.find((s) => s.id === f.serviceId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New booking">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (slot) create.mutate(); }}>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {svcs.isSuccess && active.length === 0 && <Alert tone="warning">Add a service with at least one person offering it first (Services tab).</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service">{(a) => (
            <Select {...a} required value={f.serviceId} onChange={(e) => { setF({ ...f, serviceId: e.target.value, hostId: "" }); setSlot(null); }}>
              <option value="">Choose…</option>{active.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}
            </Select>
          )}</Field>
          <Field label="With">{(a) => (
            <Select {...a} value={f.hostId} disabled={!svc} onChange={(e) => { setF({ ...f, hostId: e.target.value }); setSlot(null); }}>
              <option value="">Anyone available</option>{svc?.hosts.map((h) => <option key={h.id} value={h.id}>{h.name ?? h.id}</option>)}
            </Select>
          )}</Field>
        </div>
        {svc && (slot ? (
          <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">{fmtWhen(slot.start, tz)}{slot.hostNames?.length ? ` · ${f.hostId ? svc.hosts.find((h) => h.id === f.hostId)?.name : slot.hostNames.join(" or ")}` : ""}</span>
            <button type="button" className="text-primary hover:underline" onClick={() => setSlot(null)}>Change</button>
          </div>
        ) : <SlotPicker {...props} serviceId={svc.id} hostId={f.hostId || undefined} tz={tz} onPick={setSlot} />)}
        <Field label="Contact">{(a) => (
          <Select {...a} value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}>
            <option value="">New person (enter below)</option>
            {contacts.data?.data.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}</option>)}
          </Select>
        )}</Field>
        {!f.contactId && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">{(a) => <Input {...a} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Email (optional)">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          </div>
        )}
        <Field label="Notes (optional)">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!slot || create.isPending}>Book</Button>
        </div>
      </form>
    </Dialog>
  );
}
export { NewBookingDialog };

// ───────────────────────── my hours ─────────────────────────
function MyHours(props: SlotProps) {
  const { api, tenantId, errorMessage } = props;
  const qc = useQueryClient();
  const q = useSettingsTz(props);
  const off = useQuery({ queryKey: keyOf(tenantId, "time-off"), queryFn: () => api.get<{ data: TimeOff[] }>("/time-off") });
  const [rows, setRows] = useState<{ on: boolean; start: string; end: string }[] | null>(null);
  const current = rows ?? WEEKDAYS.map((_, i) => {
    const r = q.data?.rules.find((x) => x.weekday === i + 1);
    return r ? { on: true, start: minToHHMM(r.startMin), end: minToHHMM(r.endMin) } : { on: false, start: "09:00", end: "17:00" };
  });
  const save = useMutation({
    mutationFn: () => api.put("/hours", { rules: current.flatMap((r, i) => (r.on ? [{ weekday: i + 1, startMin: hhmmToMin(r.start), endMin: hhmmToMin(r.end) }] : [])) }),
    onSuccess: () => { setRows(null); void qc.invalidateQueries({ queryKey: keyOf(tenantId) }); },
  });
  const [t, setT] = useState({ from: "", to: "", reason: "" });
  const addOff = useMutation({
    mutationFn: () => api.post("/time-off", { startsAt: new Date(t.from).toISOString(), endsAt: new Date(t.to).toISOString(), ...(t.reason ? { reason: t.reason } : {}) }),
    onSuccess: () => { setT({ from: "", to: "", reason: "" }); void qc.invalidateQueries({ queryKey: keyOf(tenantId) }); },
  });
  const delOff = useMutation({ mutationFn: (id: string) => api.del(`/time-off/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: keyOf(tenantId) }) });
  const set = (i: number, patch: Partial<(typeof current)[number]>) => setRows(current.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Working hours</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted">When customers can book you. Times in {q.data.timezone.replace(/_/g, " ")}.</p>
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          {save.isSuccess && !rows && <Alert tone="success">Saved.</Alert>}
          {current.map((r, i) => (
            <div key={WEEKDAYS[i]} className="grid grid-cols-[7rem_1fr] items-center gap-2 sm:grid-cols-[7rem_auto_1fr]">
              <Switch label={WEEKDAYS[i]!} checked={r.on} onCheckedChange={(v) => set(i, { on: v })} />
              <span className="text-sm">{WEEKDAYS[i]}</span>
              {r.on ? (
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <Input type="time" aria-label={`${WEEKDAYS[i]} from`} value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
                  <span className="text-muted">–</span>
                  <Input type="time" aria-label={`${WEEKDAYS[i]} until`} value={r.end} onChange={(e) => set(i, { end: e.target.value })} />
                </div>
              ) : <span className="col-span-2 text-sm text-muted sm:col-span-1">Not available</span>}
            </div>
          ))}
          <div><Button disabled={!rows || save.isPending} onClick={() => save.mutate()}>Save hours</Button></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Time off</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted">Holidays, appointments, anything that blocks bookings. Times in your local time.</p>
          {(addOff.error || delOff.error) && <Alert>{errorMessage(addOff.error ?? delOff.error)}</Alert>}
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); addOff.mutate(); }}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="From">{(a) => <Input {...a} type="datetime-local" required value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })} />}</Field>
              <Field label="Until">{(a) => <Input {...a} type="datetime-local" required value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })} />}</Field>
            </div>
            <Field label="Reason (optional)">{(a) => <Input {...a} value={t.reason} onChange={(e) => setT({ ...t, reason: e.target.value })} />}</Field>
            <div><Button type="submit" variant="outline" disabled={addOff.isPending}>Add time off</Button></div>
          </form>
          <ul className="grid gap-1 text-sm">
            {off.data?.data.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span>{new Date(o.startsAt).toLocaleString()} – {new Date(o.endsAt).toLocaleString()}{o.reason ? ` · ${o.reason}` : ""}</span>
                <Button size="sm" variant="ghost" onClick={() => delOff.mutate(o.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── services ─────────────────────────
interface Member { userId: string; name: string | null; email: string }
function Services(props: SlotProps & { bookingLink: string }) {
  const { errorMessage, bookingLink } = props;
  const q = useServices(props);
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  return (
    <div className="grid gap-3">
      {bookingLink && <p className="text-sm text-muted">Public booking page: <a className="break-all text-primary hover:underline" href={bookingLink} target="_blank" rel="noopener noreferrer">{bookingLink}</a></p>}
      <div><Button onClick={() => setEdit("new")}>New service</Button></div>
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? (
        <EmptyState title="No services yet">Add what customers can book, how long it takes, and who offers it.</EmptyState>
      ) : (
        <Card className="overflow-x-auto"><Table>
          <THead><TR><TH>Service</TH><TH>Length</TH><TH>Offered by</TH><TH>Online</TH></TR></THead>
          <TBody>{q.data.data.map((s) => (
            <TR key={s.id} className="cursor-pointer" onClick={() => setEdit(s)}>
              <TD className="font-medium"><button type="button" className="text-left hover:underline">{s.name}</button>{!s.active && <span className="ml-2 text-xs text-muted">inactive</span>}</TD>
              <TD className="whitespace-nowrap">{s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin}` : ""}</TD>
              <TD>{s.hosts.map((h) => h.name).join(", ") || <span className="text-warning">Nobody yet</span>}</TD>
              <TD>{s.isPublic && s.active ? "Yes" : "No"}</TD>
            </TR>
          ))}</TBody>
        </Table></Card>
      )}
      {edit && <ServiceDialog {...props} service={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ServiceDialog({ api, tenantId, errorMessage, service: s, onClose }: SlotProps & { service: Service | null; onClose(): void }) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["tenant", tenantId, "members"], queryFn: () => api.core<Member[] | { data: Member[] }>("/members") });
  const list = Array.isArray(members.data) ? members.data : members.data?.data ?? [];
  const [f, setF] = useState({
    name: s?.name ?? "", durationMin: String(s?.durationMin ?? 30), bufferMin: String(s?.bufferMin ?? 0), location: s?.location ?? "",
    description: s?.description ?? "", isPublic: s?.isPublic ?? true, active: s?.active ?? true, hostIds: s?.hosts.map((h) => h.id) ?? [],
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, durationMin: Number(f.durationMin), bufferMin: Number(f.bufferMin), location: f.location || null,
        description: f.description || null, isPublic: f.isPublic, active: f.active, hostIds: f.hostIds,
      };
      return s ? api.patch(`/services/${s.id}`, body) : api.post("/services", body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keyOf(tenantId) }); onClose(); },
  });
  const toggle = (id: string) => setF({ ...f, hostIds: f.hostIds.includes(id) ? f.hostIds.filter((x) => x !== id) : [...f.hostIds, id] });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={s ? `Edit ${s.name}` : "New service"}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Name">{(a) => <Input {...a} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Cake tasting" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Length (minutes)">{(a) => <Input {...a} type="number" min={5} max={720} step={5} required value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />}</Field>
          <Field label="Break after (minutes)">{(a) => <Input {...a} type="number" min={0} max={240} step={5} value={f.bufferMin} onChange={(e) => setF({ ...f, bufferMin: e.target.value })} />}</Field>
        </div>
        <Field label="Location (optional)">{(a) => <Input {...a} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Address or video link" />}</Field>
        <Field label="Description (optional)">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">Offered by</legend>
          {members.isPending ? <Spinner /> : list.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.hostIds.includes(m.userId)} onChange={() => toggle(m.userId)} />{m.name || m.email}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-2 text-sm"><Switch label="Bookable on the public page" checked={f.isPublic} onCheckedChange={(v) => setF({ ...f, isPublic: v })} /><span aria-hidden="true">Bookable on the public page</span></div>
        <div className="flex items-center gap-2 text-sm"><Switch label="Active" checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /><span aria-hidden="true">Active</span></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{s ? "Save" : "Create service"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch, Textarea, cn,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { Avatar, EMPLOYMENT, fmtDay, fmtDays, fmtRange, fmtShort, LeaveBadge, P, ROOT, todayLocal } from "./common.tsx";
import type { Away, Balance, Doc, Employee, EmployeeDetail, Holiday, Leave, LeaveType, Member } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "hr", ...rest];
const link = (navigate: SlotProps["navigate"], to: string) => ({ href: to, onClick: (e: React.MouseEvent) => { e.preventDefault(); navigate(to); } });

/** /m/hr/people[/<employee id>] */
export function PeoplePage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <EmployeePage {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Overview {...props} />;
}

type Tab = "directory" | "timeoff" | "approvals" | "calendar" | "setup";
function Overview(props: SlotProps) {
  const { api, tenantId, can } = props;
  const approvals = useQuery({ queryKey: key(tenantId, "leave", "approvals"), queryFn: () => api.get<{ data: Leave[] }>("/leave?scope=approvals") });
  const tabs = ([
    ["directory", "Directory", true], ["timeoff", "My time off", can(P.request)],
    ["approvals", "Approvals", can(P.approve) || (approvals.data?.data.length ?? 0) > 0],
    ["calendar", "Who's away", true], ["setup", "Setup", can(P.manage)],
  ] as const).filter((t) => t[2]);
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem("hr.tab") as Tab | null; if (t) return t; } catch { /* ignore */ }
    return "directory";
  });
  const current = tabs.some((t) => t[0] === tab) ? tab : "directory";
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("hr.tab", t); } catch { /* ignore */ } };
  return (
    <>
      <PageHeader title="People" description="Your team, who reports to whom, and time off." />
      <div role="tablist" aria-label="People view" className="mb-4 flex flex-wrap gap-1">
        {tabs.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={current === k} size="sm" variant={current === k ? "secondary" : "ghost"} onClick={() => pick(k)}>
            {label}{k === "approvals" && approvals.data?.data.length ? <span className="ml-1.5 rounded bg-warning/30 px-1.5 text-xs tabular-nums">{approvals.data.data.length}</span> : null}
          </Button>
        ))}
      </div>
      {current === "directory" && <Directory {...props} />}
      {current === "timeoff" && <MyTimeOff {...props} />}
      {current === "approvals" && <Approvals {...props} />}
      {current === "calendar" && <AwayCalendar {...props} />}
      {current === "setup" && <Setup {...props} />}
    </>
  );
}

// ───────────────────────── directory ─────────────────────────
function Directory(props: SlotProps) {
  const { api, tenantId, can, navigate, errorMessage } = props;
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [dept, setDept] = useState(""), [left, setLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(dept ? { department: dept } : {}), ...(left ? { includeLeft: "true" } : {}) }).toString();
  const list = useQuery({ queryKey: key(tenantId, "employees", qs), queryFn: () => api.get<{ data: Employee[]; departments: string[] }>(`/employees${qs ? `?${qs}` : ""}`) });
  const depts = useRef<string[]>([]);
  if (list.data && !dept && !q) depts.current = list.data.departments;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search people" placeholder="Search name, title, team or email" className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
        {depts.current.length > 0 && (
          <Select aria-label="Team" className="w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All teams</option>{depts.current.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        )}
        {can(P.manage) && <label className="flex items-center gap-2 text-sm"><Switch checked={left} onCheckedChange={setLeft} label="Show people who left" />Show people who left</label>}
        <span className="flex-1" />
        {can(P.manage) && <Button onClick={() => setAdding(true)}>Add person</Button>}
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : list.data.data.length === 0 ? (
        <EmptyState title={q || dept ? "Nobody matches" : "No people yet"}>{!q && !dept && can(P.manage) ? "Add your team, link each person to their sign-in, and set who manages whom." : null}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="People">
          {list.data.data.map((e) => (
            <li key={e.id}>
              <a {...link(navigate, `${ROOT}/${e.id}`)} className="flex items-center gap-3 rounded-md border bg-surface p-3 hover:border-primary">
                <Avatar name={e.name} />
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{e.name}{e.isMe && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</span>
                  <span className="truncate text-sm text-muted">{[e.jobTitle, e.department].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                {e.status !== "active" && <Badge className="ml-auto" tone="neutral">{e.status === "left" ? "Left" : "Starts soon"}</Badge>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {adding && <EmployeeDialog {...props} onClose={() => setAdding(false)} />}
    </>
  );
}

// ───────────────────────── my time off ─────────────────────────
function BalanceCards({ b }: { b: Balance }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={`Time off ${b.year}`}>
      {([["Left", b.remaining, true], ["Allowance", b.allowance, false], ["Taken or booked", b.used, false], ["Waiting for approval", b.pending, false]] as const).map(([l, n, main]) => (
        <div key={l} className={cn("rounded-md border bg-surface px-3 py-2", main && "border-primary/40 bg-primary/5")}>
          <dt className="text-xs text-muted">{l} ({b.year})</dt>
          <dd className={cn("text-2xl font-semibold tabular-nums", main && n < 0 && "text-danger")}>{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function MyTimeOff(props: SlotProps) {
  const { api, tenantId, can, errorMessage } = props;
  const me = useQuery({ queryKey: key(tenantId, "me"), queryFn: () => api.get<{ employee: EmployeeDetail | null; balance: Balance | null }>("/me") });
  const list = useQuery({ queryKey: key(tenantId, "leave", "mine"), queryFn: () => api.get<{ data: Leave[] }>("/leave?scope=mine"), enabled: !!me.data?.employee });
  const [asking, setAsking] = useState(false);
  if (me.isPending) return <Spinner />;
  if (me.isError) return <Alert>{errorMessage(me.error)}</Alert>;
  if (!me.data.employee) {
    return <EmptyState title="You don't have a person record yet">{can(P.manage) ? "Add yourself in the directory and link your sign-in to request time off." : "Ask HR to add you and link your sign-in."}</EmptyState>;
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your time off</h2>
        <Button onClick={() => setAsking(true)}>Request time off</Button>
      </div>
      {me.data.balance && <BalanceCards b={me.data.balance} />}
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : <LeaveList {...props} rows={list.data.data} showWho={false} emptyText="No requests yet." />}
      {asking && <RequestDialog {...props} onClose={() => setAsking(false)} />}
    </div>
  );
}

function LeaveList(props: SlotProps & { rows: Leave[]; showWho: boolean; emptyText: string }) {
  const { api, tenantId, errorMessage, rows, showWho, emptyText } = props;
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: ({ id, op, note: n }: { id: string; op: "approve" | "reject" | "cancel"; note?: string }) => api.post<Leave>(`/leave/${id}/${op}`, op === "cancel" ? {} : { ...(n ? { note: n } : {}) }),
    onSuccess: () => { setRejecting(null); setNote(""); void qc.invalidateQueries({ queryKey: key(tenantId) }); },
  });
  if (!rows.length) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <div className="grid gap-2">
      {act.error && <Alert>{errorMessage(act.error)}</Alert>}
      <ul className="grid gap-2" aria-label="Time off requests">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-2 rounded-md border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                {showWho && <span className="font-medium">{r.employeeName} · </span>}
                <span className={cn(!showWho && "font-medium")}>{r.typeName}</span>
                <span className="text-muted"> · {fmtRange(r.startDate, r.endDate, r.halfDay)} · {fmtDays(r.days)}</span>
              </span>
              <LeaveBadge s={r.status} />
            </div>
            {(r.note || r.decisionNote) && (
              <p className="text-sm text-muted">{r.note && <>“{r.note}”</>}{r.note && r.decisionNote && " · "}{r.decisionNote && <>Reply: {r.decisionNote}</>}</p>
            )}
            {(r.canDecide || r.canCancel) && (
              <div className="flex flex-wrap gap-2">
                {r.canDecide && rejecting !== r.id && <>
                  <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, op: "approve" })}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setRejecting(r.id)}>Reject</Button>
                </>}
                {r.canDecide && rejecting === r.id && (
                  <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ id: r.id, op: "reject", note }); }}>
                    <div className="min-w-48 flex-1"><Field label="Reason">{(a) => <Input {...a} required autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}</Field></div>
                    <Button type="submit" size="sm" variant="danger" disabled={act.isPending}>Reject request</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(null)}>Back</Button>
                  </form>
                )}
                {r.canCancel && !r.canDecide && <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, op: "cancel" })}>Cancel request</Button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestDialog({ api, tenantId, errorMessage, onClose, employeeId }: SlotProps & { onClose(): void; employeeId?: string }) {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: key(tenantId, "types"), queryFn: () => api.get<{ data: LeaveType[] }>("/leave-types") });
  const active = types.data?.data.filter((t) => !t.archived) ?? [];
  const [f, setF] = useState({ typeId: "", startDate: todayLocal(), endDate: todayLocal(), halfDay: false, note: "" });
  const typeId = f.typeId || active[0]?.id || "";
  const single = f.startDate === f.endDate;
  const save = useMutation({
    mutationFn: () => api.post<Leave>("/leave", { ...(employeeId ? { employeeId } : {}), typeId, startDate: f.startDate, endDate: f.endDate, halfDay: single && f.halfDay, ...(f.note ? { note: f.note } : {}) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key(tenantId) }); onClose(); },
  });
  const t = active.find((x) => x.id === typeId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Request time off" description={t ? (t.needsApproval ? "Your manager gets an email and approves it." : "This type is approved right away.") : undefined}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Type">{(a) => <Select {...a} value={typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })}>{active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day">{(a) => <Input {...a} type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} />}</Field>
          <Field label="Last day">{(a) => <Input {...a} type="date" required min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
        </div>
        {single && <label className="flex items-center gap-2 text-sm"><Switch checked={f.halfDay} onCheckedChange={(v) => setF({ ...f, halfDay: v })} label="Half day" />Half day</label>}
        <Field label="Note (optional)">{(a) => <Textarea {...a} rows={2} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        <p className="text-xs text-muted">Weekends and company holidays are not counted.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || !typeId}>{save.isPending ? "Sending…" : "Send request"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Approvals(props: SlotProps) {
  const { api, tenantId, errorMessage } = props;
  const q = useQuery({ queryKey: key(tenantId, "leave", "approvals"), queryFn: () => api.get<{ data: Leave[] }>("/leave?scope=approvals") });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  return q.data.data.length ? <LeaveList {...props} rows={q.data.data} showWho emptyText="" /> : <EmptyState title="Nothing to approve">Requests from people you manage show up here.</EmptyState>;
}

// ───────────────────────── who's away ─────────────────────────
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const addMonths = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n, 1); return x.toISOString().slice(0, 10); };
const monthEnd = (d: string) => new Date(Date.parse(`${addMonths(d, 1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function AwayCalendar({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const [from, setFrom] = useState(monthStart(todayLocal()));
  const to = monthEnd(from);
  const q = useQuery({ queryKey: key(tenantId, "calendar", from), queryFn: () => api.get<{ holidays: { day: string; name: string }[]; data: Away[] }>(`/calendar?from=${from}&to=${to}`) });
  const title = new Date(`${from}T12:00:00Z`).toLocaleDateString(navigator.language || "en", { timeZone: "UTC", month: "long", year: "numeric" });
  const now = todayLocal();
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Previous month" onClick={() => setFrom(addMonths(from, -1))}>←</Button>
        <h2 className="min-w-40 text-center font-semibold">{title}</h2>
        <Button variant="outline" size="sm" aria-label="Next month" onClick={() => setFrom(addMonths(from, 1))}>→</Button>
        {from !== monthStart(now) && <Button variant="ghost" size="sm" onClick={() => setFrom(monthStart(now))}>This month</Button>}
      </div>
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
        <>
          {q.data.holidays.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Company holidays">
              {q.data.holidays.map((h) => <li key={h.day}><Badge tone="primary">{fmtShort(h.day)} · {h.name}</Badge></li>)}
            </ul>
          )}
          {q.data.data.length === 0 ? <EmptyState title="Everyone's in">No time off this month.</EmptyState> : (
            <Card><ul className="divide-y" aria-label="Away">
              {q.data.data.map((a) => {
                const nowAway = a.startDate <= now && a.endDate >= now && a.status === "approved";
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <Avatar name={a.employeeName} size="sm" />
                    <a {...link(navigate, `${ROOT}/${a.employeeId}`)} className="font-medium hover:underline">{a.employeeName}</a>
                    <span className="text-sm text-muted">{fmtRange(a.startDate, a.endDate, a.halfDay)}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {nowAway && <Badge tone="warning">Away today</Badge>}
                      {a.status === "requested" && <Badge tone="neutral">Not approved yet</Badge>}
                      <Badge tone="neutral">{a.type ?? "Away"}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul></Card>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── setup ─────────────────────────
function Setup(props: SlotProps) {
  const { api, tenantId, errorMessage } = props;
  const qc = useQueryClient();
  const types = useQuery({ queryKey: key(tenantId, "types"), queryFn: () => api.get<{ data: LeaveType[] }>("/leave-types") });
  const year = Number(todayLocal().slice(0, 4));
  const [y, setY] = useState(year);
  const hols = useQuery({ queryKey: key(tenantId, "holidays", y), queryFn: () => api.get<{ data: Holiday[] }>(`/holidays?year=${y}`) });
  const inval = () => void qc.invalidateQueries({ queryKey: key(tenantId) });
  const patchType = useMutation({ mutationFn: ({ id, b }: { id: string; b: Partial<LeaveType> }) => api.patch(`/leave-types/${id}`, b), onSuccess: inval });
  const [nt, setNt] = useState({ name: "", usesAllowance: true, needsApproval: true });
  const addType = useMutation({ mutationFn: () => api.post("/leave-types", { ...nt, position: types.data?.data.length ?? 0 }), onSuccess: () => { setNt({ name: "", usesAllowance: true, needsApproval: true }); inval(); } });
  const [nh, setNh] = useState({ day: "", name: "" });
  const addHol = useMutation({ mutationFn: () => api.post("/holidays", nh), onSuccess: () => { setNh({ day: "", name: "" }); inval(); } });
  const delHol = useMutation({ mutationFn: (id: string) => api.del(`/holidays/${id}`), onSuccess: inval });
  const err = patchType.error ?? addType.error ?? addHol.error ?? delHol.error;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {err && <div className="lg:col-span-2"><Alert>{errorMessage(err)}</Alert></div>}
      <Card>
        <CardHeader><CardTitle>Leave types</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {types.isPending ? <Spinner /> : (
            <ul className="grid gap-2 text-sm" aria-label="Leave types">
              {types.data?.data.map((t) => (
                <li key={t.id} className={cn("grid gap-2 rounded-md border px-3 py-2", t.archived && "opacity-60")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{t.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => patchType.mutate({ id: t.id, b: { archived: !t.archived } })}>{t.archived ? "Restore" : "Archive"}</Button></div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2"><Switch checked={t.usesAllowance} onCheckedChange={(v) => patchType.mutate({ id: t.id, b: { usesAllowance: v } })} label={`${t.name}: uses allowance`} />Uses allowance</label>
                    <label className="flex items-center gap-2"><Switch checked={t.needsApproval} onCheckedChange={(v) => patchType.mutate({ id: t.id, b: { needsApproval: v } })} label={`${t.name}: needs approval`} />Needs approval</label>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); addType.mutate(); }}>
            <div className="min-w-40 flex-1"><Field label="New leave type">{(a) => <Input {...a} required maxLength={60} placeholder="e.g. Parental leave" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />}</Field></div>
            <Button type="submit" variant="outline" disabled={addType.isPending}>Add type</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Company holidays</CardTitle>
          <Select aria-label="Year" className="w-auto" value={y} onChange={(e) => setY(Number(e.target.value))}>{[year - 1, year, year + 1].map((x) => <option key={x}>{x}</option>)}</Select>
        </CardHeader>
        <CardContent className="grid gap-3">
          {hols.isPending ? <Spinner /> : hols.data?.data.length ? (
            <ul className="grid gap-1 text-sm" aria-label="Holidays">
              {hols.data.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                  <span><span className="tabular-nums text-muted">{fmtDay(h.day)}</span> · {h.name}</span>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => delHol.mutate(h.id)}>Remove</Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No holidays in {y}. Holidays are not counted as time off.</p>}
          <form className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); addHol.mutate(); }}>
            <Field label="Date">{(a) => <Input {...a} type="date" required value={nh.day} onChange={(e) => setNh({ ...nh, day: e.target.value })} />}</Field>
            <Field label="Holiday name">{(a) => <Input {...a} required maxLength={100} value={nh.name} onChange={(e) => setNh({ ...nh, name: e.target.value })} />}</Field>
            <Button type="submit" variant="outline" disabled={addHol.isPending}>Add holiday</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── one person ─────────────────────────
function EmployeePage(props: SlotProps & { id: string }) {
  const { api, tenantId, id, navigate, errorMessage } = props;
  const q = useQuery({ queryKey: key(tenantId, "employee", id), queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`) });
  const [dialog, setDialog] = useState<"edit" | "self" | "leave" | null>(null);
  const back = <a {...link(navigate, ROOT)} className="text-sm text-primary hover:underline">← People</a>;
  if (q.isPending) return <div className="grid gap-4">{back}<Spinner /></div>;
  if (q.isError) return <div className="grid gap-4">{back}<Alert>{errorMessage(q.error)}</Alert></div>;
  const e = q.data;
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children || "—"}</dd></>;
  return (
    <div className="grid gap-4">
      {back}
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={e.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
          <p className="text-sm text-muted">{[e.jobTitle, e.department].filter(Boolean).join(" · ") || "No title yet"}</p>
        </div>
        {e.status !== "active" && <Badge tone="neutral">{e.status === "left" ? `Left ${fmtDay(e.endDate!)}` : `Starts ${fmtDay(e.startDate)}`}</Badge>}
        <div className="flex gap-2">
          {e.isMe && !e.canManage && <Button variant="outline" onClick={() => setDialog("self")}>Edit my details</Button>}
          {e.canManage && <Button variant="outline" onClick={() => setDialog("edit")}>Edit</Button>}
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Work</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Work email">{e.workEmail && <a className="text-primary hover:underline" href={`mailto:${e.workEmail}`}>{e.workEmail}</a>}</Row>
              <Row label="Manager">{e.managerId && <a {...link(navigate, `${ROOT}/${e.managerId}`)} className="text-primary hover:underline">{e.managerName}</a>}</Row>
              <Row label="Employment">{EMPLOYMENT[e.employmentType]}</Row>
              <Row label="Started">{fmtDay(e.startDate)}</Row>
              {e.endDate && <Row label="Last day">{fmtDay(e.endDate)}</Row>}
              {e.reports.length > 0 && <Row label="Team">
                <ul className="grid gap-0.5">{e.reports.map((r) => <li key={r.id}><a {...link(navigate, `${ROOT}/${r.id}`)} className="text-primary hover:underline">{r.name}</a>{r.jobTitle && <span className="text-muted"> · {r.jobTitle}</span>}</li>)}</ul>
              </Row>}
            </dl>
          </CardContent>
        </Card>
        {e.private && (
          <Card>
            <CardHeader><CardTitle>Personal</CardTitle><span className="text-xs text-muted">Visible to HR and {e.isMe ? "you" : "this person"}</span></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Row label="Phone">{e.phone}</Row>
                <Row label="Address">{e.address && <span className="whitespace-pre-line">{e.address}</span>}</Row>
                <Row label="Emergency contact">{e.emergencyContact}</Row>
                <Row label="Birthday">{e.birthDate && fmtDay(e.birthDate)}</Row>
                {e.canManage && <Row label="Allowance">{e.annualAllowance != null ? `${e.annualAllowance} days a year` : "Company default"}</Row>}
                {e.canManage && e.notes != null && <Row label="HR notes"><span className="whitespace-pre-line">{e.notes}</span></Row>}
              </dl>
            </CardContent>
          </Card>
        )}
        {e.canSeeLeave && <EmployeeLeave {...props} e={e} onRequest={() => setDialog("leave")} />}
        {e.private && <Documents {...props} e={e} />}
      </div>
      {dialog === "edit" && <EmployeeDialog {...props} employee={e} onClose={() => setDialog(null)} />}
      {dialog === "self" && <SelfDialog {...props} employee={e} onClose={() => setDialog(null)} />}
      {dialog === "leave" && <RequestDialog {...props} employeeId={e.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function EmployeeLeave(props: SlotProps & { e: EmployeeDetail; onRequest(): void }) {
  const { api, tenantId, e, errorMessage, onRequest } = props;
  const q = useQuery({ queryKey: key(tenantId, "leave", "employee", e.id), queryFn: () => api.get<{ data: Leave[] }>(`/leave?scope=all&employeeId=${e.id}`) });
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Time off</CardTitle>{e.canManage && !e.isMe && <Button size="sm" variant="outline" onClick={onRequest}>Add time off</Button>}</CardHeader>
      <CardContent className="grid gap-4">
        {e.balance && <BalanceCards b={e.balance} />}
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : <LeaveList {...props} rows={q.data.data} showWho={false} emptyText="No time off yet." />}
      </CardContent>
    </Card>
  );
}

const KINDS = [["contract", "Contract"], ["identity", "ID / work permit"], ["certificate", "Certificate"], ["review", "Review"], ["other", "Other"]] as const;
function Documents({ api, tenantId, e, errorMessage }: SlotProps & { e: EmployeeDetail }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(tenantId, "docs", e.id), queryFn: () => api.get<{ data: Doc[] }>(`/employees/${e.id}/documents`) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("contract");
  const up = useMutation({
    mutationFn: (f: File) => api.upload<Doc>(`/employees/${e.id}/documents?kind=${kind}`, f, f.name),
    onSuccess: () => { if (fileRef.current) fileRef.current.value = ""; void qc.invalidateQueries({ queryKey: key(tenantId, "docs", e.id) }); },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/employees/${e.id}/documents/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: key(tenantId, "docs", e.id) }) });
  const open = useMutation({ mutationFn: async (d: Doc) => { const b = await api.blob(`/employees/${e.id}/documents/${d.id}`); window.open(URL.createObjectURL(b), "_blank", "noopener"); } });
  const err = up.error ?? del.error ?? open.error;
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Documents</CardTitle><span className="text-xs text-muted">Visible to HR and {e.isMe ? "you" : "this person"}</span></CardHeader>
      <CardContent className="grid gap-3">
        {err && <Alert>{errorMessage(err)}</Alert>}
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? <p className="text-sm text-muted">No documents.</p> : (
          <ul className="grid gap-1 text-sm" aria-label="Documents">
            {q.data.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => open.mutate(d)}>{d.title}</button>
                <Badge tone="neutral">{KINDS.find((k) => k[0] === d.kind)?.[1] ?? d.kind}</Badge>
                <span className="text-muted">{fmtDay(d.createdAt.slice(0, 10))}</span>
                {e.canManage && <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Delete ${d.title}`} onClick={() => del.mutate(d.id)}>Delete</Button>}
              </li>
            ))}
          </ul>
        )}
        {e.canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Kind">{(a) => <Select {...a} className="w-auto" value={kind} onChange={(ev) => setKind(ev.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
            <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,text/plain" className="sr-only" aria-label="Upload document"
              onChange={(ev) => { const f = ev.target.files?.[0]; if (f) up.mutate(f); }} />
            <Button variant="outline" disabled={up.isPending} onClick={() => fileRef.current?.click()}>{up.isPending ? "Uploading…" : "Upload document"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelfDialog({ api, tenantId, employee: e, errorMessage, onClose }: SlotProps & { employee: EmployeeDetail; onClose(): void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ phone: e.phone ?? "", address: e.address ?? "", emergencyContact: e.emergencyContact ?? "" });
  const save = useMutation({ mutationFn: () => api.patch("/me", f), onSuccess: () => { void qc.invalidateQueries({ queryKey: key(tenantId) }); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Your contact details" description="Only HR and you can see these.">
      <form className="grid gap-3" onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Phone">{(a) => <Input {...a} type="tel" maxLength={50} value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} />}</Field>
        <Field label="Address">{(a) => <Textarea {...a} rows={2} maxLength={500} value={f.address} onChange={(ev) => setF({ ...f, address: ev.target.value })} />}</Field>
        <Field label="Emergency contact" hint="Name and phone">{(a) => <Input {...a} maxLength={300} value={f.emergencyContact} onChange={(ev) => setF({ ...f, emergencyContact: ev.target.value })} />}</Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending}>Save</Button></div>
      </form>
    </Dialog>
  );
}

function EmployeeDialog({ api, tenantId, navigate, errorMessage, onClose, employee: e }: SlotProps & { onClose(): void; employee?: EmployeeDetail }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: key(tenantId, "employees", "all"), queryFn: () => api.get<{ data: Employee[] }>("/employees") });
  const members = useQuery({ queryKey: ["tenant", tenantId, "members"], queryFn: () => api.core<Member[] | { data: Member[] }>("/members") });
  const memberList = Array.isArray(members.data) ? members.data : members.data?.data ?? [];
  const [f, setF] = useState({
    firstName: e?.firstName ?? "", lastName: e?.lastName ?? "", workEmail: e?.workEmail ?? "", jobTitle: e?.jobTitle ?? "", department: e?.department ?? "",
    managerId: e?.managerId ?? "", userId: e?.userId ?? "", employmentType: e?.employmentType ?? "full_time", startDate: e?.startDate ?? todayLocal(),
    endDate: e?.endDate ?? "", annualAllowance: e?.annualAllowance != null ? String(e.annualAllowance) : "", birthDate: e?.birthDate ?? "",
    phone: e?.phone ?? "", address: e?.address ?? "", emergencyContact: e?.emergencyContact ?? "", notes: e?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  const save = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === "" ? null : v.trim());
      const body = {
        firstName: f.firstName.trim(), lastName: f.lastName.trim(), workEmail: n(f.workEmail), jobTitle: n(f.jobTitle), department: n(f.department),
        managerId: n(f.managerId), userId: n(f.userId), employmentType: f.employmentType, startDate: f.startDate, endDate: n(f.endDate),
        annualAllowance: f.annualAllowance.trim() === "" ? null : Number(f.annualAllowance), birthDate: n(f.birthDate),
        phone: n(f.phone), address: n(f.address), emergencyContact: n(f.emergencyContact), notes: n(f.notes),
      };
      return e ? api.patch<EmployeeDetail>(`/employees/${e.id}`, body) : api.post<EmployeeDetail>("/employees", body);
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: key(tenantId) }); onClose(); if (!e) navigate(`${ROOT}/${r.id}`); },
  });
  const linked = new Set((people.data?.data ?? []).filter((p) => p.userId && p.id !== e?.id).map((p) => p.userId));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={e ? `Edit ${e.name}` : "Add person"}>
      <form className="grid gap-3" onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">{(a) => <Input {...a} required maxLength={100} value={f.firstName} onChange={set("firstName")} />}</Field>
          <Field label="Last name">{(a) => <Input {...a} maxLength={100} value={f.lastName} onChange={set("lastName")} />}</Field>
          <Field label="Job title">{(a) => <Input {...a} maxLength={120} value={f.jobTitle} onChange={set("jobTitle")} />}</Field>
          <Field label="Team">{(a) => <Input {...a} maxLength={120} value={f.department} onChange={set("department")} />}</Field>
          <Field label="Work email" hint="Gets time-off emails">{(a) => <Input {...a} type="email" value={f.workEmail} onChange={set("workEmail")} />}</Field>
          <Field label="Sign-in account" hint="Lets them see their profile and request time off">{(a) => (
            <Select {...a} value={f.userId} onChange={set("userId")}>
              <option value="">Not linked</option>
              {memberList.filter((m) => !linked.has(m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.name ? `${m.name} (${m.email})` : m.email}</option>)}
            </Select>
          )}</Field>
          <Field label="Manager">{(a) => (
            <Select {...a} value={f.managerId} onChange={set("managerId")}>
              <option value="">No manager</option>
              {(people.data?.data ?? []).filter((p) => p.id !== e?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Employment">{(a) => <Select {...a} value={f.employmentType} onChange={set("employmentType")}>{Object.entries(EMPLOYMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Start date">{(a) => <Input {...a} type="date" required value={f.startDate} onChange={set("startDate")} />}</Field>
          <Field label="Last day (if leaving)">{(a) => <Input {...a} type="date" min={f.startDate} value={f.endDate} onChange={set("endDate")} />}</Field>
          <Field label="Time off per year (days)" hint="Empty = company default">{(a) => <Input {...a} type="number" min={0} max={365} step={0.5} value={f.annualAllowance} onChange={set("annualAllowance")} />}</Field>
          <Field label="Birthday">{(a) => <Input {...a} type="date" value={f.birthDate} onChange={set("birthDate")} />}</Field>
          <Field label="Phone">{(a) => <Input {...a} type="tel" maxLength={50} value={f.phone} onChange={set("phone")} />}</Field>
          <Field label="Emergency contact">{(a) => <Input {...a} maxLength={300} value={f.emergencyContact} onChange={set("emergencyContact")} />}</Field>
        </div>
        <Field label="Address">{(a) => <Textarea {...a} rows={2} maxLength={500} value={f.address} onChange={set("address")} />}</Field>
        <Field label="HR notes" hint="Only HR sees these">{(a) => <Textarea {...a} rows={2} maxLength={5000} value={f.notes} onChange={set("notes")} />}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : e ? "Save" : "Add person"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

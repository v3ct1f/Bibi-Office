import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, DatePicker, Field, Input, Select, Skeleton, Table, TBody, TD, TH, THead, TR, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  Avatar, BASIS, CL_KIND, DOC_CAT, EMPLOYMENT, LEAVE, ModLink, downloadBase64, errorMessage, fmtDate, fmtDayMonth, fmtDays, fmtMoney, fmtSize, parseMoney,
  readBase64, today, useLoad,
  type Basis, type Checklist, type Config, type DocCategory, type DocumentInfo, type Employment, type LeaveEntry, type LeaveKind, type LeaveSummary,
  type PayEntry, type Person, type Profile, type Template,
} from "./shared.tsx";

type Tab = "profile" | "leave" | "documents" | "checklists" | "pay";

export function ProfilePage({ params }: PageProps) {
  const host = useModuleHost();
  const userId = params.userId!;
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const p = useLoad(() => host.api.get<Profile>(`/people/${userId}`), [host, userId]);
  const initial = (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null) as Tab | null;
  const [tab, setTab] = useState<Tab>(initial ?? "profile");
  const [editing, setEditing] = useState(false);

  const back = <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/people")}><ArrowLeft /> People</Button>;
  if (p.error) return <>{back}<Card><ErrorState title="Can't open this profile" error={p.error} onRetry={() => void p.reload()} /></Card></>;
  if (!p.data || !cfg.data) return <>{back}<Skeleton className="h-96" /></>;
  const d = p.data, c = cfg.data;
  const self = c.me === userId;
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "profile", label: "Profile", show: true },
    { key: "leave", label: "Leave", show: d.can.seePrivate },
    { key: "documents", label: "Documents", show: d.can.seePrivate },
    { key: "checklists", label: "Checklists", show: d.can.seePrivate },
    { key: "pay", label: "Pay", show: d.can.seePay },
  ];
  const current = tabs.find((t) => t.key === tab && t.show) ? tab : "profile";

  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={d.name} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{d.name}{self && <span className="ml-2 text-sm font-normal text-muted-foreground">(you)</span>}</h1>
            <p className="text-muted-foreground">{[d.jobTitle, d.department].filter(Boolean).join(" · ") || "No job title yet"}</p>
            {!d.active && <Badge variant="neutral" className="mt-1">Left on {fmtDate(d.endDate)}</Badge>}
          </div>
        </div>
        {(d.can.edit || d.can.editOwn) && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {d.can.edit ? "Edit profile" : "Edit my details"}</Button>}
      </div>
      <div role="tablist" aria-label="Profile sections" className="mb-4 flex gap-1.5 overflow-x-auto">
        {tabs.filter((t) => t.show).map((t) => (
          <Button key={t.key} role="tab" aria-selected={current === t.key} size="sm" variant={current === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>{t.label}</Button>
        ))}
      </div>
      {current === "profile" && <ProfileTab d={d} />}
      {current === "leave" && <LeaveTab userId={userId} canManage={c.canManage} />}
      {current === "documents" && <DocumentsTab userId={userId} canManage={c.canManage} />}
      {current === "checklists" && <ChecklistsTab userId={userId} cfg={c} />}
      {current === "pay" && <PayTab userId={userId} canEdit={d.can.editPay} currency={c.currency} />}
      {editing && <EditProfile d={d} full={d.can.edit} cfg={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void p.reload(); void cfg.reload(); }} />}
    </>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-0.5 sm:grid-cols-[12rem_1fr]"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-sm">{children || "—"}</dd></div>
);

function ProfileTab({ d }: { d: Profile }) {
  const pv = d.private;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Work</h2>
        <dl className="grid gap-2">
          <Row label="Email">{d.email}</Row>
          <Row label="Work phone">{d.workPhone}</Row>
          <Row label="Reports to">{d.managerId && d.managerName ? <ModLink to={`/people/${d.managerId}`}>{d.managerName}</ModLink> : null}</Row>
          <Row label="Team">{d.directReports.length ? d.directReports.map((r, i) => <span key={r.userId}>{i > 0 && ", "}<ModLink to={`/people/${r.userId}`}>{r.name}</ModLink></span>) : null}</Row>
          <Row label="Employment">{d.employmentType ? EMPLOYMENT[d.employmentType] : null}{pv?.weeklyHours ? `, ${pv.weeklyHours} h/week` : ""}</Row>
          <Row label="Started">{d.startDate ? fmtDate(d.startDate) : null}</Row>
          {d.endDate && <Row label="Last day">{fmtDate(d.endDate)}</Row>}
          <Row label="Birthday">{d.birthday ? fmtDayMonth(d.birthday) : null}</Row>
        </dl>
      </Card>
      {pv && (
        <Card className="p-5" role="group" aria-label="Private details">
          <h2 className="mb-1 font-semibold">Private details</h2>
          <p className="mb-3 text-xs text-muted-foreground">Only HR and {d.name.split(" ")[0]} can see these.</p>
          <dl className="grid gap-2">
            <Row label="Date of birth">{pv.birthDate ? fmtDate(pv.birthDate) : null}</Row>
            <Row label="Personal email">{pv.personalEmail}</Row>
            <Row label="Personal phone">{pv.personalPhone}</Row>
            <Row label="Address"><span className="whitespace-pre-line">{pv.address}</span></Row>
            <Row label="Emergency contact">{pv.emergencyName ? `${pv.emergencyName}${pv.emergencyRelation ? ` (${pv.emergencyRelation})` : ""}${pv.emergencyPhone ? ` · ${pv.emergencyPhone}` : ""}` : null}</Row>
            <Row label="Vacation days / year">{fmtDays(pv.effectiveAllowance)}{pv.allowanceDays === null ? " (company default)" : ""}</Row>
            {pv.notes !== null && <Row label="HR notes"><span className="whitespace-pre-line">{pv.notes}</span></Row>}
          </dl>
        </Card>
      )}
    </div>
  );
}

function EditProfile({ d, full, cfg, onClose, onSaved }: { d: Profile; full: boolean; cfg: Config; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const people = useLoad(() => (full ? host.api.get<Person[]>("/people") : Promise.resolve([] as Person[])), [host, full]);
  const pv = d.private!;
  const [f, setF] = useState({
    jobTitle: d.jobTitle ?? "", department: d.department ?? "", managerId: d.managerId ?? "", employmentType: d.employmentType ?? "",
    weeklyHours: pv.weeklyHours?.toString() ?? "", startDate: d.startDate ?? "", endDate: d.endDate ?? "", workPhone: d.workPhone ?? "",
    birthDate: pv.birthDate ?? "", personalEmail: pv.personalEmail ?? "", personalPhone: pv.personalPhone ?? "", address: pv.address ?? "",
    emergencyName: pv.emergencyName ?? "", emergencyRelation: pv.emergencyRelation ?? "", emergencyPhone: pv.emergencyPhone ?? "",
    notes: pv.notes ?? "", allowanceDays: pv.allowanceDays?.toString() ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const txt = (v: string) => v.trim() || null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.personalEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.personalEmail.trim())) errs.personalEmail = "Use a valid email address";
    const num = (k: "weeklyHours" | "allowanceDays", max: number) => {
      if (!f[k].trim()) return null;
      const n = Number(f[k].replace(",", "."));
      if (!(n >= 0 && n <= max) || (k === "allowanceDays" && n * 2 !== Math.round(n * 2))) { errs[k] = k === "allowanceDays" ? "Whole or half days, 0 to 366" : "0 to 168 hours"; return null; }
      return n;
    };
    const own = { personalEmail: txt(f.personalEmail), personalPhone: txt(f.personalPhone), address: txt(f.address), emergencyName: txt(f.emergencyName), emergencyRelation: txt(f.emergencyRelation), emergencyPhone: txt(f.emergencyPhone) };
    const body = full ? {
      ...own, jobTitle: txt(f.jobTitle), department: txt(f.department), managerId: f.managerId || null, employmentType: (f.employmentType || null) as Employment | null,
      weeklyHours: num("weeklyHours", 168), startDate: f.startDate || null, endDate: f.endDate || null, workPhone: txt(f.workPhone), birthDate: f.birthDate || null,
      notes: txt(f.notes), allowanceDays: num("allowanceDays", 366),
    } : own;
    if (full && f.startDate && f.endDate && f.endDate < f.startDate) errs.endDate = "The last day can't be before the start date";
    setErrors(errs); setError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try { await host.api.patch(`/people/${d.userId}`, body); toast.success("Profile saved"); onSaved(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={full ? `Edit ${d.name}` : "Edit my details"} wide>
        <form className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1" onSubmit={(e) => void save(e)} noValidate>
          {full && (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-semibold">Work</legend>
              <Field label="Job title">{(a) => <Input {...a} maxLength={120} value={f.jobTitle} onChange={set("jobTitle")} />}</Field>
              <Field label="Department">{(a) => <><Input {...a} list="hr-departments" maxLength={80} value={f.department} onChange={set("department")} /><datalist id="hr-departments">{cfg.departments.map((x) => <option key={x} value={x} />)}</datalist></>}</Field>
              <Field label="Reports to">{(a) => (
                <Select {...a} value={f.managerId} onChange={set("managerId")}>
                  <option value="">Nobody</option>
                  {people.data?.filter((x) => x.userId !== d.userId).map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}
                </Select>
              )}</Field>
              <Field label="Employment">{(a) => (
                <Select {...a} value={f.employmentType} onChange={set("employmentType")}>
                  <option value="">—</option>
                  {(Object.keys(EMPLOYMENT) as Employment[]).map((k) => <option key={k} value={k}>{EMPLOYMENT[k]}</option>)}
                </Select>
              )}</Field>
              <Field label="Hours per week" error={errors.weeklyHours}>{(a) => <Input {...a} inputMode="decimal" value={f.weeklyHours} onChange={set("weeklyHours")} />}</Field>
              <Field label="Work phone">{(a) => <Input {...a} maxLength={40} value={f.workPhone} onChange={set("workPhone")} />}</Field>
              <Field label="Start date">{(a) => <DatePicker {...a} value={f.startDate} onChange={(iso) => setF({ ...f, startDate: iso })} />}</Field>
              <Field label="Last day" hint="Only when someone leaves" error={errors.endDate}>{(a) => <DatePicker {...a} value={f.endDate} onChange={(iso) => setF({ ...f, endDate: iso })} />}</Field>
              <Field label="Date of birth">{(a) => <DatePicker {...a} value={f.birthDate} onChange={(iso) => setF({ ...f, birthDate: iso })} />}</Field>
              <Field label="Vacation days per year" hint={`Empty = company default (${cfg.defaultAllowanceDays})`} error={errors.allowanceDays}>{(a) => <Input {...a} inputMode="decimal" value={f.allowanceDays} onChange={set("allowanceDays")} />}</Field>
            </fieldset>
          )}
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold">Contact details</legend>
            <Field label="Personal email" error={errors.personalEmail}>{(a) => <Input {...a} type="email" value={f.personalEmail} onChange={set("personalEmail")} />}</Field>
            <Field label="Personal phone">{(a) => <Input {...a} maxLength={40} value={f.personalPhone} onChange={set("personalPhone")} />}</Field>
            <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} maxLength={500} value={f.address} onChange={set("address")} />}</Field>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-1 text-sm font-semibold">Emergency contact</legend>
            <Field label="Name">{(a) => <Input {...a} maxLength={200} value={f.emergencyName} onChange={set("emergencyName")} />}</Field>
            <Field label="Relation">{(a) => <Input {...a} maxLength={80} placeholder="e.g. Partner" value={f.emergencyRelation} onChange={set("emergencyRelation")} />}</Field>
            <Field label="Phone">{(a) => <Input {...a} maxLength={40} value={f.emergencyPhone} onChange={set("emergencyPhone")} />}</Field>
          </fieldset>
          {full && <Field label="HR notes" hint="Only HR managers see these">{(a) => <Textarea {...a} rows={3} maxLength={5000} value={f.notes} onChange={set("notes")} />}</Field>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Leave ────────────────────────────────────────────────────────────────────
function LeaveTab({ userId, canManage }: { userId: string; canManage: boolean }) {
  const host = useModuleHost();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const l = useLoad(() => host.api.get<LeaveSummary & { year: number; entries: LeaveEntry[] }>(`/people/${userId}/leave`, { year }), [host, userId, year]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<LeaveEntry | null>(null);
  const d = l.data;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</Button>
          <span className="min-w-14 text-center font-medium tabular-nums">{year}</span>
          <Button size="sm" variant="outline" aria-label="Next year" onClick={() => setYear(year + 1)}>›</Button>
        </div>
        {canManage && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add leave or adjustment</Button>}
      </div>
      {l.error ? <Card><ErrorState error={l.error} onRetry={() => void l.reload()} /></Card> : !d ? <Skeleton className="h-40" /> : (
        <>
          <div role="group" aria-label="Vacation balance" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Allowance", d.total, d.adjustments ? `${d.allowance} ${d.adjustments > 0 ? "+" : "−"} ${Math.abs(d.adjustments)}` : null], ["Taken", d.vacationTaken, null], ["Booked", d.vacationBooked, null], ["Left", d.remaining, null]] as const).map(([label, n, sub]) => (
              <Card key={label} className="p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className={`text-2xl font-semibold tabular-nums ${label === "Left" && n < 0 ? "text-destructive" : ""}`}>{n}</p>
                {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Sick days this year: {d.sick}{d.other ? ` · other leave: ${d.other}` : ""}. Approved time off in Schedule is added here automatically.</p>
          <Card className="overflow-x-auto">
            {!d.entries.length ? <p className="p-4 text-sm text-muted-foreground">Nothing recorded for {year}.</p> : (
              <Table aria-label="Leave entries">
                <THead><TR><TH>What</TH><TH>When</TH><TH className="text-right">Days</TH><TH>From</TH>{canManage && <TH />}</TR></THead>
                <TBody>
                  {d.entries.map((e) => (
                    <TR key={e.id}>
                      <TD>{LEAVE[e.kind]}{e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}</TD>
                      <TD className="whitespace-nowrap">{e.startDate ? (e.endDate && e.endDate !== e.startDate ? `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}` : fmtDate(e.startDate)) : "—"}</TD>
                      <TD className="text-right tabular-nums">{e.kind === "adjustment" || e.kind === "carry_over" ? (e.days > 0 ? `+${e.days}` : e.days) : e.days}</TD>
                      <TD className="text-muted-foreground">{e.source === "schedule" ? "Schedule" : `Added by ${e.createdByName ?? "HR"}`}</TD>
                      {canManage && <TD className="text-right">{e.source === "manual" && <Button size="sm" variant="ghost" aria-label="Delete entry" onClick={() => setDeleting(e)}><Trash2 /></Button>}</TD>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
      {adding && <AddLeave userId={userId} year={year} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void l.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title="Delete this entry?"
        onConfirm={async () => { await host.api.del(`/leave/${deleting!.id}`); toast.success("Entry deleted"); setDeleting(null); await l.reload(); }} />
    </div>
  );
}

function AddLeave({ userId, year, onClose, onSaved }: { userId: string; year: number; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [kind, setKind] = useState<LeaveKind>("carry_over");
  const [days, setDays] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowance = kind === "adjustment" || kind === "carry_over";
  async function save(e: FormEvent) {
    e.preventDefault();
    const n = Number(days.replace(",", "."));
    if (!days.trim() || !n || n * 2 !== Math.round(n * 2)) { setError("Enter whole or half days"); return; }
    if (!allowance && n < 0) { setError("Days away must be positive"); return; }
    setBusy(true); setError(null);
    try {
      await host.api.post(`/people/${userId}/leave`, { kind, days: n, year: start ? undefined : year, startDate: start || null, endDate: end || null, note: note.trim() || null });
      toast.success("Saved"); onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Add leave or adjustment" description="For leave not booked in Schedule, carried-over days, or corrections.">
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <Field label="What">{(a) => <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>{(Object.keys(LEAVE) as LeaveKind[]).map((k) => <option key={k} value={k}>{LEAVE[k]}</option>)}</Select>}</Field>
          <Field label="Days" required hint={allowance ? "Added to the allowance; use a minus to take days off it" : "Working days away"} error={error ?? undefined}>{(a) => <Input {...a} inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
          {!allowance && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First day">{(a) => <DatePicker {...a} value={start} onChange={(iso) => setStart(iso)} />}</Field>
              <Field label="Last day">{(a) => <DatePicker {...a} value={end} onChange={(iso) => setEnd(iso)} />}</Field>
            </div>
          )}
          <Field label="Note">{(a) => <Input {...a} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx";
function DocumentsTab({ userId, canManage }: { userId: string; canManage: boolean }) {
  const host = useModuleHost();
  const docs = useLoad(() => host.api.get<DocumentInfo[]>(`/people/${userId}/documents`), [host, userId]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<DocumentInfo | null>(null);
  async function open(d: DocumentInfo) {
    if (d.source === "docs" && d.refId) { window.location.assign(`/t/${host.tenant.slug}/m/docs/docs/${d.refId}`); return; }
    try { const f = await host.api.get<{ name: string; contentType: string; data: string }>(`/documents/${d.id}`); downloadBase64(f.name, f.contentType, f.data); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div className="grid gap-3">
      {canManage && <div><Button size="sm" onClick={() => setUploading(true)}><Upload /> Upload document</Button></div>}
      <Card className="overflow-x-auto">
        {docs.error ? <ErrorState error={docs.error} onRetry={() => void docs.reload()} /> : !docs.data ? <Skeleton className="h-24" /> : !docs.data.length ? <p className="p-4 text-sm text-muted-foreground">No documents yet.</p> : (
          <Table aria-label="Documents">
            <THead><TR><TH>Document</TH><TH>Type</TH><TH>Expires</TH><TH>Added</TH><TH /></TR></THead>
            <TBody>
              {docs.data.map((d) => (
                <TR key={d.id}>
                  <TD><button type="button" className="text-left font-medium hover:underline" onClick={() => void open(d)}>{d.name}</button><span className="block text-xs text-muted-foreground">{d.source === "docs" ? "Signed in Docs" : fmtSize(d.sizeBytes)}</span></TD>
                  <TD>{DOC_CAT[d.category]}</TD>
                  <TD className="whitespace-nowrap">{d.expiresOn ? fmtDate(d.expiresOn) : "—"}{d.expired ? <Badge variant="destructive" className="ml-2">Expired</Badge> : d.expiringSoon ? <Badge variant="warning" className="ml-2">Expires soon</Badge> : null}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(d.createdAt)}{d.uploadedByName ? ` · ${d.uploadedByName}` : ""}</TD>
                  <TD className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" aria-label={d.source === "docs" ? `Open ${d.name} in Docs` : `Download ${d.name}`} onClick={() => void open(d)}><Download /></Button>
                    {canManage && <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d)}><Trash2 /></Button>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {uploading && <UploadDoc userId={userId} onClose={() => setUploading(false)} onSaved={() => { setUploading(false); void docs.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`} description="The file is removed for good."
        onConfirm={async () => { await host.api.del(`/documents/${deleting!.id}`); toast.success("Document deleted"); setDeleting(null); await docs.reload(); }} />
    </div>
  );
}
function UploadDoc({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DocCategory>("contract");
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!file) { setError("Choose a file"); return; }
    if (file.size > 7 * 1024 * 1024) { setError("Files can be at most 7 MB"); return; }
    const type = file.type || (file.name.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "");
    setBusy(true); setError(null);
    try {
      await host.api.post(`/people/${userId}/documents`, { name: name.trim() || file.name, category, contentType: type, data: await readBase64(file), expiresOn: expiresOn || null });
      toast.success("Document uploaded"); onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Upload document" description="PDF, photo (JPG, PNG, WEBP) or Word file, up to 7 MB.">
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <Field label="File" required>{(a) => <Input {...a} ref={input} type="file" accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, "")); }} />}</Field>
          <Field label="Name">{(a) => <Input {...a} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">{(a) => <Select {...a} value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>{(Object.keys(DOC_CAT) as DocCategory[]).map((k) => <option key={k} value={k}>{DOC_CAT[k]}</option>)}</Select>}</Field>
            <Field label="Expires on" hint="We'll remind you before then">{(a) => <DatePicker {...a} value={expiresOn} onChange={(iso) => setExpiresOn(iso)} />}</Field>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Upload</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Checklists ───────────────────────────────────────────────────────────────
function ChecklistsTab({ userId, cfg }: { userId: string; cfg: Config }) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Checklist[]>("/checklists", { status: "all", userId }), [host, userId]);
  const tpls = useLoad(() => (cfg.canManage ? host.api.get<Template[]>("/templates") : Promise.resolve([] as Template[])), [host, cfg.canManage]);
  const [templateId, setTemplateId] = useState("");
  const [start, setStart] = useState(today());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Checklist | null>(null);

  async function assign() {
    if (!templateId) { toast.error("Choose a checklist template"); return; }
    setBusy(true);
    try { await host.api.post(`/people/${userId}/checklists`, { templateId, startDate: start }); toast.success("Checklist assigned"); setTemplateId(""); await list.reload(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function toggle(taskId: string, done: boolean) {
    try { await host.api.patch(`/tasks/${taskId}`, { done }); await list.reload(); return true; }
    catch (e) { toast.error(errorMessage(e)); return false; }
  }

  return (
    <div className="grid gap-4">
      {cfg.canManage && (
        <Card className="flex flex-wrap items-end gap-3 p-4" role="group" aria-label="Assign a checklist">
          <Field label="Checklist" className="min-w-56 flex-1">{(a) => (
            <Select {...a} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose…</option>
              {tpls.data?.map((t) => <option key={t.id} value={t.id}>{t.name} ({CL_KIND[t.kind]})</option>)}
            </Select>
          )}</Field>
          <Field label="Start day">{(a) => <DatePicker {...a} value={start} onChange={(iso) => setStart(iso)} />}</Field>
          <Button loading={busy} onClick={() => void assign()}>Assign</Button>
          {tpls.data && !tpls.data.length && <p className="w-full text-sm text-muted-foreground">Create a template first under <ModLink to="/people/checklists">Checklists</ModLink>.</p>}
        </Card>
      )}
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card> : !list.data ? <Skeleton className="h-32" />
        : !list.data.length ? <Card><p className="p-4 text-sm text-muted-foreground">No checklists.</p></Card>
        : list.data.map((c) => (
          <Card key={c.id} className="p-4" role="group" aria-label={c.name}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{c.name} <Badge variant="outline">{CL_KIND[c.kind]}</Badge> {c.completedAt && <Badge variant="success">Done</Badge>}</p>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {c.done} / {c.total} · starts {fmtDate(c.startDate)}
                {cfg.canManage && <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 /></Button>}
              </span>
            </div>
            <ul className="grid gap-1">
              {c.tasks.map((t) => {
                const mine = t.ownerId === cfg.me;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <TaskCheckbox key={`${t.id}-${!!t.doneAt}`} label={t.title} done={!!t.doneAt} disabled={!mine && !cfg.canManage} onChange={(v) => toggle(t.id, v)} />
                    <span className={t.doneAt ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                    <span className="text-xs text-muted-foreground">· {mine ? "you" : t.ownerName ?? "nobody"}{t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}</span>
                    {t.overdue && <Badge variant="destructive">Overdue</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`}
        onConfirm={async () => { await host.api.del(`/checklists/${deleting!.id}`); toast.success("Checklist deleted"); setDeleting(null); await list.reload(); }} />
    </div>
  );
}

/** Ticks at once and goes back if saving fails. */
function TaskCheckbox({ label, done, disabled, onChange }: { label: string; done: boolean; disabled: boolean; onChange: (v: boolean) => Promise<boolean> }) {
  const [v, setV] = useState(done);
  return (
    <input type="checkbox" aria-label={label} checked={v} disabled={disabled}
      onChange={async (e) => { const next = e.target.checked; setV(next); if (!(await onChange(next))) setV(!next); }} />
  );
}

// ── Pay ──────────────────────────────────────────────────────────────────────
function PayTab({ userId, canEdit, currency }: { userId: string; canEdit: boolean; currency: string }) {
  const host = useModuleHost();
  const p = useLoad(() => host.api.get<{ current: PayEntry | null; history: PayEntry[] }>(`/people/${userId}/pay`), [host, userId]);
  const [from, setFrom] = useState(today());
  const [basis, setBasis] = useState<Basis>("hourly");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<PayEntry | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (!cents) { setError("Enter an amount above 0, e.g. 14.50"); return; }
    setBusy(true); setError(null);
    try { await host.api.post(`/people/${userId}/pay`, { effectiveFrom: from, basis, amountCents: cents, note: note.trim() || null }); toast.success("Pay change saved"); setAmount(""); setNote(""); await p.reload(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4">
      <Card className="p-5" role="group" aria-label="Current pay">
        <p className="text-sm text-muted-foreground">Current pay</p>
        {!p.data ? <Skeleton className="h-8 w-40" /> : p.data.current
          ? <p className="text-2xl font-semibold">{fmtMoney(p.data.current.amountCents, p.data.current.currency)} <span className="text-base font-normal text-muted-foreground">{BASIS[p.data.current.basis]}</span></p>
          : <p className="text-muted-foreground">Not recorded yet.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Visible only to owners, admins, people with the HR pay permission, and this person.</p>
      </Card>
      {canEdit && (
        <form onSubmit={(e) => void add(e)} noValidate>
          <Card className="grid gap-3 p-4 sm:grid-cols-[10rem_10rem_9rem_1fr_auto] sm:items-end" role="group" aria-label="Add pay change">
            <Field label="From">{(a) => <DatePicker {...a} value={from} onChange={(iso) => setFrom(iso)} />}</Field>
            <Field label={`Amount (${currency})`} error={error ?? undefined}>{(a) => <Input {...a} inputMode="decimal" placeholder="14.50" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
            <Field label="Per">{(a) => <Select {...a} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>{(Object.keys(BASIS) as Basis[]).map((b) => <option key={b} value={b}>{BASIS[b].replace("per ", "")}</option>)}</Select>}</Field>
            <Field label="Note">{(a) => <Input {...a} maxLength={500} placeholder="e.g. Yearly raise" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button type="submit" loading={busy}>Add</Button>
          </Card>
        </form>
      )}
      <Card className="overflow-x-auto">
        {!p.data ? <Skeleton className="h-24" /> : !p.data.history.length ? <p className="p-4 text-sm text-muted-foreground">No pay history.</p> : (
          <Table aria-label="Pay history">
            <THead><TR><TH>From</TH><TH className="text-right">Amount</TH><TH>Note</TH><TH>Added by</TH>{canEdit && <TH />}</TR></THead>
            <TBody>
              {p.data.history.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{fmtDate(r.effectiveFrom)}{r.effectiveFrom > today() && <Badge variant="outline" className="ml-2">Upcoming</Badge>}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{fmtMoney(r.amountCents, r.currency)} {BASIS[r.basis]}</TD>
                  <TD className="text-muted-foreground">{r.note}</TD>
                  <TD className="text-muted-foreground">{r.createdByName}</TD>
                  {canEdit && <TD className="text-right"><Button size="sm" variant="ghost" aria-label="Delete pay change" onClick={() => setDeleting(r)}><Trash2 /></Button></TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title="Delete this pay change?"
        onConfirm={async () => { await host.api.del(`/pay/${deleting!.id}`); toast.success("Pay change deleted"); setDeleting(null); await p.reload(); }} />
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  ArrowLeft, Ban, Building2, CalendarClock, Check, FileText, Mail, MessageSquare, Pencil, Phone, RotateCcw, Trash2, User, UserCheck, Users,
} from "lucide-react";
import {
  Button, Card, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Tabs, TabsList, TabsTrigger, Textarea, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  errorMessage, fmtDate, fmtDateTime, fmtMoney, isOpen, parseMoney, sourceLabel, STATUS, StatusBadge, STEPS, today, useLoad,
  type Activity, type LeadDetail as Lead, type Status,
} from "./shared.tsx";

const KINDS = [
  { value: "call", label: "Call", icon: Phone }, { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Users }, { value: "note", label: "Note", icon: MessageSquare },
] as const;
const ICONS: Record<Activity["kind"], typeof Phone> = { note: MessageSquare, call: Phone, meeting: Users, email: Mail, status: Check, system: FileText };
const PLACEHOLDER: Record<string, string> = {
  call: "What did you talk about? What's next?", email: "What did you send or receive?",
  meeting: "Who was there, and what did you agree?", note: "Anything worth remembering about this lead…",
};
const REASONS = ["Not interested", "No budget", "Not a good fit", "Couldn't reach them", "Spam or duplicate"];

function StatusBar({ lead, canWrite, onSet }: { lead: Lead; canWrite: boolean; onSet: (s: Status) => void }) {
  const idx = STEPS.indexOf(lead.status);
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Status">
      {STEPS.map((s, i) => {
        const current = s === lead.status, done = lead.status === "converted" || (idx >= 0 && i < idx);
        const clickable = canWrite && !current && isOpen(lead.status);
        return (
          <li key={s} className="min-w-24 flex-1">
            <button type="button" disabled={!clickable} onClick={() => onSet(s)} aria-current={current ? "step" : undefined}
              title={clickable ? `Mark as ${STATUS[s].label.toLowerCase()}` : undefined}
              className={cn("w-full rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                current ? "bg-primary text-primary-foreground" : done ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground",
                clickable && "cursor-pointer hover:bg-primary/40")}>
              {STATUS[s].label}
            </button>
          </li>
        );
      })}
      <li className="min-w-24 flex-1">
        <span className={cn("block rounded-sm px-2 py-1.5 text-center text-xs font-medium",
          lead.status === "converted" ? "bg-success text-white" : lead.status === "disqualified" ? "bg-muted-foreground/30" : "bg-muted text-muted-foreground")}>
          {lead.status === "converted" ? "Customer" : lead.status === "disqualified" ? "Disqualified" : "Customer / disqualified"}
        </span>
      </li>
    </ol>
  );
}

function Composer({ leadId, onAdded }: { leadId: string; onAdded: () => void }) {
  const host = useModuleHost();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("call");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="grid gap-2" onSubmit={async (e) => {
      e.preventDefault();
      if (!body.trim()) return;
      setBusy(true);
      try { await host.api.post(`/leads/${leadId}/activities`, { kind, body: body.trim() }); setBody(""); toast.success("Added to the timeline"); onAdded(); }
      catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
    }}>
      <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
        <TabsList>{KINDS.map((k) => <TabsTrigger key={k.value} value={k.value}><k.icon className="size-4" /> {k.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      <Textarea aria-label="Activity" rows={3} maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={PLACEHOLDER[kind]} />
      <Button type="submit" className="justify-self-end" size="sm" loading={busy} disabled={!body.trim()}>Add {KINDS.find((k) => k.value === kind)!.label.toLowerCase()}</Button>
    </form>
  );
}

function DisqualifyDialog({ open, onOpenChange, name, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; onConfirm: (reason: string | null) => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPick(""); setOther(""); } }, [open]);
  const reason = pick === "other" ? other.trim() : pick;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Disqualify ${name}?`} description="They leave your list of leads to work on. You can reopen them later.">
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
            <Button type="submit" loading={busy}>Disqualify</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ open, onOpenChange, lead, crmOn, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; crmOn: boolean; onDone: (l: Lead) => void;
}) {
  const host = useModuleHost();
  const [company, setCompany] = useState(true);
  const [deal, setDeal] = useState(true);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCompany(!!lead.companyName); setDeal(crmOn);
    setTitle(lead.companyName ? `${lead.companyName} deal` : `Deal with ${lead.name}`);
    setValue(lead.valueCents ? (lead.valueCents / 100).toFixed(2) : "");
  }, [open, lead, crmOn]);
  const cents = parseMoney(value);
  const hasPerson = !!(lead.firstName || lead.lastName || lead.email || lead.phone);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Convert ${lead.name} into a customer`}
        description={hasPerson ? "They're added to your contacts (or linked to the contact with the same email). The lead stays here for the record."
          : "The lead stays here for the record."}>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (deal && crmOn && (!title.trim() || cents === null)) return toast.error("Give the deal a name and a valid value");
          setBusy(true);
          try {
            const r = await host.api.post<Lead & { contactReused: boolean; companyReused: boolean }>(`/leads/${lead.id}/convert`, {
              company, deal: deal && crmOn ? { title: title.trim(), valueCents: cents ?? 0, currency: lead.currency } : null,
            });
            toast.success(deal && crmOn ? "Converted. The deal will appear in Deals in a moment." : "Converted into a customer");
            onDone(r); onOpenChange(false);
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}>
          {lead.companyName && (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={company} onCheckedChange={(v) => setCompany(v === true)} aria-label="Create company" />
              <span>Add <strong>{lead.companyName}</strong> to companies<span className="block text-muted-foreground">Uses the existing company if one has this name.</span></span>
            </label>
          )}
          {crmOn ? (
            <>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={deal} onCheckedChange={(v) => setDeal(v === true)} aria-label="Create deal" />
                <span>Open a deal in CRM<span className="block text-muted-foreground">So you can track the sale on the Deals board.</span></span>
              </label>
              {deal && (
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <Field label="Deal name">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />}</Field>
                  <Field label={`Value (${lead.currency})`} error={cents === null ? "Enter an amount" : undefined}>
                    {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} />}
                  </Field>
                </div>
              )}
            </>
          ) : <p className="text-sm text-muted-foreground">Turn on CRM in Add features to open a deal when you convert a lead.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}><UserCheck /> Convert</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadDetail({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const canWrite = host.can("leads:lead.write");
  const lead = useLoad(() => host.api.get<Lead>(`/leads/${id}`), [host, id]);
  const crmOn = useLoad(async () => {
    if (!host.can("core:modules.read")) return false;
    const mods = await host.core.get<{ key: string; enabled: boolean }[]>("/modules");
    return mods.some((m) => m.key === "crm" && m.enabled);
  }, [host]);
  const [dialog, setDialog] = useState<"convert" | "disqualify" | "delete" | null>(null);

  if (lead.loading && !lead.data) return <><Skeleton className="h-8 w-72" /><Skeleton className="mt-6 h-96" /></>;
  if (lead.error || !lead.data) return <ErrorState error={lead.error} onRetry={() => void lead.reload()} />;
  const l = lead.data;
  const open = isOpen(l.status);
  const due = open && l.followUpOn && l.followUpOn <= today();

  const setStatus = async (status: Status, reason?: string | null) => {
    try {
      const r = await host.api.post<Lead>(`/leads/${l.id}/status`, { status, reason: reason ?? null });
      lead.set(r);
      toast.success(status === "disqualified" ? "Lead disqualified" : `Marked as ${STATUS[status].label.toLowerCase()}`);
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  };
  const core = (kind: "contacts" | "companies", cid: string) => `/t/${host.tenant.slug}/${kind}/${cid}`;

  return (
    <>
      <a href={host.href("/leads")} onClick={(e) => { e.preventDefault(); host.navigate("/leads"); }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Leads
      </a>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{l.name} <StatusBadge status={l.status} /></span>}
        description={[l.jobTitle, l.companyName].filter(Boolean).join(" at ") || undefined}
        actions={canWrite && <>
          <Button variant="ghost" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
          <Button variant="outline" onClick={() => host.navigate(`/leads/${l.id}/edit`)}><Pencil /> Edit</Button>
          {open && <>
            <Button variant="outline" onClick={() => setDialog("disqualify")}><Ban /> Disqualify</Button>
            <Button onClick={() => setDialog("convert")}><UserCheck /> Convert to customer</Button>
          </>}
          {l.status === "disqualified" && <Button variant="outline" onClick={() => void setStatus("contacted").catch(() => {})}><RotateCcw /> Reopen</Button>}
        </>}
      />

      <Card className="mb-4 grid gap-3 p-4">
        <StatusBar lead={l} canWrite={canWrite} onSet={(s) => void setStatus(s).catch(() => {})} />
        {open && (
          <p className={cn("flex items-center gap-2 text-sm", due ? "text-destructive" : "text-muted-foreground")}>
            <CalendarClock className="size-4" />
            {l.followUpOn ? <>Follow up {due ? "was due " : "on "}{fmtDate(l.followUpOn)}</>
              : <>No follow-up date. {canWrite && <button type="button" className="cursor-pointer underline" onClick={() => host.navigate(`/leads/${l.id}/edit`)}>Set one</button>}</>}
          </p>
        )}
        {l.status === "converted" && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-success/10 p-3 text-sm" data-testid="converted-callout">
            <UserCheck className="size-4 text-success" /> Became a customer on {fmtDate(l.convertedAt)}.
            {l.contactId && <a className="inline-flex items-center gap-1 underline" href={core("contacts", l.contactId)}><User className="size-3.5" /> Open contact</a>}
            {l.companyId && <a className="inline-flex items-center gap-1 underline" href={core("companies", l.companyId)}><Building2 className="size-3.5" /> Open company</a>}
          </p>
        )}
        {l.status === "disqualified" && <p className="text-sm text-muted-foreground">Disqualified{l.disqualifyReason ? `: ${l.disqualifyReason}` : ""}.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="grid content-start gap-4 p-5">
          <h2 className="font-semibold">Activity</h2>
          {l.message && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">Their message</p>
              <p className="whitespace-pre-wrap break-words">{l.message}</p>
            </div>
          )}
          {canWrite && <Composer leadId={l.id} onAdded={() => void lead.reload()} />}
          <ol className="grid gap-3" aria-label="Timeline">
            {l.activities.map((a) => {
              const Icon = ICONS[a.kind];
              const auto = a.kind === "status" || a.kind === "system";
              return (
                <li key={a.id} className="flex gap-3">
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", auto ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}><Icon className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("whitespace-pre-wrap break-words text-sm", auto && "text-muted-foreground")}>{a.body}</p>
                    <p className="text-xs text-muted-foreground">{auto ? "" : `${KINDS.find((k) => k.value === a.kind)?.label ?? a.kind} · `}{fmtDateTime(a.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="grid content-start gap-4 p-5 text-sm">
          <h2 className="font-semibold">Details</h2>
          <dl className="grid gap-3">
            <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-all">{l.email ? <a className="hover:underline" href={`mailto:${l.email}`}>{l.email}</a> : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{l.phone ? <a className="hover:underline" href={`tel:${l.phone}`}>{l.phone}</a> : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Company</dt><dd>{l.companyName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{sourceLabel(l.source)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Owner</dt><dd>{l.ownerName ?? "Unassigned"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Possible value</dt><dd className="tabular-nums">{l.valueCents ? fmtMoney(l.valueCents, l.currency) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Added</dt><dd>{fmtDate(l.createdAt)}</dd></div>
          </dl>
          {l.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap">{l.notes}</p></div>}
        </Card>
      </div>

      <ConvertDialog open={dialog === "convert"} onOpenChange={(o) => !o && setDialog(null)} lead={l} crmOn={!!crmOn.data} onDone={(r) => lead.set({ ...r, activities: r.activities })} />
      <DisqualifyDialog open={dialog === "disqualify"} onOpenChange={(o) => !o && setDialog(null)} name={l.name} onConfirm={(reason) => setStatus("disqualified", reason)} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} destructive confirmLabel="Delete lead"
        title="Delete this lead?" description="The lead and its timeline are removed. Contacts, companies and deals made from it are kept. To keep a record, disqualify it instead."
        onConfirm={async () => {
          try { await host.api.del(`/leads/${l.id}`); toast.success("Lead deleted"); host.navigate("/leads"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}

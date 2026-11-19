import { useState, type FormEvent } from "react";
import { ArrowLeft, Inbox as InboxIcon, Mail, Plus, RefreshCw, Search, Settings } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  OverdueBadge, PRIORITIES, PRIORITY, PriorityBadge, StatusBadge, errorMessage, fmtRelative, requesterLabel, useDebounced, useInterval, useLoad,
  type Config, type Counts, type Priority, type TicketDetail, type TicketList, type View,
} from "./shared.tsx";

const VIEWS: { key: View; label: string; count?: keyof Counts }[] = [
  { key: "open", label: "Open", count: "open" }, { key: "mine", label: "Mine", count: "mine" }, { key: "unassigned", label: "Unassigned", count: "unassigned" },
  { key: "pending", label: "Pending", count: "pending" }, { key: "overdue", label: "Overdue", count: "overdue" }, { key: "solved", label: "Solved" }, { key: "all", label: "All" },
];

export function MailboxBanner({ cfg }: { cfg: Config }) {
  const host = useModuleHost();
  if (!cfg.mailbox.configured) {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        <span><strong>Connect your support mailbox</strong> so customer emails become tickets and replies go out by email.</span>
        <Button size="sm" variant="outline" onClick={() => host.navigate("/support/settings")}><Settings /> Support settings</Button>
      </div>
    );
  }
  if (cfg.sync?.lastError) {
    return (
      <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Can't read {cfg.mailbox.address}: {cfg.sync.lastError}{cfg.canManage && <> — check <a className="underline" href={host.href("/support/settings")} onClick={(e) => { e.preventDefault(); host.navigate("/support/settings"); }}>Support settings</a>.</>}
      </div>
    );
  }
  return null;
}

export function Inbox(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<TicketList>("/tickets", { view, q: dq || undefined, priority: priority || undefined }), [host, view, dq, priority]);
  const [checking, setChecking] = useState(false);
  useInterval(() => { void list.reload(); }, 30_000);

  async function checkMail() {
    setChecking(true);
    try {
      const r = await host.api.post<{ imported: number; error: string | null }>("/mailbox/fetch", {});
      if (r.error) toast.error(r.error);
      else toast.success(r.imported ? `${r.imported} new email${r.imported === 1 ? "" : "s"}` : "No new email");
      await Promise.all([list.reload(), cfg.reload()]);
    } catch (e) { toast.error(errorMessage(e)); } finally { setChecking(false); }
  }

  const c = list.data?.counts;
  return (
    <>
      <PageHeader title="Support" description={cfg.data?.mailbox.address ? `Customer emails to ${cfg.data.mailbox.address}` : "Customer questions in one shared inbox"}
        actions={<>
          <Button variant="outline" onClick={() => host.navigate("/support/settings")}><Settings /> Settings</Button>
          {cfg.data?.canReply && cfg.data.mailbox.configured && <Button variant="outline" loading={checking} onClick={() => void checkMail()}><RefreshCw /> Check mail</Button>}
          {cfg.data?.canReply && <Button onClick={() => host.navigate("/support/new")}><Plus /> New ticket</Button>}
        </>} />
      {cfg.data && <MailboxBanner cfg={cfg.data} />}
      <div role="tablist" aria-label="Which tickets" className="mb-3 flex gap-1.5 overflow-x-auto">
        {VIEWS.map((v) => {
          const n = v.count && c ? c[v.count] : null;
          return (
            <Button key={v.key} role="tab" aria-selected={view === v.key} size="sm" variant={view === v.key ? "default" : "outline"} onClick={() => setView(v.key)}
              className={v.key === "overdue" && n ? "data-[state=inactive]:text-destructive" : undefined}>
              {v.label}{n ? <span className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${v.key === "overdue" ? "bg-destructive text-destructive-foreground" : "bg-muted text-foreground"}`}>{n}</span> : null}
            </Button>
          );
        })}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search tickets" className="pl-8" placeholder="Search by #number, subject, customer or text…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Priority" className="w-40" value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p][0]}</option>)}
        </Select>
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : !list.data.data.length ? (
          <Card><EmptyState icon={<InboxIcon />} title={dq ? `Nothing matches “${dq}”` : view === "open" ? "Inbox zero" : "No tickets here"}
            description={!dq && view === "open" ? "New customer emails show up here automatically." : undefined} /></Card>
        ) : (
          <Card className="divide-y" role="list" aria-label="Tickets">
            {list.data.data.map((t) => (
              <a key={t.id} role="listitem" href={host.href(`/support/${t.id}`)} onClick={(e) => { e.preventDefault(); host.navigate(`/support/${t.id}`); }}
                className="grid gap-1 px-4 py-3 hover:bg-accent/50 sm:grid-cols-[1fr_auto] sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{t.ref}</span>
                    <span className={`truncate ${t.lastFrom === "customer" && t.status === "open" ? "font-semibold" : "font-medium"}`}>{t.subject}</span>
                    <PriorityBadge priority={t.priority} /><OverdueBadge t={t} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    <span className="text-foreground">{requesterLabel(t)}</span>{t.channel === "manual" && " (phone/in person)"} — {t.preview}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground sm:flex-col sm:items-end sm:justify-center">
                  <StatusBadge status={t.status} />
                  <span>{t.assigneeName ?? "Unassigned"} · {fmtRelative(t.lastMessageAt)}</span>
                </div>
              </a>
            ))}
          </Card>
        )}
      {list.data && list.data.total > list.data.data.length && <p className="mt-2 text-sm text-muted-foreground">Showing the first {list.data.data.length} of {list.data.total}. Search to narrow it down.</p>}
    </>
  );
}

export function NewTicket(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [mode, setMode] = useState<"email" | "log">("email");
  const [f, setF] = useState({ email: "", name: "", subject: "", body: "", priority: "normal" as Priority, assigneeId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const canEmail = !!cfg.data?.mailbox.configured;
  const m = canEmail ? mode : "log";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (m === "email" && !f.email.trim()) errs.email = "Enter the customer's email address";
    else if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) errs.email = "Use a valid email address";
    if (!f.subject.trim()) errs.subject = "Give the ticket a subject";
    if (!f.body.trim()) errs.body = m === "email" ? "Write the message" : "Write what the customer asked";
    setErrors(errs); setError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const t = await host.api.post<TicketDetail>("/tickets", {
        mode: m, email: f.email.trim() || null, name: f.name.trim() || null, subject: f.subject.trim(), body: f.body.trim(), priority: f.priority, assigneeId: f.assigneeId || null,
      });
      const failed = t.messages.find((x) => x.sendStatus === "failed");
      if (failed) toast.error(`Ticket ${t.ref} created, but the email wasn't sent: ${failed.sendError}`);
      else toast.success(m === "email" ? `Email sent. Ticket ${t.ref} created.` : `Ticket ${t.ref} created`);
      host.navigate(`/support/${t.id}`);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/support")}><ArrowLeft /> Support</Button>
      <PageHeader title="New ticket" />
      {cfg.error ? <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card> : !cfg.data ? <Skeleton className="h-96 max-w-2xl" /> : (
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Card className="grid max-w-2xl gap-4 p-5">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What happened?</legend>
            <label className={`flex items-start gap-2 text-sm ${canEmail ? "" : "opacity-60"}`}>
              <input type="radio" name="mode" className="mt-1" checked={m === "email"} disabled={!canEmail} onChange={() => setMode("email")} />
              <span><span className="font-medium">Email a customer</span><br /><span className="text-muted-foreground">{canEmail ? "We write first; their answer comes back to this ticket." : "Connect the support mailbox in Support settings first."}</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" className="mt-1" checked={m === "log"} onChange={() => setMode("log")} />
              <span><span className="font-medium">Log a call or visit</span><br /><span className="text-muted-foreground">Record a question that came in by phone or in person. Nothing is emailed.</span></span>
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer email" required={m === "email"} error={errors.email}>{(a) => <Input {...a} type="email" autoComplete="off" value={f.email} onChange={set("email")} />}</Field>
            <Field label="Customer name">{(a) => <Input {...a} value={f.name} maxLength={200} onChange={set("name")} />}</Field>
          </div>
          <Field label="Subject" required error={errors.subject}>{(a) => <Input {...a} value={f.subject} maxLength={300} onChange={set("subject")} />}</Field>
          <Field label={m === "email" ? "Message" : "What did they ask?"} required error={errors.body}>{(a) => <Textarea {...a} rows={6} value={f.body} onChange={set("body")} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority">{(a) => (
              <Select {...a} value={f.priority} onChange={set("priority")}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p][0]}</option>)}</Select>
            )}</Field>
            <Field label="Assign to">{(a) => (
              <Select {...a} value={f.assigneeId} onChange={set("assigneeId")}>
                <option value="">{m === "email" ? "Me" : "Nobody yet"}</option>
                {cfg.data?.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </Select>
            )}</Field>
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div><Button type="submit" loading={busy}>{m === "email" ? <><Mail /> Send and create ticket</> : <><Plus /> Create ticket</>}</Button></div>
        </Card>
      </form>
      )}
    </>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { PRIORITY, errorMessage, fmtMinutes, fmtRelative, useLoad, type Config, type Macro, type Target } from "./shared.tsx";

export function SupportSettings(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/support")}><ArrowLeft /> Support</Button>
      <PageHeader title="Support settings" description="Your support mailbox, saved replies and response-time targets." />
      {cfg.error ? <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>
        : !cfg.data ? <Skeleton className="h-96" />
        : (
          <div className="grid max-w-3xl gap-6">
            <MailboxSection cfg={cfg.data} onSaved={() => void cfg.reload()} />
            <MacrosSection canManage={cfg.data.canManage} />
            <TargetsSection canManage={cfg.data.canManage} />
          </div>
        )}
    </>
  );
}

// ── Mailbox ──────────────────────────────────────────────────────────────────
type Sec = "tls" | "starttls" | "none";
interface MailForm {
  address: string; fromName: string; folder: string;
  imapHost: string; imapPort: string; imapSecurity: Sec; imapUser: string; imapPassword: string;
  smtpHost: string; smtpPort: string; smtpSecurity: Sec; smtpUser: string; smtpPassword: string;
}
const EMPTY: MailForm = {
  address: "", fromName: "Support", folder: "INBOX", imapHost: "", imapPort: "993", imapSecurity: "tls", imapUser: "", imapPassword: "",
  smtpHost: "", smtpPort: "465", smtpSecurity: "tls", smtpUser: "", smtpPassword: "",
};
const DEFAULT_PORT: Record<"imap" | "smtp", Record<Sec, string>> = { imap: { tls: "993", starttls: "143", none: "143" }, smtp: { tls: "465", starttls: "587", none: "25" } };

function MailboxSection({ cfg, onSaved }: { cfg: Config; onSaved: () => void }) {
  const host = useModuleHost();
  const admin = host.can("core:modules.manage");
  const [f, setF] = useState<MailForm>(EMPTY);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof MailForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; smtp: string | null; imap: string | null } | null>(null);

  useEffect(() => {
    if (!admin) { setLoaded(true); return; }
    host.core.get<{ key: string; settings: Record<string, unknown>; secretsSet: string[] }[]>("/modules")
      .then((mods) => {
        const m = mods.find((x) => x.key === "support");
        const s = m?.settings ?? {};
        const str = (k: keyof MailForm) => (s[k] === undefined || s[k] === null ? EMPTY[k] : String(s[k]));
        setF({ ...EMPTY, ...Object.fromEntries((Object.keys(EMPTY) as (keyof MailForm)[]).filter((k) => !k.endsWith("Password")).map((k) => [k, str(k)])) } as MailForm);
        setSecrets(m?.secretsSet ?? []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [host, admin]);

  const set = (k: keyof MailForm) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const setSec = (side: "imap" | "smtp") => (e: { target: { value: string } }) => {
    const v = e.target.value as Sec;
    setF((cur) => ({ ...cur, [`${side}Security`]: v, [`${side}Port`]: DEFAULT_PORT[side][v] }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!email.test(f.address.trim())) errs.address = "Enter the support email address, e.g. help@yourshop.com";
    if (!f.imapHost.trim()) errs.imapHost = "Enter the incoming mail server";
    if (!f.smtpHost.trim()) errs.smtpHost = "Enter the outgoing mail server";
    for (const k of ["imapPort", "smtpPort"] as const) {
      const n = Number(f[k]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) errs[k] = "A port between 1 and 65535";
    }
    if (!f.imapPassword && !secrets.includes("imapPassword")) errs.imapPassword = "Enter the password";
    if (!f.smtpPassword && !secrets.includes("smtpPassword")) errs.smtpPassword = "Enter the password";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        address: f.address.trim(), fromName: f.fromName.trim() || "Support", folder: f.folder.trim() || "INBOX",
        imapHost: f.imapHost.trim(), imapPort: Number(f.imapPort), imapSecurity: f.imapSecurity, imapUser: f.imapUser.trim() || null,
        smtpHost: f.smtpHost.trim(), smtpPort: Number(f.smtpPort), smtpSecurity: f.smtpSecurity, smtpUser: f.smtpUser.trim() || null,
      };
      if (f.imapPassword) body.imapPassword = f.imapPassword;
      if (f.smtpPassword) body.smtpPassword = f.smtpPassword;
      const r = await host.core.patch<{ secretsSet: string[] }>("/modules/support/settings", body);
      setSecrets(r.secretsSet);
      setF((cur) => ({ ...cur, imapPassword: "", smtpPassword: "" }));
      toast.success("Mailbox saved");
      onSaved();
      await runTest();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  async function runTest() {
    setTesting(true); setTest(null);
    try { setTest(await host.api.post<{ ok: boolean; smtp: string | null; imap: string | null }>("/mailbox/test", {})); }
    catch (e) { toast.error(errorMessage(e)); } finally { setTesting(false); }
  }

  const status = (
    <div className="grid gap-1 text-sm">
      {cfg.mailbox.configured
        ? <p>Connected to <strong>{cfg.mailbox.address}</strong>.{cfg.sync?.lastOkAt && <> Last checked {fmtRelative(cfg.sync.lastOkAt)}.</>} New mail is fetched every minute.</p>
        : <p className="text-muted-foreground">Not set up yet{cfg.mailbox.missing.length ? ` (missing: ${cfg.mailbox.missing.join(", ")})` : ""}.</p>}
      {cfg.sync?.lastError && <p className="text-destructive">Last attempt failed: {cfg.sync.lastError}</p>}
    </div>
  );

  if (!admin) {
    return (
      <Card className="grid gap-3 p-5">
        <h2 className="font-semibold">Mailbox</h2>
        {status}
        <p className="text-sm text-muted-foreground">An admin can change the mailbox here.</p>
        {cfg.canManage && cfg.mailbox.configured && <TestResult testing={testing} test={test} onTest={() => void runTest()} />}
      </Card>
    );
  }
  if (!loaded) return <Skeleton className="h-80" />;
  const pw = (k: "imapPassword" | "smtpPassword") => (secrets.includes(k) ? "Saved — leave empty to keep it" : undefined);
  return (
    <form onSubmit={(e) => void save(e)} noValidate>
      <Card className="grid gap-4 p-5" role="group" aria-label="Mailbox">
        <div>
          <h2 className="font-semibold">Mailbox</h2>
          <p className="text-sm text-muted-foreground">The email account customers write to. Find these details in your email provider's help pages under “IMAP” and “SMTP”. Many providers need an app password.</p>
        </div>
        {status}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email address" required error={errors.address}>{(a) => <Input {...a} type="email" placeholder="help@yourshop.com" value={f.address} onChange={set("address")} />}</Field>
          <Field label="Sender name" hint="Customers see this as the sender">{(a) => <Input {...a} maxLength={100} value={f.fromName} onChange={set("fromName")} />}</Field>
        </div>
        <fieldset className="grid gap-3 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Incoming mail (IMAP)</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <Field label="IMAP server" required error={errors.imapHost}>{(a) => <Input {...a} placeholder="imap.yourprovider.com" value={f.imapHost} onChange={set("imapHost")} />}</Field>
            <Field label="IMAP port" required error={errors.imapPort}>{(a) => <Input {...a} inputMode="numeric" value={f.imapPort} onChange={set("imapPort")} />}</Field>
            <Field label="IMAP security">{(a) => <Select {...a} value={f.imapSecurity} onChange={setSec("imap")}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">None (testing only)</option></Select>}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="IMAP user name" hint="Empty = the email address">{(a) => <Input {...a} autoComplete="off" value={f.imapUser} onChange={set("imapUser")} />}</Field>
            <Field label="IMAP password" required={!secrets.includes("imapPassword")} hint={pw("imapPassword")} error={errors.imapPassword}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={f.imapPassword} onChange={set("imapPassword")} />}</Field>
            <Field label="Folder" hint="Usually INBOX">{(a) => <Input {...a} value={f.folder} onChange={set("folder")} />}</Field>
          </div>
        </fieldset>
        <fieldset className="grid gap-3 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Outgoing mail (SMTP)</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <Field label="SMTP server" required error={errors.smtpHost}>{(a) => <Input {...a} placeholder="smtp.yourprovider.com" value={f.smtpHost} onChange={set("smtpHost")} />}</Field>
            <Field label="SMTP port" required error={errors.smtpPort}>{(a) => <Input {...a} inputMode="numeric" value={f.smtpPort} onChange={set("smtpPort")} />}</Field>
            <Field label="SMTP security">{(a) => <Select {...a} value={f.smtpSecurity} onChange={setSec("smtp")}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">None (testing only)</option></Select>}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SMTP user name" hint="Empty = the email address">{(a) => <Input {...a} autoComplete="off" value={f.smtpUser} onChange={set("smtpUser")} />}</Field>
            <Field label="SMTP password" required={!secrets.includes("smtpPassword")} hint={pw("smtpPassword")} error={errors.smtpPassword}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={f.smtpPassword} onChange={set("smtpPassword")} />}</Field>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={busy}>Save and test</Button>
          {cfg.mailbox.configured && <Button type="button" variant="outline" loading={testing} onClick={() => void runTest()}>Test connection</Button>}
        </div>
        <TestResult testing={false} test={test} />
      </Card>
    </form>
  );
}

function TestResult({ testing, test, onTest }: { testing: boolean; test: { ok: boolean; smtp: string | null; imap: string | null } | null; onTest?: () => void }) {
  return (
    <div className="grid gap-2">
      {onTest && <div><Button type="button" variant="outline" size="sm" loading={testing} onClick={onTest}>Test connection</Button></div>}
      {test && (
        <ul role="status" aria-label="Connection test" className="grid gap-1 text-sm">
          {([["Incoming (IMAP)", test.imap], ["Outgoing (SMTP)", test.smtp]] as const).map(([label, err]) => (
            <li key={label} className={`flex items-center gap-2 ${err ? "text-destructive" : "text-success"}`}>
              {err ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}{label}: {err ?? "works"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Saved replies ────────────────────────────────────────────────────────────
function MacrosSection({ canManage }: { canManage: boolean }) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Macro[]>("/macros"), [host]);
  const [editing, setEditing] = useState<Macro | "new" | null>(null);
  const [deleting, setDeleting] = useState<Macro | null>(null);
  return (
    <Card className="grid gap-3 p-5" role="group" aria-label="Saved replies">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Saved replies</h2>
          <p className="text-sm text-muted-foreground">Answers to common questions. Use {"{{customer.firstName}}"}, {"{{customer.name}}"}, {"{{ticket.number}}"}, {"{{ticket.subject}}"} or {"{{agent.name}}"} to fill in details.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => setEditing("new")}><Plus /> Add saved reply</Button>}
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
        : !list.data ? <Skeleton className="h-16" />
        : !list.data.length ? <p className="text-sm text-muted-foreground">No saved replies yet.</p>
        : (
          <ul className="divide-y rounded-md border">
            {list.data.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{m.name}</p>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.body}</p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => setDeleting(m)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {editing && <MacroDialog macro={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`}
        onConfirm={async () => { await host.api.del(`/macros/${deleting!.id}`); toast.success("Saved reply deleted"); setDeleting(null); await list.reload(); }} />
    </Card>
  );
}

function MacroDialog({ macro, onClose, onSaved }: { macro: Macro | null; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(macro?.name ?? "");
  const [body, setBody] = useState(macro?.body ?? "");
  const [errors, setErrors] = useState<{ name?: string; body?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Name the saved reply";
    if (!body.trim()) errs.body = "Write the reply text";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (macro) await host.api.patch(`/macros/${macro.id}`, { name: name.trim(), body: body.trim() });
      else await host.api.post("/macros", { name: name.trim(), body: body.trim() });
      toast.success("Saved reply saved");
      onSaved();
    } catch (err) { setErrors({ form: errorMessage(err) }); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={macro ? "Edit saved reply" : "New saved reply"}>
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <Field label="Name" required error={errors.name}>{(a) => <Input {...a} maxLength={80} placeholder="e.g. Refund on its way" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Reply" required error={errors.body}>{(a) => <Textarea {...a} rows={7} value={body} placeholder={"Hi {{customer.firstName}},\n\n…"} onChange={(e) => setBody(e.target.value)} />}</Field>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Response targets ─────────────────────────────────────────────────────────
type Unit = "min" | "h" | "d";
const UNIT_MIN: Record<Unit, number> = { min: 1, h: 60, d: 1440 };
const split = (m: number | null): { v: string; u: Unit } =>
  m === null ? { v: "", u: "h" } : m % 1440 === 0 ? { v: String(m / 1440), u: "d" } : m % 60 === 0 ? { v: String(m / 60), u: "h" } : { v: String(m), u: "min" };

function TargetsSection({ canManage }: { canManage: boolean }) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Target[]>("/targets"), [host]);
  const [rows, setRows] = useState<{ priority: Target["priority"]; first: { v: string; u: Unit }; res: { v: string; u: Unit } }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (list.data) setRows(list.data.map((t) => ({ priority: t.priority, first: split(t.firstResponseMin), res: split(t.resolutionMin) }))); }, [list.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rows) return;
    const toMin = (x: { v: string; u: Unit }) => {
      if (!x.v.trim()) return null;
      const n = Number(x.v.replace(",", "."));
      if (!(n > 0)) return Number.NaN;
      return Math.round(n * UNIT_MIN[x.u]);
    };
    const body = rows.map((r) => ({ priority: r.priority, firstResponseMin: toMin(r.first), resolutionMin: toMin(r.res) }));
    if (body.some((b) => Number.isNaN(b.firstResponseMin) || Number.isNaN(b.resolutionMin))) { setError("Use a number above 0, or leave it empty for no target"); return; }
    setBusy(true); setError(null);
    try { await host.api.put("/targets", body); toast.success("Targets saved. Open tickets follow them now."); await list.reload(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => void save(e)} noValidate>
      <Card className="grid gap-3 p-5" role="group" aria-label="Response targets">
        <div>
          <h2 className="font-semibold">Response targets</h2>
          <p className="text-sm text-muted-foreground">How quickly you aim to first reply and to solve tickets, by priority. Tickets past their target are flagged as overdue and show on the dashboard. Counted in clock time from when the ticket came in.</p>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : !rows ? <Skeleton className="h-40" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Priority</th><th className="py-1 pr-3 font-medium">First reply within</th><th className="py-1 font-medium">Solved within</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.priority}>
                      <td className="py-1.5 pr-3 font-medium">{PRIORITY[r.priority][0]}</td>
                      {(["first", "res"] as const).map((k) => (
                        <td key={k} className="py-1.5 pr-3">
                          {!canManage ? fmtMinutes(list.data![i]![k === "first" ? "firstResponseMin" : "resolutionMin"]) : (
                            <div className="flex gap-1">
                              <Input aria-label={`${PRIORITY[r.priority][0]} ${k === "first" ? "first reply" : "solved"} within`} className="w-20" inputMode="decimal" placeholder="—"
                                value={r[k].v} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: { ...x[k], v: e.target.value } } : x)))} />
                              <Select aria-label={`${PRIORITY[r.priority][0]} ${k === "first" ? "first reply" : "solved"} unit`} className="w-24" value={r[k].u}
                                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: { ...x[k], u: e.target.value as Unit } } : x)))}>
                                <option value="min">minutes</option><option value="h">hours</option><option value="d">days</option>
                              </Select>
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {canManage && rows && <div><Button type="submit" loading={busy}>Save targets</Button></div>}
      </Card>
    </form>
  );
}

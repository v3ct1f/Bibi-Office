import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound, MailCheck, MoreHorizontal, UserPlus, Users } from "lucide-react";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR,
} from "@office/ui";
import { ApiError, errorMessage } from "../api/client.ts";
import { useTMutation, useTQuery } from "../api/hooks.ts";
import type { Member, Role } from "../api/types.ts";
import { useTenant } from "../lib/tenant.tsx";
import { fmtDate, initials } from "../lib/format.ts";
import { useAuth } from "../auth/auth.tsx";
import { useAddons, useWorkmailSwitch } from "../lib/addons.ts";
import { mailboxCostAfter, mailboxCostBefore, mailboxCostShort, type MailboxPrice } from "@office/module-workmail/ui";

const MIN_PASSWORD = 10;

/** A starting password that is easy to read out or type: three groups of four, no look-alike characters. */
function makePassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const n = new Uint32Array(12);
  crypto.getRandomValues(n);
  const s = [...n].map((x) => abc[x % abc.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

interface Made { name: string; email: string; password: string; mailbox?: { address: string; password: string; webmailUrl: string | null; cost: string } | undefined; mailboxError?: string | undefined }
interface WmDomain { id: string; name: string; status: string }
interface Invited { email: string; link: string; emailed: boolean; emailError: string | null }

/** Colleagues: the people who work in this business. The owner creates their sign-in accounts here. */
export function ColleaguesPage() {
  const { api, can, access, tenant } = useTenant();
  const { user } = useAuth();
  const members = useTQuery<Member[]>(["members"], "/members");
  const roles = useTQuery<Role[]>(["roles"], "/roles", undefined, { enabled: can("core:roles.read") });
  const manage = can("core:members.manage");
  const isOwner = access.permissions.includes("*");
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name ?? k;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [invited, setInvited] = useState<Invited | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  // Work email: offered here when adding someone. On = pick an address; off = offer to turn it on.
  const addons = useAddons();
  const wmOn = access.modules.some((m) => m.key === "workmail") && can("workmail:mailbox.write");
  const wmOffer = !wmOn && !!addons.data?.workmail.available && can("core:modules.manage");
  const wmDomains = useTQuery<WmDomain[]>(["workmail-domains"], "/m/workmail/domains", undefined, { enabled: open && wmOn });
  const readyDomains = (wmDomains.data ?? []).filter((d) => d.status === "active");
  // What a mailbox costs this business, and how many it has (shown before the button, never hidden).
  const wmConfig = useTQuery<{ mailboxesUsed: number; maxMailboxes: number; mailboxPrice: MailboxPrice | null }>(["workmail-config"], "/m/workmail/config", undefined, { enabled: open && wmOn });
  const wmPrice = wmConfig.data?.mailboxPrice ?? addons.data?.workmail.mailbox ?? null;
  const [wantMail, setWantMail] = useState(false);
  const [local, setLocal] = useState("");
  const [localEdited, setLocalEdited] = useState(false);
  const [domainId, setDomainId] = useState("");
  const [askPay, setAskPay] = useState(false);
  const turnOn = useWorkmailSwitch();
  const suggest = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase().normalize("NFKD").replace(/[^a-z0-9._-]/g, "") ?? "";

  const start = () => {
    setName(""); setEmail(""); setRole("member"); setPassword(makePassword());
    setError(null); setExists(false); setMade(null); setInvited(null); setWantMail(false); setLocal(""); setLocalEdited(false); setDomainId(""); setAskPay(false); setOpen(true); if (wmOn) void wmDomains.refetch();
  };
  const close = () => { setOpen(false); setPassword(""); setMade(null); setInvited(null); };
  const refresh = () => void members.refetch();

  const create = async () => {
    setBusy(true); setError(null); setExists(false);
    try {
      const acct = await api.post<{ userId: string }>("/members/accounts", { name: name.trim(), email: email.trim(), password, roles: [role] });
      const result: Made = { name: name.trim(), email: email.trim().toLowerCase(), password };
      if (wantMail && wmOn && local && (domainId || readyDomains[0]?.id)) {
        // The account exists now; if the mailbox can't be made, say so but keep the account.
        try {
          const m = await api.post<{ address: string; password: string; webmailUrl: string | null }>("/m/workmail/mailboxes", {
            domainId: domainId || readyDomains[0]!.id, localPart: local, name: name.trim(), userId: acct.userId,
          });
          result.mailbox = { address: m.address, password: m.password, webmailUrl: m.webmailUrl, cost: mailboxCostAfter(wmPrice) };
          void wmConfig.refetch();
        } catch (e) { result.mailboxError = errorMessage(e); }
      }
      setMade(result);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
      setExists(e instanceof ApiError && e.code === "account_exists");
    } finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setError(null);
    try {
      setInvited(await api.post<Invited>("/invitations", { email: email.trim(), roles: [role] }));
      setExists(false);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = useTMutation((m: Member) => api.del(`/members/${m.id}`), { invalidate: [["members"]], success: "Colleague removed" });

  const choosable = (roles.data ?? [{ key: "member", name: "Member" } as Role]).filter((r) => r.key !== "owner" || isOwner);
  const pwOk = password.length >= MIN_PASSWORD;

  return (
    <>
      <PageHeader title="Colleagues" description="The people who work here and can sign in to this business."
        actions={manage && <Button onClick={start}><UserPlus /> Add colleague</Button>} />
      <Card>
        {members.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} />
          : !members.data.length ? <EmptyState icon={<Users />} title="No colleagues yet" />
          : (
            <Table aria-label="Colleagues">
              <THead><TR><TH>Name</TH><TH>Role</TH><TH className="hidden md:table-cell">Joined</TH>{manage && <TH className="w-12" />}</TR></THead>
              <TBody>
                {members.data.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{initials(m.name ?? m.email)}</span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{m.name ?? m.email}{m.email === user?.profile.email && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</div>
                          <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                        </div>
                      </div>
                    </TD>
                    <TD><div className="flex flex-wrap gap-1">{m.roles.length ? m.roles.map((r) => <Badge key={r} variant={r === "owner" ? "default" : "neutral"}>{roleName(r)}</Badge>) : <span className="text-xs text-muted-foreground">No role</span>}</div></TD>
                    <TD className="hidden md:table-cell text-muted-foreground">{fmtDate(m.createdAt)}</TD>
                    {manage && (
                      <TD>
                        {m.email !== user?.profile.email && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${m.name ?? m.email}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild><Link to={`/t/${tenant.slug}/settings/members`}>Change role…</Link></DropdownMenuItem>
                              <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>Remove</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
      </Card>
      {manage && (
        <p className="mt-3 text-xs text-muted-foreground">
          Roles, invitations by email and who is waiting to accept are in <Link className="underline" to={`/t/${tenant.slug}/settings/members`}>Settings → Members</Link>.
        </p>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        {made ? (
          <DialogContent title="Account ready" description={`${made.name} can sign in now.`}>
            <p className="text-sm">Give {made.name} these sign-in details. The first time they sign in, they'll be asked to choose their own password.</p>
            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <CopyField value={made.email} label="Copy email" />
              <span className="text-xs font-medium text-muted-foreground">Starting password</span>
              <CopyField value={made.password} label="Copy password" />
            </div>
            <p className="text-xs text-muted-foreground">This is the only time the password is shown. Office doesn't keep it.</p>
            {made.mailbox && (
              <div className="grid gap-2 rounded-md border p-3" aria-label="Work email">
                <p className="text-sm font-medium">Work email</p>
                <CopyField value={made.mailbox.address} label="Copy work email address" />
                <CopyField value={made.mailbox.password} label="Copy work email password" />
                <p className="text-xs text-muted-foreground">Also shown only once. {made.mailbox.webmailUrl && <a className="underline" href={made.mailbox.webmailUrl} target="_blank" rel="noreferrer">Open webmail</a>}</p>
                {made.mailbox.cost && <p className="text-sm" role="status" data-testid="mailbox-cost-after">{made.mailbox.cost}</p>}
              </div>
            )}
            {made.mailboxError && <p role="alert" className="text-sm text-destructive">The account is ready, but the work email wasn't created: {made.mailboxError} You can create it later under Work email.</p>}
            <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
          </DialogContent>
        ) : invited ? (
          <DialogContent title={invited.emailed ? "Invitation sent" : "Send this link"}>
            {invited.emailed
              ? <p className="flex items-start gap-2 text-sm"><MailCheck className="mt-0.5 size-4 shrink-0 text-success" />We emailed an invitation to {invited.email}. They join when they open it and sign in.</p>
              : <p role="status" className="text-sm">{invited.emailError ?? "Email isn't set up, so send this link yourself."} They join by opening it and signing in as <strong>{invited.email}</strong>.</p>}
            <CopyField value={invited.link} label="Copy invitation link" />
            <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
          </DialogContent>
        ) : (
          <DialogContent title="Add colleague" description="Create their sign-in account. You choose a starting password and give it to them.">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <Field label="Name" required>{(a) => <Input {...a} required autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Email" required hint="They sign in with this address.">
                {(a) => <Input {...a} type="email" required autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); setExists(false); }} placeholder="name@company.com" />}
              </Field>
              <Field label="Role">
                {(a) => (
                  <Select {...a} value={role} onChange={(e) => setRole(e.target.value)}>
                    {choosable.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Starting password" required hint={`At least ${MIN_PASSWORD} characters. They'll choose their own the first time they sign in.`}
                error={password && !pwOk ? `Use at least ${MIN_PASSWORD} characters.` : undefined}>
                {(a) => (
                  <div className="flex gap-2">
                    <Input {...a} required autoComplete="new-password" spellCheck={false} className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <Button type="button" variant="outline" onClick={() => setPassword(makePassword())}><KeyRound /> New</Button>
                  </div>
                )}
              </Field>
              {wmOn && (
                <div className="grid gap-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox checked={wantMail} disabled={!readyDomains.length} aria-label="Give them a work email"
                      onCheckedChange={(v) => { const on = v === true; setWantMail(on); if (on && !localEdited) setLocal(suggest(name)); }} />
                    Give them a work email
                  </label>
                  {!wmDomains.isPending && !readyDomains.length && (
                    <p className="text-xs text-muted-foreground">Work email is on, but you don't have a company domain yet. <Link className="underline" to={`/t/${tenant.slug}/m/workmail/email`}>Choose a domain</Link> first.</p>
                  )}
                  {wantMail && readyDomains.length > 0 && (
                    <p className="rounded-md bg-muted/50 px-2 py-1.5 text-sm" data-testid="mailbox-cost">
                      {mailboxCostBefore(wmPrice)}
                      {wmConfig.data && <span className="text-muted-foreground"> ({wmConfig.data.mailboxesUsed} of {wmConfig.data.maxMailboxes} mailboxes used.)</span>}
                    </p>
                  )}
                  {wantMail && readyDomains.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Input aria-label="Work email name" required className="flex-1" value={local} placeholder="anna" onChange={(e) => { setLocal(e.target.value.toLowerCase()); setLocalEdited(true); }} />
                      <span className="text-muted-foreground">@</span>
                      <Select aria-label="Work email domain" value={domainId || readyDomains[0]!.id} onChange={(e) => setDomainId(e.target.value)}>
                        {readyDomains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    </div>
                  )}
                </div>
              )}
              {wmOffer && (
                <div className="grid gap-2 rounded-md border border-dashed p-3 text-sm">
                  <p className="font-medium">Give them a work email?</p>
                  {!askPay ? (
                    <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setAskPay(true)}>Turn on Work email</Button>
                  ) : (
                    <div className="grid gap-2">
                      <p className="text-muted-foreground">
                        Turning it on costs nothing by itself. {addons.data ? mailboxCostBefore(addons.data.workmail.mailbox).replace("This adds", "Each work mailbox adds") : ""}
                        {" "}Then you choose a company domain (paid once a year) and can give each colleague an address like anna@yourcompany.com.
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" loading={turnOn.isPending} onClick={() => turnOn.mutate(true, { onSuccess: () => setAskPay(false) })}>Yes, turn it on</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setAskPay(false)}>Not now</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {error && (
                <div role="alert" className="grid gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  {error}
                  {exists && <Button type="button" variant="outline" size="sm" className="justify-self-start" loading={busy} onClick={() => void invite()}>Send invitation instead</Button>}
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" loading={busy} disabled={!name.trim() || !email.trim() || !pwOk || (wantMail && !local)}>
                  {wantMail && wmOn && readyDomains.length > 0 ? `Create account and work email${mailboxCostShort(wmPrice)}` : "Create account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Remove"
        title={`Remove ${removing?.name ?? removing?.email ?? ""}?`}
        description="They lose access to this business straight away. Their sign-in account stays, and their past work stays in the history."
        onConfirm={() => remove.mutateAsync(removing!)} />
    </>
  );
}

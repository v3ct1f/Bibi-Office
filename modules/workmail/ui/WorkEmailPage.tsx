import { useEffect, useRef, useState } from "react";
import { AtSign, ExternalLink, KeyRound, MoreHorizontal, Plus } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { BuyDomainDialog, ConnectDomainDialog, RecordsTable, TransferDialog } from "./DomainDialogs.tsx";
import {
  DomainBadge, errorMessage, fmtDate, fmtMoney, REASON, useLoad, type Config, type Domain, type Mailbox, type Member, type NewMailbox,
} from "./shared.tsx";

/** Work email: the company domain and the work mailboxes on it. */
export function WorkEmailPage(_: PageProps) {
  const host = useModuleHost();
  const manageDomains = host.can("workmail:domain.manage");
  const manageMail = host.can("workmail:mailbox.write");
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const domains = useLoad(() => host.api.get<Domain[]>("/domains"), [host]);
  const boxes = useLoad(() => host.api.get<Mailbox[]>("/mailboxes"), [host]);
  const reloadAll = () => { void cfg.reload(); void domains.reload(); void boxes.reload(); };

  const [buying, setBuying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [moving, setMoving] = useState<Domain | null>(null);
  const [making, setMaking] = useState(false);
  const [removeDomain, setRemoveDomain] = useState<Domain | null>(null);
  const [removeBox, setRemoveBox] = useState<Mailbox | null>(null);
  const [created, setCreated] = useState<{ address: string; password: string; webmailUrl: string | null; title: string } | null>(null);
  const [records, setRecords] = useState<Domain | null>(null);

  // Straight after sign-up: the domain the owner chose there (?want=yourcompany.com) opens "Get a domain" with it searched.
  const [wanted, setWanted] = useState<string | undefined>(undefined);
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("want");
    if (!want || !manageDomains) return;
    setWanted(want.toLowerCase().slice(0, 100));
    setBuying(true);
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back from the payment page: finish the order.
  const confirmed = useRef(false);
  useEffect(() => {
    const order = new URLSearchParams(window.location.search).get("order");
    if (!order || confirmed.current || !manageDomains) return;
    confirmed.current = true;
    host.api.post<Domain>(`/domains/${order}/confirm`)
      .then((d) => { toast.success(`${d.name} is yours`); })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => { window.history.replaceState(null, "", window.location.pathname); reloadAll(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); reloadAll(); } catch (e) { toast.error(errorMessage(e)); }
  };

  if (cfg.loading && !cfg.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-72" /></>;
  if (cfg.error || !cfg.data) return <ErrorState error={cfg.error} onRetry={() => void cfg.reload()} />;
  if (!cfg.data.available) {
    return (
      <>
        <PageHeader title="Work email" />
        <Card><EmptyState icon={<AtSign />} title="Work email isn't set up on this server yet" description="Ask the person who runs Office to connect an email provider." /></Card>
      </>
    );
  }
  const ready = (domains.data ?? []).filter((d) => d.status === "active");

  return (
    <>
      <PageHeader title="Work email" description="Your company domain and a work mailbox for each colleague, like anna@yourcompany.com."
        actions={manageMail && ready.length > 0 && <Button onClick={() => setMaking(true)}><Plus /> New mailbox</Button>} />

      {(manageDomains || (domains.data?.length ?? 0) > 0) && (
        <Card className="mb-4 grid gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Domains</h2>
            {manageDomains && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setBuying(true)}><Plus /> Get a domain</Button>
                <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>Connect a domain I own</Button>
              </div>
            )}
          </div>
          {domains.loading && !domains.data ? <Skeleton className="h-16" /> : !domains.data?.length ? (
            <p className="text-sm text-muted-foreground">No domain yet. Get a new one, or connect one you already own, to create work mailboxes.</p>
          ) : (
            <ul className="grid gap-2" aria-label="Domains">
              {domains.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" data-testid={`domain-${d.name}`}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{d.name} <DomainBadge status={d.status} /></p>
                    <p className="text-xs text-muted-foreground">
                      {d.source === "bought"
                        ? `Registered in ${d.registrant?.name ?? "your business"}'s name — it's yours${d.expiresOn ? `, renews ${fmtDate(d.expiresOn)}` : ""}${d.priceCents !== null && d.currency ? ` (${fmtMoney(d.priceCents, d.currency)} per year)` : ""}`
                        : "Your own domain, connected"}
                    </p>
                    {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
                  </div>
                  {manageDomains && (
                    <div className="flex flex-wrap gap-2">
                      {d.status === "dns_pending" && <Button size="sm" variant="outline" onClick={() => setRecords(d)}>Show records</Button>}
                      {d.status === "awaiting_payment" && (
                        <Button size="sm" variant="outline" onClick={() => void act(() => host.api.post(`/domains/${d.id}/confirm`), `${d.name} is yours`)}>Check payment</Button>
                      )}
                      {d.transferable && <Button size="sm" variant="outline" onClick={() => setMoving(d)}>Take it with you</Button>}
                      {!d.transferable && <Button size="sm" variant="ghost" onClick={() => setRemoveDomain(d)}>Remove</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between p-5 pb-0"><h2 className="font-semibold">Mailboxes</h2></div>
        {boxes.loading && !boxes.data ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : boxes.error ? <ErrorState error={boxes.error} onRetry={() => void boxes.reload()} />
          : !boxes.data?.length ? (
            <EmptyState icon={<AtSign />} title={manageMail ? "No mailboxes yet" : "You don't have a work mailbox yet"}
              description={manageMail ? (ready.length ? "Create one for each colleague who needs a work address." : "Get or connect a domain first.") : "Ask the owner to create one for you."} />
          ) : (
            <Table aria-label="Mailboxes">
              <THead><TR><TH>Address</TH><TH>Name</TH><TH>Status</TH><TH className="w-12" /></TR></THead>
              <TBody>
                {boxes.data.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium">{m.address}</TD>
                    <TD>{m.name}</TD>
                    <TD>{m.status === "active" ? <Badge variant="success">On</Badge> : <Badge variant="neutral">Off{m.suspendReason ? ` (${REASON[m.suspendReason]})` : ""}</Badge>}</TD>
                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${m.address}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {m.webmailUrl && m.status === "active" && <DropdownMenuItem asChild><a href={m.webmailUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open webmail</a></DropdownMenuItem>}
                          {manageMail && m.status === "active" && <DropdownMenuItem onSelect={() => void act(async () => {
                            const r = await host.api.post<{ password: string }>(`/mailboxes/${m.id}/reset-password`);
                            setCreated({ address: m.address, password: r.password, webmailUrl: m.webmailUrl, title: "New password" });
                          }, "Password changed")}><KeyRound /> New password</DropdownMenuItem>}
                          {manageMail && m.status === "active" && <DropdownMenuItem onSelect={() => void act(() => host.api.post(`/mailboxes/${m.id}/suspend`), `${m.address} is off`)}>Switch off</DropdownMenuItem>}
                          {manageMail && m.status === "suspended" && <DropdownMenuItem onSelect={() => void act(() => host.api.post(`/mailboxes/${m.id}/resume`), `${m.address} is on`)}>Switch back on</DropdownMenuItem>}
                          {manageMail && <DropdownMenuItem destructive onSelect={() => setRemoveBox(m)}>Delete…</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Your plan includes up to {cfg.data.maxMailboxes} mailboxes. When a colleague is removed, their mailbox is switched off (nothing is deleted).</p>

      <BuyDomainDialog open={buying} initialQuery={wanted} onClose={() => { setBuying(false); setWanted(undefined); }} onDone={reloadAll} />
      <ConnectDomainDialog open={connecting} onClose={() => setConnecting(false)} onDone={reloadAll} />
      <TransferDialog domain={moving} onClose={() => setMoving(null)} />
      <Dialog open={!!records} onOpenChange={(o) => !o && setRecords(null)}>
        <DialogContent title={`Records for ${records?.name ?? ""}`} description="Add these in the DNS settings where you bought the domain, then check.">
          {records?.records && <RecordsTable records={records.records} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecords(null)}>Close</Button>
            <Button onClick={() => { const d = records!; setRecords(null); void act(async () => {
              const r = await host.api.post<{ ok: boolean }>(`/domains/${d.id}/check`);
              if (!r.ok) throw new Error("The records aren't there yet. It can take a few minutes after adding them.");
            }, `${d.name} is connected`); }}>Check now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewMailboxDialog open={making} domains={ready} onClose={() => setMaking(false)} onCreated={(m) => { setMaking(false); setCreated({ address: m.address, password: m.password, webmailUrl: m.webmailUrl, title: "Mailbox ready" }); reloadAll(); }} />
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent title={created?.title ?? ""} description={created?.address}>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Email address</span>
            <CopyField value={created?.address ?? ""} label="Copy address" />
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <CopyField value={created?.password ?? ""} label="Copy password" />
          </div>
          <p className="text-xs text-muted-foreground">This is the only time the password is shown. Office doesn't keep it. You can make a new one anytime.</p>
          <DialogFooter>
            {created?.webmailUrl && <Button asChild variant="outline"><a href={created.webmailUrl} target="_blank" rel="noreferrer">Open webmail</a></Button>}
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!removeDomain} onOpenChange={(o) => !o && setRemoveDomain(null)} destructive confirmLabel="Remove"
        title={`Remove ${removeDomain?.name ?? ""}?`} description="It's taken off this list. A domain you own elsewhere is not affected."
        onConfirm={async () => { await host.api.del(`/domains/${removeDomain!.id}`); reloadAll(); }} />
      <ConfirmDialog open={!!removeBox} onOpenChange={(o) => !o && setRemoveBox(null)} destructive confirmLabel="Delete mailbox"
        title={`Delete ${removeBox?.address ?? ""}?`} description="The mailbox and the mail in it are deleted at the provider. To keep the mail, switch it off instead."
        onConfirm={async () => { await host.api.del(`/mailboxes/${removeBox!.id}`); reloadAll(); }} />
    </>
  );
}

function NewMailboxDialog({ open, domains, onClose, onCreated }: { open: boolean; domains: Domain[]; onClose: () => void; onCreated: (m: NewMailbox) => void }) {
  const host = useModuleHost();
  const members = useLoad(() => (open ? host.core.get<Member[]>("/members") : Promise.resolve([] as Member[])), [host, open]);
  const [domainId, setDomainId] = useState("");
  const [local, setLocal] = useState("");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domainId || domains[0]?.id || "";
  const reset = () => { setLocal(""); setName(""); setUserId(""); setError(null); setBusy(false); };

  const pick = (id: string) => {
    setUserId(id);
    const m = members.data?.find((x) => x.userId === id);
    if (m) {
      if (!name) setName(m.name ?? "");
      if (!local) setLocal((m.name ?? m.email).split(/[\s@]/)[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
    }
  };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const m = await host.api.post<NewMailbox>("/mailboxes", { domainId: domain, localPart: local, name, userId: userId || null });
      reset(); onCreated(m);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent title="New mailbox" description="A work email address for one person.">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label="For colleague" hint="Optional. When they leave, the mailbox is switched off.">
            {(a) => (
              <Select {...a} value={userId} onChange={(e) => pick(e.target.value)}>
                <option value="">Nobody in particular (shared address)</option>
                {(members.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Name" required>{(a) => <Input {...a} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Address" required>
            {(a) => (
              <div className="flex items-center gap-2">
                <Input {...a} required className="flex-1" value={local} onChange={(e) => setLocal(e.target.value.toLowerCase())} placeholder="anna" />
                <span className="text-muted-foreground">@</span>
                <Select aria-label="Domain" value={domain} onChange={(e) => setDomainId(e.target.value)}>
                  {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>
            )}
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!local || !name.trim()}>Create mailbox</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

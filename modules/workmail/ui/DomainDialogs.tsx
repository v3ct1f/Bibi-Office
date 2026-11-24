import { useState } from "react";
import { Search } from "lucide-react";
import { Badge, Button, CopyField, Dialog, DialogContent, DialogFooter, Field, Input, Table, TBody, TD, TH, THead, TR, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { errorMessage, fmtMoney, type Domain, type DnsRecord, type Offer } from "./shared.tsx";

/** The few DNS records a business adds at its own registrar. */
export function RecordsTable({ records }: { records: DnsRecord[] }) {
  return (
    <Table aria-label="DNS records to add">
      <THead><TR><TH>Type</TH><TH>Name / host</TH><TH>Value</TH></TR></THead>
      <TBody>
        {records.map((r) => (
          <TR key={`${r.type}${r.host}`}>
            <TD className="font-mono text-xs">{r.type}{r.priority !== undefined ? ` (priority ${r.priority})` : ""}</TD>
            <TD className="font-mono text-xs">{r.host}</TD>
            <TD className="font-mono text-xs break-all">{r.value}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Search a name, pick it, say who the business is, pay. */
export function BuyDomainDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [picked, setPicked] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reg, setReg] = useState({ name: host.tenant.name, email: "", address: "", city: "", postalCode: "", country: "" });
  const reset = () => { setQ(""); setOffers(null); setPicked(null); setError(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const search = async () => {
    setBusy(true); setError(null);
    try { setOffers(await host.api.get<Offer[]>("/domains/search", { q })); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const buy = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const r = await host.api.post<{ domain: Domain; redirectUrl: string | null }>("/domains/order", {
        domain: picked.domain, registrant: { ...reg, phone: undefined }, returnPath: host.href("/email"),
      });
      if (r.redirectUrl) { window.location.href = r.redirectUrl; return; }
      toast.success(`${r.domain.name} is yours`);
      reset(); onClose(); onDone();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {!picked ? (
        <DialogContent title="Get a company domain" description="Search for the name you'd like, for example your company name.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <Field label="Domain name">
              {(a) => (
                <div className="flex gap-2">
                  <Input {...a} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="tribulis.com" maxLength={100} />
                  <Button type="submit" loading={busy} disabled={q.trim().length < 2}><Search /> Search</Button>
                </div>
              )}
            </Field>
          </form>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {offers && (
            <ul className="grid gap-2" aria-label="Search results">
              {!offers.length && <li className="text-sm text-muted-foreground">Try a name with only letters, numbers and dashes.</li>}
              {offers.map((o) => (
                <li key={o.domain} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{o.domain}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.available ? <Badge variant="success">Available</Badge> : <Badge variant="neutral">Taken</Badge>}
                      {o.available && o.priceCents !== null && <span className="ml-2">{fmtMoney(o.priceCents, o.currency)} per year</span>}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={!o.available} aria-label={`Choose ${o.domain}`} onClick={() => setPicked(o)}>Choose</Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button></DialogFooter>
        </DialogContent>
      ) : (
        <DialogContent title={`Buy ${picked.domain}`} description="We set up the DNS settings for you. You don't need to touch anything.">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void buy(); }}>
            <p className="rounded-md bg-muted p-3 text-sm">
              The domain is registered in <strong>your business's name</strong>, so it belongs to you. If you ever cancel, you can take it with you to another company.
            </p>
            <Field label="Business legal name" required>{(a) => <Input {...a} required maxLength={200} value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} />}</Field>
            <Field label="Contact email" required hint="The registrar sends renewal and ownership notices here.">{(a) => <Input {...a} type="email" required value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />}</Field>
            <Field label="Street address" required>{(a) => <Input {...a} required maxLength={300} value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} />}</Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City" required>{(a) => <Input {...a} required value={reg.city} onChange={(e) => setReg({ ...reg, city: e.target.value })} />}</Field>
              <Field label="Postal code" required>{(a) => <Input {...a} required value={reg.postalCode} onChange={(e) => setReg({ ...reg, postalCode: e.target.value })} />}</Field>
              <Field label="Country" required hint="2 letters, e.g. ES">{(a) => <Input {...a} required maxLength={2} className="uppercase" value={reg.country} onChange={(e) => setReg({ ...reg, country: e.target.value.toUpperCase() })} />}</Field>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPicked(null)}>Back</Button>
              <Button type="submit" loading={busy}>Pay {picked.priceCents !== null ? fmtMoney(picked.priceCents, picked.currency) : ""} and get {picked.domain}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** A domain the business already owns: show the records to add and check them. */
export function ConnectDomainDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const host = useModuleHost();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<Domain | null>(null);
  const [missing, setMissing] = useState<DnsRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const close = () => { const refresh = !!domain; setName(""); setDomain(null); setMissing(null); setError(null); setDone(false); onClose(); if (refresh) onDone(); };

  const start = async () => {
    setBusy(true); setError(null);
    try { setDomain(await host.api.post<Domain>("/domains/connect", { domain: name })); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const check = async () => {
    if (!domain) return;
    setBusy(true); setError(null);
    try {
      const r = await host.api.post<{ ok: boolean; missing: DnsRecord[]; domain: Domain }>(`/domains/${domain.id}/check`);
      setDomain(r.domain); setMissing(r.ok ? null : r.missing); setDone(r.ok);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {!domain ? (
        <DialogContent title="Connect a domain you already own" description="You keep it where it is. We'll show you a few records to add there.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            <Field label="Your domain">{(a) => <Input {...a} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="mycompany.com" maxLength={253} />}</Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" loading={busy} disabled={name.trim().length < 4}>Continue</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : (
        <DialogContent title={done ? `${domain.name} is connected` : `Add these records for ${domain.name}`}
          description={done ? "Mailboxes can now be created on it." : "Sign in where you bought the domain, open its DNS settings and add these. It can take a few minutes (sometimes longer) to show up."}>
          {done ? <p role="status" className="text-sm text-success">All records found. You're ready to create mailboxes.</p> : (
            <>
              {domain.records && <RecordsTable records={domain.records} />}
              {missing && <p role="status" className="text-sm text-warning">Not found yet: {missing.map((m) => m.type).join(", ")}. If you just added them, wait a few minutes and check again.</p>}
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            {done ? <Button onClick={close}>Done</Button> : (
              <>
                <Button variant="outline" onClick={close}>I'll do it later</Button>
                <Button loading={busy} onClick={() => void check()}>Check now</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** "Take it with you": the transfer code. */
export function TransferDialog({ domain, onClose }: { domain: Domain | null; onClose: () => void }) {
  const host = useModuleHost();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setCode(null); setError(null); onClose(); };
  const get = async () => {
    if (!domain) return;
    setBusy(true); setError(null);
    try { setCode((await host.api.post<{ code: string }>(`/domains/${domain.id}/transfer-out`)).code); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!domain} onOpenChange={(o) => !o && close()}>
      <DialogContent title={`Take ${domain?.name ?? "your domain"} with you`} description="The domain is registered in your business's name. To move it to another company, give them this code.">
        {code ? (
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Transfer code</span>
            <CopyField value={code} label="Copy transfer code" />
            <p className="text-xs text-muted-foreground">Start the transfer at the new company, enter this code, and approve the email they send. Mail on this domain keeps working until you move it. Keep the code private.</p>
          </div>
        ) : <p className="text-sm">Showing the code is recorded in the history. A new domain can only be moved after 60 days.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Close</Button>
          {!code && <Button loading={busy} onClick={() => void get()}>Show the transfer code</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogOut, MailCheck, MoreHorizontal, Plus, ShieldOff } from "lucide-react";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR,
} from "@office/ui";
import { errorMessage, request } from "../api/client.ts";
import { useAuth } from "../auth/auth.tsx";
import { fmtDate } from "../lib/format.ts";
import { useMe } from "../shell/AppShell.tsx";
import { FullPage, Loading, slugify } from "./auth.tsx";
import { ProgramOwners } from "./AdminOwners.tsx";
import { DeleteBusinessDialog, usePendingBusinessDelete } from "./AdminDelete.tsx";

interface Business {
  id: string; name: string; slug: string; region: string; status: "active" | "suspended"; createdAt: string; members: number;
  owners: { email: string; name: string | null }[]; features: string[]; allowedFeatures: string[] | null;
  ownerInvite: { email: string; expiresAt: string; expired: boolean } | null;
}
interface Feature { key: string; name: string; description: string; dependsOn: string[] }
interface Sent { email: string; link: string; emailed: boolean; emailError: string | null }
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function SentView({ sent, onDone }: { sent: Sent; onDone: () => void }) {
  return (
    <DialogContent title={sent.emailed ? "Invitation sent" : "Send this link to the owner"}>
      {sent.emailed
        ? <p className="flex items-start gap-2 text-sm"><MailCheck className="mt-0.5 size-4 shrink-0 text-success" />We emailed {sent.email} a link. They become the owner when they open it and sign in with that address.</p>
        : sent.emailError ? <p role="alert" className="text-sm text-destructive">{sent.emailError}</p>
        : <p role="status" className="text-sm">Email isn't set up, so send this link to <strong>{sent.email}</strong> yourself. They become the owner by opening it and signing in with that address.</p>}
      <CopyField value={sent.link} label="Copy invitation link" />
      <p className="text-xs text-muted-foreground">Only {sent.email} can accept it. It works for 7 days.</p>
      <DialogFooter><Button onClick={onDone}>Done</Button></DialogFooter>
    </DialogContent>
  );
}

/** /admin: the program owner's list of businesses. Shows who runs each one, never their data. */
export function AdminPage() {
  const me = useMe();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["platform", "businesses"], enabled: !!me.data?.platformAdmin,
    queryFn: () => request<{ items: Business[] }>("GET", "/platform/businesses"),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "businesses"] });
  usePendingBusinessDelete(() => void refresh());
  const [deleting, setDeleting] = useState<Business | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState("eu");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const effSlug = slugEdited ? slug : slugify(name);
  const slugBad = effSlug !== "" && !SLUG_RE.test(effSlug);
  const create = useMutation({
    mutationFn: () => request<{ invitation: Sent }>("POST", "/platform/businesses", { body: { name: name.trim(), slug: effSlug, region, ownerEmail: ownerEmail.trim() } }),
    onSuccess: (r) => { setSent(r.invitation); void refresh(); },
  });
  const closeCreate = () => { setCreating(false); setSent(null); setName(""); setSlug(""); setSlugEdited(false); setOwnerEmail(""); create.reset(); };

  const [reinvite, setReinvite] = useState<Business | null>(null);
  const [reEmail, setReEmail] = useState("");
  const [reSent, setReSent] = useState<Sent | null>(null);
  const resend = useMutation({
    mutationFn: (b: Business) => request<{ invitation: Sent }>("POST", `/platform/businesses/${b.id}/owner-invite`, { body: { email: reEmail.trim() } }),
    onSuccess: (r) => { setReSent(r.invitation); void refresh(); },
  });
  const closeReinvite = () => { setReinvite(null); setReSent(null); resend.reset(); };

  const catalog = useQuery({
    queryKey: ["platform", "features"], enabled: !!me.data?.platformAdmin,
    queryFn: () => request<{ items: Feature[] }>("GET", "/platform/features"),
  });
  const features = catalog.data?.items ?? [];
  const featureName = (k: string) => features.find((f) => f.key === k)?.name ?? k;
  const [choosing, setChoosing] = useState<Business | null>(null);
  const [allFeatures, setAllFeatures] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [turnedOff, setTurnedOff] = useState<string[] | null>(null);
  const openChoose = (b: Business) => {
    setAllFeatures(b.allowedFeatures === null); setPicked(new Set(b.allowedFeatures ?? features.map((f) => f.key))); setTurnedOff(null); setChoosing(b);
  };
  /** Ticking a feature also ticks what it needs; unticking one also unticks what needs it. */
  const tick = (key: string, on: boolean) => {
    const next = new Set(picked);
    const addDeps = (k: string) => { if (next.has(k)) return; next.add(k); features.find((f) => f.key === k)?.dependsOn.forEach(addDeps); };
    const dropUsers = (k: string) => { next.delete(k); features.filter((f) => f.dependsOn.includes(k) && next.has(f.key)).forEach((f) => dropUsers(f.key)); };
    if (on) { next.delete(key); addDeps(key); } else dropUsers(key);
    setPicked(next);
  };
  const saveFeatures = useMutation({
    mutationFn: (b: Business) => request<{ features: string[] | null; turnedOff: string[] }>("PUT", `/platform/businesses/${b.id}/features`, { body: { features: allFeatures ? null : [...picked] } }),
    onSuccess: (r) => { void refresh(); if (r.turnedOff.length) setTurnedOff(r.turnedOff); else setChoosing(null); },
  });
  const closeChoose = () => { setChoosing(null); setTurnedOff(null); saveFeatures.reset(); };
  const enabledLost = choosing && !allFeatures ? choosing.features.filter((k) => !picked.has(k)) : [];

  const [toggling, setToggling] = useState<Business | null>(null);
  const toggle = useMutation({
    mutationFn: (b: Business) => request("POST", `/platform/businesses/${b.id}/${b.status === "active" ? "pause" : "resume"}`),
    onSuccess: () => refresh(),
  });

  if (me.isPending) return <Loading />;
  if (me.isError) return <FullPage><Card className="w-full max-w-md"><ErrorState error={me.error} onRetry={() => me.refetch()} /></Card></FullPage>;
  if (!me.data.platformAdmin) {
    return (
      <FullPage>
        <Card className="w-full max-w-md">
          <EmptyState icon={<ShieldOff />} title="No access" description="This page is only for the program owner."
            action={<Button asChild variant="outline"><Link to="/">Go home</Link></Button>} />
        </Card>
      </FullPage>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="flex-1 truncate font-semibold"><span className="hidden sm:inline">Office · </span>Program admin</span>
          {me.data.tenants.length > 0 && <Button asChild variant="ghost" size="sm"><Link to="/">My workspaces</Link></Button>}
          <Button variant="ghost" size="sm" onClick={() => void signOut()} aria-label="Sign out"><LogOut /><span className="hidden sm:inline">Sign out</span></Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6">
        <PageHeader title="Businesses" description="Each business has its own workspace and data. You set them up and pause them; you can't see inside them."
          actions={<Button onClick={() => setCreating(true)}><Plus /> New business</Button>} />
        {list.isError ? <Card><ErrorState error={list.error} onRetry={() => list.refetch()} /></Card>
        : list.isPending ? <Card className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</Card>
        : !items.length ? (
          <Card><EmptyState icon={<Building2 />} title="No businesses yet" description="Create one and invite its owner. They'll get their own dashboard."
            action={<Button onClick={() => setCreating(true)}><Plus /> New business</Button>} /></Card>
        ) : (
          <Card className="overflow-x-auto">
            <Table aria-label="Businesses">
              <THead><TR><TH>Business</TH><TH>Owner</TH><TH className="hidden md:table-cell">People</TH><TH className="hidden lg:table-cell">Features</TH><TH className="hidden md:table-cell">Created</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
              <TBody>
                {items.map((b) => (
                  <TR key={b.id}>
                    <TD><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{b.slug} · {b.region.toUpperCase()}</div></TD>
                    <TD>
                      {b.owners.length ? b.owners.map((o) => <div key={o.email} className="text-sm">{o.name || o.email}{o.name && <span className="block text-xs text-muted-foreground">{o.email}</span>}</div>)
                        : b.ownerInvite ? <div className="text-sm">{b.ownerInvite.email}<span className="block text-xs text-muted-foreground">{b.ownerInvite.expired ? "Invitation expired" : `Invited, until ${fmtDate(b.ownerInvite.expiresAt)}`}</span></div>
                        : <span className="text-sm text-muted-foreground">No owner</span>}
                    </TD>
                    <TD className="hidden md:table-cell">{b.members}</TD>
                    <TD className="hidden lg:table-cell"><span className="text-sm text-muted-foreground">
                      {b.allowedFeatures === null ? "All included" : `${b.allowedFeatures.length} of ${features.length} included`}
                      <span className="block text-xs">{b.features.length ? `${b.features.length} turned on` : "None turned on"}</span>
                    </span></TD>
                    <TD className="hidden md:table-cell">{fmtDate(b.createdAt)}</TD>
                    <TD>{b.status === "active" ? <Badge variant="success">Active</Badge> : <Badge variant="warning">Paused</Badge>}</TD>
                    <TD className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${b.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openChoose(b)}>Choose features</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => { setReEmail(b.ownerInvite?.email ?? b.owners[0]?.email ?? ""); setReinvite(b); }}>Send new owner invitation</DropdownMenuItem>
                          <DropdownMenuItem destructive={b.status === "active"} onSelect={() => setToggling(b)}>{b.status === "active" ? "Pause business" : "Reactivate business"}</DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => setDeleting(b)}>Delete business…</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
        <ProgramOwners />
      </main>

      <Dialog open={creating} onOpenChange={(o) => (o ? setCreating(true) : closeCreate())}>
        {sent ? <SentView sent={sent} onDone={closeCreate} /> : (
          <DialogContent title="New business" description="Creates an empty workspace and invites its owner. They choose their features and invite their own staff.">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <Field label="Business name" required>{(a) => <Input {...a} autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Ltd" />}</Field>
              <Field label="Workspace URL" hint={`Used in links: /t/${effSlug || "acme"}`} error={slugBad ? "3–40 chars: lowercase letters, digits, dashes" : undefined} required>
                {(a) => <Input {...a} required value={effSlug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()); }} />}
              </Field>
              <Field label="Owner's email" hint="The business owner signs in with this address to accept." required>
                {(a) => <Input {...a} type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@acme.com" />}
              </Field>
              <Field label="Data region">
                {(a) => <Select {...a} value={region} onChange={(e) => setRegion(e.target.value)}><option value="eu">European Union</option><option value="us">United States</option></Select>}
              </Field>
              {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate}>Cancel</Button>
                <Button type="submit" loading={create.isPending} disabled={!name.trim() || !effSlug || slugBad || !ownerEmail.trim()}>Create and invite</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!reinvite} onOpenChange={(o) => !o && closeReinvite()}>
        {reSent ? <SentView sent={reSent} onDone={closeReinvite} /> : (
          <DialogContent title={`New owner invitation for ${reinvite?.name ?? ""}`} description="Replaces any owner invitation that hasn't been accepted yet. Current owners stay owners.">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (reinvite) resend.mutate(reinvite); }}>
              <Field label="Owner's email" required>{(a) => <Input {...a} type="email" required autoFocus value={reEmail} onChange={(e) => setReEmail(e.target.value)} />}</Field>
              {resend.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(resend.error)}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeReinvite}>Cancel</Button>
                <Button type="submit" loading={resend.isPending} disabled={!reEmail.trim()}>Send invitation</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!choosing} onOpenChange={(o) => !o && closeChoose()}>
        {turnedOff ? (
          <DialogContent title="Features saved">
            <p role="status" className="text-sm">These were turned off in {choosing?.name}: <strong>{turnedOff.map(featureName).join(", ")}</strong>. Their data is kept and comes back if you include them again.</p>
            <DialogFooter><Button onClick={closeChoose}>Done</Button></DialogFooter>
          </DialogContent>
        ) : (
          <DialogContent title={`Features for ${choosing?.name ?? ""}`} description="What this business can turn on. They still choose which of these to use.">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (choosing) saveFeatures.mutate(choosing); }}>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox checked={allFeatures} onCheckedChange={(v) => setAllFeatures(v === true)} aria-label="All features" className="mt-0.5" />
                <span><span className="font-medium">All features</span><span className="block text-muted-foreground">Including ones added to Office later.</span></span>
              </label>
              {!allFeatures && (
                <fieldset className="grid max-h-72 gap-2 overflow-y-auto rounded-md border p-3">
                  <legend className="sr-only">Included features</legend>
                  {features.map((f) => (
                    <label key={f.key} className="flex items-start gap-2.5 text-sm">
                      <Checkbox checked={picked.has(f.key)} onCheckedChange={(v) => tick(f.key, v === true)} aria-label={f.name} className="mt-0.5" />
                      <span><span className="font-medium">{f.name}</span>
                        {f.dependsOn.length > 0 && <span className="block text-xs text-muted-foreground">Needs {f.dependsOn.map(featureName).join(", ")}</span>}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {enabledLost.length > 0 && (
                <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                  {choosing?.name} is using {enabledLost.map(featureName).join(", ")}. Saving turns {enabledLost.length > 1 ? "them" : "it"} off for them; the data is kept.
                </p>
              )}
              {saveFeatures.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(saveFeatures.error)}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeChoose}>Cancel</Button>
                <Button type="submit" loading={saveFeatures.isPending}>Save features</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog open={!!toggling} onOpenChange={(o) => !o && setToggling(null)} destructive={toggling?.status === "active"}
        confirmLabel={toggling?.status === "active" ? "Pause" : "Reactivate"}
        title={toggling?.status === "active" ? `Pause ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}
        description={toggling?.status === "active"
          ? "Nobody in this business can sign in to it, and its automations stop. Nothing is deleted; you can reactivate it any time."
          : "Its people can use it again, and its automations start again."}
        onConfirm={() => toggle.mutateAsync(toggling!)} />
      <DeleteBusinessDialog business={deleting} email={me.data.email} onClose={() => setDeleting(null)} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { MailCheck, MoreHorizontal, UserPlus, Users } from "lucide-react";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, Label, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR,
} from "@office/ui";
import type { Member, Role } from "../../api/types.ts";

interface Invitation { id: string; email: string; roles: string[]; expiresAt: string; createdAt: string; expired: boolean; invitedByName: string | null }
interface Invited { email: string; link: string; emailed: boolean; emailError: string | null }
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDate, initials } from "../../lib/format.ts";
import { useAuth } from "../../auth/auth.tsx";

function RolePicker({ roles, value, onChange, canGrantOwner }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void; canGrantOwner: boolean }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((r) => {
        const disabled = r.key === "owner" && !canGrantOwner;
        return (
          <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <Checkbox className="mt-0.5" disabled={disabled} checked={value.includes(r.key)}
              onCheckedChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} aria-label={r.name} />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{r.name}{r.system && <Badge variant="neutral" className="ml-2">built-in</Badge>}</span>
              <span className="text-xs text-muted-foreground">{r.permissions.includes("*") ? "Full access, including billing and ownership" : `${r.permissions.length} permissions`}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function MembersPage() {
  const { api, can, access } = useTenant();
  const { user } = useAuth();
  const members = useTQuery<Member[]>(["members"], "/members");
  const roles = useTQuery<Role[]>(["roles"], "/roles", undefined, { enabled: can("core:roles.read") });
  const manage = can("core:members.manage");
  const isOwner = access.permissions.includes("*");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>(["member"]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Member | null>(null);
  useEffect(() => { if (editing) setEditRoles(editing.roles); }, [editing]);

  const invitations = useTQuery<Invitation[]>(["invitations"], "/invitations", undefined, { enabled: manage });
  const [invited, setInvited] = useState<Invited | null>(null);
  const closeInvite = () => { setAdding(false); setInvited(null); setEmail(""); setNewRoles(["member"]); };
  const add = useTMutation(() => api.post<Invited>("/invitations", { email: email.trim(), roles: newRoles }), {
    invalidate: [["invitations"]], onSuccess: (r) => setInvited(r),
  });
  const withdraw = useTMutation((i: Invitation) => api.del(`/invitations/${i.id}`), { invalidate: [["invitations"]], success: "Invitation withdrawn" });
  const setRolesM = useTMutation((m: Member) => api.put(`/members/${m.id}/roles`, { roles: editRoles }), { invalidate: [["members"]], success: "Roles updated", onSuccess: () => setEditing(null) });
  const remove = useTMutation((m: Member) => api.del(`/members/${m.id}`), { invalidate: [["members"]], success: "Member removed" });
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name ?? k;

  return (
    <>
      <PageHeader title="Members" description="People who can sign in to this workspace."
        actions={manage && <Button onClick={() => setAdding(true)}><UserPlus /> Invite people</Button>} />
      <Card>
        {members.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} />
          : !members.data.length ? <EmptyState icon={<Users />} title="No members" />
          : (
            <Table>
              <THead><TR><TH>Member</TH><TH>Roles</TH><TH className="hidden md:table-cell">Joined</TH>{manage && <TH className="w-12" />}</TR></THead>
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
                    <TD><div className="flex flex-wrap gap-1">{m.roles.length ? m.roles.map((r) => <Badge key={r} variant={r === "owner" ? "default" : "neutral"}>{roleName(r)}</Badge>) : <span className="text-xs text-muted-foreground">No roles</span>}</div></TD>
                    <TD className="hidden md:table-cell text-muted-foreground">{fmtDate(m.createdAt)}</TD>
                    {manage && (
                      <TD>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${m.email}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!roles.data} onSelect={() => setEditing(m)}>Change roles</DropdownMenuItem>
                            <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>Remove from workspace</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
      </Card>

      {manage && !!invitations.data?.length && (
        <Card className="mt-4">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Waiting to accept</h2>
          <ul aria-label="Open invitations" className="divide-y">
            {invitations.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.roles.map(roleName).join(", ")}{i.invitedByName ? ` · invited by ${i.invitedByName}` : ""} · {i.expired ? "expired" : `link works until ${fmtDate(i.expiresAt)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {i.expired && <Badge variant="warning">Expired</Badge>}
                  <Button variant="ghost" size="sm" aria-label={`Withdraw the invitation for ${i.email}`} loading={withdraw.isPending && withdraw.variables?.id === i.id} onClick={() => withdraw.mutate(i)}>Withdraw</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={adding} onOpenChange={(o) => (o ? setAdding(true) : closeInvite())}>
        {invited ? (
          <DialogContent title={invited.emailed ? "Invitation sent" : "Send this link"}>
            {invited.emailed
              ? <p className="flex items-start gap-2 text-sm"><MailCheck className="mt-0.5 size-4 shrink-0 text-success" />We emailed an invitation to {invited.email}. They join when they open it and sign in with that address.</p>
              : invited.emailError ? <p role="alert" className="text-sm text-destructive">{invited.emailError}</p>
              : <p role="status" className="text-sm">Email isn't set up for Office, so send this link to <strong>{invited.email}</strong> yourself. They join by opening it and signing in with that address.</p>}
            <CopyField value={invited.link} label="Copy invitation link" />
            <p className="text-xs text-muted-foreground">Anyone can open the link, but only {invited.email} can accept it. It works for 7 days.</p>
            <DialogFooter><Button onClick={closeInvite}>Done</Button></DialogFooter>
          </DialogContent>
        ) : (
        <DialogContent title="Invite someone" description="They get a link to join this workspace, and accept it by signing in with this email address.">
          <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Field label="Email" required>{(a) => <Input {...a} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />}</Field>
            {roles.data ? <RolePicker roles={roles.data} value={newRoles} onChange={setNewRoles} canGrantOwner={isOwner} />
              : <Field label="Role">{(a) => <Input {...a} value={newRoles.join(",")} onChange={(e) => setNewRoles(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />}</Field>}
            <DialogFooter>
              <Button variant="outline" onClick={closeInvite}>Cancel</Button>
              <Button type="submit" loading={add.isPending} disabled={!email || !newRoles.length}>Invite</Button>
            </DialogFooter>
          </form>
        </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={`Roles for ${editing?.name ?? editing?.email ?? ""}`}>
          {roles.data && <RolePicker roles={roles.data} value={editRoles} onChange={setEditRoles} canGrantOwner={isOwner} />}
          <Label className="text-xs font-normal text-muted-foreground">A workspace always keeps at least one owner.</Label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={setRolesM.isPending} onClick={() => editing && setRolesM.mutate(editing)}>Save roles</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Remove"
        title={`Remove ${removing?.email}?`} description="They lose access to this workspace immediately. Their past activity stays in the audit log."
        onConfirm={() => remove.mutateAsync(removing!)} />
    </>
  );
}

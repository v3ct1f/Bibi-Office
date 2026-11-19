import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { del, errorMessage, get, post, put } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { Member, Role } from "../lib/types.ts";
import { ConfirmButton, QueryView } from "../components/common.tsx";

const useRoles = () => { const s = useSession(); return useQuery({ queryKey: ["tenant", s.tenantId, "roles"], queryFn: () => get<Role[]>("/roles"), enabled: s.can("core:roles.read") }); };

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange(v: string[]): void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((r) => (
        <label key={r.key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(r.key)} onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((x) => x !== r.key))} />
          {r.name} <span className="text-xs text-muted">{r.key}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function MembersPage() {
  const s = useSession();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["tenant", s.tenantId, "members"], queryFn: () => get<Member[]>("/members") });
  const roles = useRoles();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const manage = s.can("core:members.manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "members"] });
  return (
    <>
      <PageHeader title="Members" description="People who can sign in to this organization."
        actions={manage && <Button onClick={() => setAdding(true)}><UserPlus size={16} />Add member</Button>} />
      <QueryView q={members}>{(rows) => (
        <Card><Table>
          <THead><TR><TH>Member</TH><TH>Roles</TH><TH className="hidden sm:table-cell">Status</TH><TH /></TR></THead>
          <TBody>{rows.map((m) => (
            <TR key={m.id}>
              <TD><div className="font-medium">{m.name ?? m.email}</div><div className="text-xs text-muted">{m.email}</div></TD>
              <TD><div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} tone={r === "owner" ? "primary" : "neutral"}>{r}</Badge>)}</div></TD>
              <TD className="hidden sm:table-cell">{m.status}</TD>
              <TD className="whitespace-nowrap text-right">{manage && <>
                <Button variant="ghost" size="sm" aria-label={`Edit roles for ${m.email}`} onClick={() => setEditing(m)}><Pencil size={14} /></Button>
                <ConfirmButton label={<Trash2 size={14} aria-label={`Remove ${m.email}`} />} title="Remove member?" body={`${m.email} will lose access.`}
                  onConfirm={async () => { await del(`/members/${m.id}`); await refresh(); }} />
              </>}</TD>
            </TR>))}
          </TBody>
        </Table></Card>
      )}</QueryView>
      {adding && roles.data && <AddMember roles={roles.data} onClose={() => setAdding(false)} onDone={refresh} />}
      {editing && roles.data && <EditRoles m={editing} roles={roles.data} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}

function AddMember({ roles, onClose, onDone }: { roles: Role[]; onClose(): void; onDone(): Promise<unknown> }) {
  const [email, setEmail] = useState("");
  const [sel, setSel] = useState<string[]>(["member"]);
  const m = useMutation({ mutationFn: () => post("/members", { email, roles: sel }), onSuccess: async () => { await onDone(); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add member" description="The person must have signed in to Office once.">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="Email">{(a) => <Input {...a} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <RolePicker roles={roles} value={sel} onChange={setSel} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!sel.length || m.isPending}>Add</Button></div>
      </form>
    </Dialog>
  );
}

function EditRoles({ m, roles, onClose, onDone }: { m: Member; roles: Role[]; onClose(): void; onDone(): Promise<unknown> }) {
  const [sel, setSel] = useState(m.roles);
  const mut = useMutation({ mutationFn: () => put(`/members/${m.id}/roles`, { roles: sel }), onSuccess: async () => { await onDone(); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Roles for ${m.email}`} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={mut.isPending} onClick={() => mut.mutate()}>Save</Button>
    </>}>
      {mut.error && <Alert>{errorMessage(mut.error)}</Alert>}
      <RolePicker roles={roles} value={sel} onChange={setSel} />
    </Dialog>
  );
}

// ───────── Roles ─────────
export function RolesPage() {
  const s = useSession();
  const roles = useRoles();
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  return (
    <>
      <PageHeader title="Roles" description="System roles are fixed. Create custom roles for anything in between."
        actions={s.can("core:roles.manage") && <Button onClick={() => setEditing("new")}><Plus size={16} />New role</Button>} />
      <QueryView q={roles}>{(rows) => (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.key} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{r.name} <span className="text-xs text-muted">{r.key}</span></p>
                {r.system ? <Badge>system</Badge> : s.can("core:roles.manage") && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
              </div>
              <p className="mt-2 text-xs text-muted">{r.permissions.includes("*") ? "All permissions" : `${r.permissions.length} permission(s)`}</p>
            </Card>
          ))}
        </div>
      )}</QueryView>
      {editing && <RoleEditor role={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoleEditor({ role, onClose }: { role: Role | null; onClose(): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const core = useQuery({ queryKey: ["permissions"], queryFn: () => get<{ core: string[] }>("/permissions") });
  const groups = useMemo(() => {
    const g: Record<string, { key: string; label: string }[]> = { core: (core.data?.core ?? []).map((k) => ({ key: k, label: k.slice(5) })) };
    for (const m of s.modules) if (m.permissions.length) g[m.name] = m.permissions;
    return g;
  }, [core.data, s.modules]);
  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const save = useMutation({
    mutationFn: () => put(`/roles/${key}`, { name, permissions: perms }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "roles"] }); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => del(`/roles/${key}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "roles"] }); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={role ? `Edit ${role.name}` : "New role"} footer={<>
      {role && <Button variant="danger" className="mr-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={save.isPending || !key || !name} onClick={() => save.mutate()}>Save</Button>
    </>}>
      {(save.error || remove.error) && <Alert>{errorMessage(save.error ?? remove.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Key" hint="e.g. sales">{(a) => <Input {...a} disabled={!!role} pattern="[a-z][a-z0-9_\-]{1,40}" value={key} onChange={(e) => setKey(e.target.value)} />}</Field>
      </div>
      {Object.entries(groups).map(([g, list]) => (
        <fieldset key={g} className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">{g}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {list.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={perms.includes(p.key)} onChange={(e) => setPerms(e.target.checked ? [...perms, p.key] : perms.filter((x) => x !== p.key))} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </Dialog>
  );
}

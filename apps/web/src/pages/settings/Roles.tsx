import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Shield } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter,
  ErrorState, Field, Input, PageHeader, Skeleton,
} from "@office/ui";
import type { ModuleInfo, Role } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";

interface PermGroup { key: string; label: string; perms: { key: string; label: string }[] }

const CORE_LABELS: Record<string, string> = {
  tenant: "Workspace", members: "Members", roles: "Roles", modules: "Apps & modules", apikeys: "API keys", audit: "Audit log",
  contacts: "Contacts", companies: "Companies", documents: "Documents", tasks: "Tasks", workflows: "Workflows", webhooks: "Webhooks",
};
const VERB: Record<string, string> = { read: "View", write: "Create & edit", manage: "Manage" };

export function usePermissionGroups(): PermGroup[] {
  const { can } = useTenant();
  const core = useTQuery<{ core: string[] }>(["permissions"], "/permissions");
  const mods = useTQuery<ModuleInfo[]>(["modules"], "/modules", undefined, { enabled: can("core:modules.read") });
  return useMemo(() => {
    const byRes = new Map<string, { key: string; label: string }[]>();
    for (const p of core.data?.core ?? []) {
      const [res, verb] = p.slice(5).split(".") as [string, string];
      byRes.set(res, [...(byRes.get(res) ?? []), { key: p, label: VERB[verb] ?? verb }]);
    }
    const coreGroups = [...byRes].map(([res, perms]) => ({ key: `core:${res}`, label: CORE_LABELS[res] ?? res, perms }));
    const modGroups = (mods.data ?? []).filter((m) => m.permissions.length)
      .map((m) => ({ key: m.key, label: m.name, perms: m.permissions }));
    return [...coreGroups, ...modGroups];
  }, [core.data, mods.data]);
}

export function PermissionPicker({ groups, value, onChange, limitTo }: {
  groups: PermGroup[]; value: string[]; onChange: (v: string[]) => void; limitTo?: (p: string) => boolean;
}) {
  const set = new Set(value);
  const toggle = (p: string, on: boolean) => { const n = new Set(set); if (on) n.add(p); else n.delete(p); onChange([...n]); };
  return (
    <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
      {groups.map((g) => (
        <fieldset key={g.key} className="rounded-md border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</legend>
          <div className="grid gap-2">
            {g.perms.map((p) => {
              const disabled = limitTo ? !limitTo(p.key) : false;
              return (
                <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50" title={p.key}>
                  <Checkbox checked={set.has(p.key)} disabled={disabled} onCheckedChange={(c) => toggle(p.key, c === true)} aria-label={p.key} />
                  {p.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const KEY_RE = /^[a-z][a-z0-9_-]{1,40}$/;

export function RolesPage() {
  const { api, can } = useTenant();
  const roles = useTQuery<Role[]>(["roles"], "/roles");
  const groups = usePermissionGroups();
  const manage = can("core:roles.manage");
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [form, setForm] = useState({ key: "", name: "", permissions: [] as string[] });
  const [deleting, setDeleting] = useState<Role | null>(null);
  useEffect(() => {
    if (editing === "new") setForm({ key: "", name: "", permissions: [] });
    else if (editing) setForm({ key: editing.key, name: editing.name, permissions: editing.permissions });
  }, [editing]);
  const save = useTMutation(() => api.put(`/roles/${form.key}`, { name: form.name.trim(), permissions: form.permissions }), {
    invalidate: [["roles"]], success: "Role saved", onSuccess: () => setEditing(null),
  });
  const del = useTMutation((r: Role) => api.del(`/roles/${r.key}`), { invalidate: [["roles"]], success: "Role deleted" });
  const viewOnly = editing !== null && editing !== "new" && (editing.system || !manage);

  return (
    <>
      <PageHeader title="Roles" description="Bundles of permissions you assign to members. Built-in roles update automatically when apps are enabled."
        actions={manage && <Button onClick={() => setEditing("new")}><Plus /> New role</Button>} />
      {roles.isPending ? <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : roles.isError ? <Card><ErrorState error={roles.error} onRetry={() => roles.refetch()} /></Card>
        : (
          <div className="grid gap-3 sm:grid-cols-2">
            {roles.data.map((r) => (
              <Card key={r.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    {r.system ? <Lock className="size-3.5 text-muted-foreground" /> : <Shield className="size-3.5 text-primary" />}
                    {r.name}<code className="font-mono text-xs font-normal text-muted-foreground">{r.key}</code>
                  </CardTitle>
                  <CardDescription>{r.permissions.includes("*") ? "Everything" : `${r.permissions.length} permission${r.permissions.length === 1 ? "" : "s"}`}{r.system && " · built-in"}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>{r.system || !manage ? "View" : "Edit"}</Button>
                  {!r.system && manage && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(r)}>Delete</Button>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent wide title={editing === "new" ? "New role" : viewOnly ? (editing as Role).name : `Edit ${form.name}`}
          description={viewOnly ? "Built-in roles are managed by the platform." : "Members with this role get every permission checked here."}>
          {viewOnly ? (
            <div className="flex flex-wrap gap-1.5">{form.permissions.map((p) => <Badge key={p} variant="outline" className="font-mono">{p}</Badge>)}</div>
          ) : (
            <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required>{(a) => <Input {...a} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Accountant" />}</Field>
                <Field label="Key" required hint="Lowercase id, can’t be changed later" error={form.key && !KEY_RE.test(form.key) ? "2–41 chars: a-z, 0-9, - or _" : undefined}>
                  {(a) => <Input {...a} required disabled={editing !== "new"} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} placeholder="accountant" />}
                </Field>
              </div>
              <PermissionPicker groups={groups} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" loading={save.isPending} disabled={!form.name.trim() || !KEY_RE.test(form.key)}>Save role</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive confirmLabel="Delete role"
        title={`Delete role “${deleting?.name}”?`} description="Members lose the permissions this role granted." onConfirm={() => del.mutateAsync(deleting!)} />
    </>
  );
}

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader,
  Skeleton, Table, TBody, TD, TH, THead, TR,
} from "@office/ui";
import type { ApiKey } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { hasPermission } from "../../lib/permissions.ts";
import { fmtDate, fmtRelative } from "../../lib/format.ts";
import { PermissionPicker, usePermissionGroups } from "./Roles.tsx";

function status(k: ApiKey): { label: string; variant: "success" | "neutral" | "destructive" } {
  if (k.revokedAt) return { label: "Revoked", variant: "neutral" };
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return { label: "Expired", variant: "destructive" };
  return { label: "Active", variant: "success" };
}

export function ApiKeysPage() {
  const { api, access, tenant } = useTenant();
  const keys = useTQuery<ApiKey[]>(["api-keys"], "/api-keys");
  const groups = usePermissionGroups();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: [] as string[], expiresAt: "" });
  const [token, setToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const create = useTMutation(
    () => api.post<{ id: string; token: string }>("/api-keys", { name: form.name.trim(), scopes: form.scopes, ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() } : {}) }),
    { invalidate: [["api-keys"]], onSuccess: (r) => { setCreating(false); setToken(r.token); setForm({ name: "", scopes: [], expiresAt: "" }); } },
  );
  const revoke = useTMutation((k: ApiKey) => api.del(`/api-keys/${k.id}`), { invalidate: [["api-keys"]], success: "Key revoked" });
  const sorted = [...(keys.data ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHeader title="API keys" description="Credentials for scripts and integrations. A key can never do more than the person who created it."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Create key</Button>} />
      <Card>
        {keys.isPending ? <div className="p-4"><Skeleton className="h-10" /></div>
          : keys.isError ? <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
          : !sorted.length ? <EmptyState icon={<KeyRound />} title="No API keys" description="Create one to call the Office API from your own systems." />
          : (
            <Table>
              <THead><TR><TH>Name</TH><TH>Status</TH><TH className="hidden md:table-cell">Scopes</TH><TH className="hidden sm:table-cell">Last used</TH><TH className="hidden lg:table-cell">Expires</TH><TH className="w-24" /></TR></THead>
              <TBody>
                {sorted.map((k) => {
                  const s = status(k);
                  return (
                    <TR key={k.id} className={k.revokedAt ? "opacity-60" : undefined}>
                      <TD className="font-medium">{k.name}</TD>
                      <TD><Badge variant={s.variant}>{s.label}</Badge></TD>
                      <TD className="hidden md:table-cell"><span title={k.scopes.join("\n")} className="text-muted-foreground">{k.scopes.length} scope{k.scopes.length === 1 ? "" : "s"}</span></TD>
                      <TD className="hidden sm:table-cell text-muted-foreground">{k.lastUsedAt ? fmtRelative(k.lastUsedAt) : "Never"}</TD>
                      <TD className="hidden lg:table-cell text-muted-foreground">{k.expiresAt ? fmtDate(k.expiresAt) : "Never"}</TD>
                      <TD className="text-right">{!k.revokedAt && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(k)}>Revoke</Button>}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent wide title="Create API key" description={`Send it as “Authorization: Bearer <key>”. It only works in ${tenant.name}.`}>
          <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>{(a) => <Input {...a} required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Accounting sync" />}</Field>
              <Field label="Expires" hint="Optional. Leave empty for no expiry.">{(a) => <Input {...a} type="date" min={new Date().toISOString().slice(0, 10)} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />}</Field>
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Scopes <span className="font-normal text-muted-foreground">— only permissions you hold can be granted</span></p>
              <PermissionPicker groups={groups} value={form.scopes} onChange={(scopes) => setForm({ ...form, scopes })} limitTo={(p) => hasPermission(access.permissions, p)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" loading={create.isPending} disabled={!form.name.trim() || !form.scopes.length}>Create key</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!token} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent title="Copy your API key" description="This is the only time it is shown. Store it in a secret manager.">
          {token && <CopyField value={token} label="Copy API key" />}
          <DialogFooter><Button onClick={() => setToken(null)}>I’ve stored it</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} destructive confirmLabel="Revoke key"
        title={`Revoke “${revoking?.name}”?`} description="Anything using this key stops working immediately. This can’t be undone."
        onConfirm={() => revoke.mutateAsync(revoking!)} />
    </>
  );
}

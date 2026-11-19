import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import { Plus } from "lucide-react";
import { del, errorMessage, get, post } from "../lib/api.ts";
import { can, useSession } from "../lib/session.tsx";
import type { ApiKey } from "../lib/types.ts";
import { ConfirmButton, QueryView, SecretReveal, fmtDate } from "../components/common.tsx";

export function ApiKeysPage() {
  const s = useSession();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["tenant", s.tenantId, "api-keys"], queryFn: () => get<ApiKey[]>("/api-keys") });
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="API keys" description="For integrations. A key can never do more than the person who created it."
        actions={<Button onClick={() => setOpen(true)}><Plus size={16} />New key</Button>} />
      <QueryView q={keys}>{(rows) => rows.length === 0 ? <EmptyState title="No API keys" /> : (
        <Card><Table>
          <THead><TR><TH>Name</TH><TH>Scopes</TH><TH className="hidden md:table-cell">Last used</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>{rows.map((k) => (
            <TR key={k.id}>
              <TD className="font-medium">{k.name}</TD>
              <TD><div className="flex max-w-xs flex-wrap gap-1">{k.scopes.map((x) => <Badge key={x}>{x}</Badge>)}</div></TD>
              <TD className="hidden md:table-cell text-muted">{fmtDate(k.lastUsedAt)}</TD>
              <TD>{k.revokedAt ? <Badge tone="danger">revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="warning">expired</Badge> : <Badge tone="success">active</Badge>}</TD>
              <TD className="text-right">{!k.revokedAt && <ConfirmButton label="Revoke" title="Revoke key?" body={`Integrations using “${k.name}” will stop working.`}
                onConfirm={async () => { await del(`/api-keys/${k.id}`); await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "api-keys"] }); }} />}</TD>
            </TR>))}
          </TBody>
        </Table></Card>
      )}</QueryView>
      {open && <NewKey onClose={() => setOpen(false)} />}
    </>
  );
}

function NewKey({ onClose }: { onClose(): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => get<{ core: string[] }>("/permissions") });
  const all = [...(perms.data?.core ?? []), ...s.modules.flatMap((m) => m.permissions.map((p) => p.key))].filter((p) => can(s.permissions, p));
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState("90");
  const m = useMutation({
    mutationFn: () => post<{ id: string; token: string }>("/api-keys", {
      name, scopes, ...(days ? { expiresAt: new Date(Date.now() + Number(days) * 86_400_000).toISOString() } : {}),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "api-keys"] }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New API key">
      {m.data ? (<><SecretReveal label="API key" value={m.data.token} /><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></>) : (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {m.error && <Alert>{errorMessage(m.error)}</Alert>}
          <Field label="Name">{(a) => <Input {...a} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zapier" />}</Field>
          <Field label="Expires in (days)" hint="Leave blank for no expiry (not recommended).">{(a) => <Input {...a} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
          <fieldset className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2">
            <legend className="px-1 text-sm font-medium">Scopes</legend>
            {all.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scopes.includes(p)} onChange={(e) => setScopes(e.target.checked ? [...scopes, p] : scopes.filter((x) => x !== p))} />{p}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!scopes.length || m.isPending}>Create</Button></div>
        </form>
      )}
    </Dialog>
  );
}

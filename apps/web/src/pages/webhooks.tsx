import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardContent, Dialog, EmptyState, Field, Input, PageHeader, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import { Plus, RotateCw } from "lucide-react";
import { del, errorMessage, get, post, put } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { Delivery, Webhook } from "../lib/types.ts";
import { ConfirmButton, QueryView, SecretReveal, fmtDate } from "../components/common.tsx";

export function WebhooksPage() {
  const s = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["tenant", s.tenantId, "webhooks"], queryFn: () => get<Webhook[]>("/webhooks") });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Webhook | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "webhooks"] });
  return (
    <>
      <PageHeader title="Webhooks" description="Send signed events to your other systems."
        actions={<Button onClick={() => setOpen(true)}><Plus size={16} />New webhook</Button>} />
      <QueryView q={list}>{(rows) => rows.length === 0 ? <EmptyState title="No webhooks" /> : (
        <Card><Table>
          <THead><TR><TH>URL</TH><TH>Events</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>{rows.map((w) => (
            <TR key={w.id}>
              <TD className="max-w-xs truncate"><button className="text-primary hover:underline" onClick={() => setView(w)}>{w.url}</button></TD>
              <TD><div className="flex flex-wrap gap-1">{w.events.map((e) => <Badge key={e}>{e}</Badge>)}</div></TD>
              <TD>{w.active ? <Badge tone="success">active</Badge> : <Badge tone="warning">paused</Badge>}{w.failureStreak > 0 && <span className="ml-2 text-xs text-danger">{w.failureStreak} failures</span>}</TD>
              <TD className="whitespace-nowrap text-right">
                <Button variant="ghost" size="sm" onClick={async () => { await put(`/webhooks/${w.id}`, { url: w.url, description: w.description, events: w.events, active: !w.active }); await refresh(); }}>{w.active ? "Pause" : "Resume"}</Button>
                <ConfirmButton label="Delete" title="Delete webhook?" body={w.url} onConfirm={async () => { await del(`/webhooks/${w.id}`); await refresh(); }} />
              </TD>
            </TR>))}
          </TBody>
        </Table></Card>
      )}</QueryView>
      {open && <NewWebhook onClose={() => setOpen(false)} onDone={refresh} />}
      {view && <Deliveries w={view} onClose={() => setView(null)} />}
    </>
  );
}

function NewWebhook({ onClose, onDone }: { onClose(): void; onDone(): Promise<unknown> }) {
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState("core.contact.*");
  const m = useMutation({
    mutationFn: () => post<Webhook & { secret: string }>("/webhooks", { url, events: events.split(/[\s,]+/).filter(Boolean) }),
    onSuccess: () => onDone(),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New webhook" description="We POST JSON with an Office-Signature header (HMAC-SHA256).">
      {m.data ? (<><SecretReveal label="signing secret" value={m.data.secret} /><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></>) : (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {m.error && <Alert>{errorMessage(m.error)}</Alert>}
          <Field label="URL" hint="Must be https and publicly reachable.">{(a) => <Input {...a} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
          <Field label="Events" hint="Comma separated. Exact type, module.entity.*, module.* or *.">{(a) => <Input {...a} required value={events} onChange={(e) => setEvents(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending}>Create</Button></div>
        </form>
      )}
    </Dialog>
  );
}

function Deliveries({ w, onClose }: { w: Webhook; onClose(): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tenant", s.tenantId, "webhooks", w.id, "deliveries"], queryFn: () => get<Delivery[]>(`/webhooks/${w.id}/deliveries?limit=25`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Recent deliveries" description={w.url}>
      <QueryView q={q}>{(rows) => rows.length === 0 ? <p className="text-sm text-muted">Nothing delivered yet.</p> : (
        <CardContent className="grid gap-2 p-0">
          {rows.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <Badge tone={d.status === "delivered" ? "success" : d.status === "failed" ? "danger" : "warning"}>{d.status}</Badge>
              <code className="text-xs">{d.eventType}</code>
              <span className="ml-auto text-xs text-muted" title={d.lastError ?? ""}>{d.attempts}× · {fmtDate(d.deliveredAt ?? d.createdAt)}</span>
              <Button variant="ghost" size="icon" aria-label="Redeliver" onClick={async () => {
                await post(`/webhooks/${w.id}/deliveries/${d.id}/redeliver`); await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "webhooks", w.id] });
              }}><RotateCw size={14} /></Button>
            </div>
          ))}
        </CardContent>
      )}</QueryView>
    </Dialog>
  );
}

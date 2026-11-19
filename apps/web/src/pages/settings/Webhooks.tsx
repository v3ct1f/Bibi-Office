import { useEffect, useState } from "react";
import { MoreHorizontal, Plus, RotateCw, Webhook as WebhookIcon } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, Switch, Table, TBody, TD, TH, THead, TR, Textarea,
} from "@office/ui";
import type { Catalog, Delivery, Webhook } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDateTime, fmtRelative } from "../../lib/format.ts";

const PATTERN = /^(\*|[a-z][a-z0-9-]*\.\*|[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.\*|[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/;
const DELIVERY: Record<Delivery["status"], "success" | "warning" | "destructive"> = { delivered: "success", pending: "warning", failed: "destructive" };

interface Form { url: string; description: string; events: string; active: boolean }
const empty: Form = { url: "https://", description: "", events: "", active: true };

function Deliveries({ hook }: { hook: Webhook }) {
  const { api } = useTenant();
  const list = useTQuery<Delivery[]>(["webhooks", hook.id, "deliveries"], `/webhooks/${hook.id}/deliveries`, { limit: 50 });
  const redeliver = useTMutation((d: Delivery) => api.post(`/webhooks/${hook.id}/deliveries/${d.id}/redeliver`), {
    invalidate: [["webhooks", hook.id, "deliveries"]], success: "Queued for redelivery",
  });
  if (list.isPending) return <Skeleton className="h-24" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data.length) return <EmptyState title="No deliveries yet" description="Deliveries appear here when a subscribed event happens." />;
  return (
    <div className="max-h-[60vh] overflow-y-auto rounded-md border">
      <Table>
        <THead><TR><TH>Event</TH><TH>Status</TH><TH className="hidden sm:table-cell">Attempts</TH><TH className="hidden sm:table-cell">When</TH><TH /></TR></THead>
        <TBody>
          {list.data.map((d) => (
            <TR key={d.id}>
              <TD><code className="font-mono text-xs">{d.eventType}</code>{d.lastError && <p className="mt-0.5 max-w-xs truncate text-xs text-destructive" title={d.lastError}>{d.lastError}</p>}</TD>
              <TD><Badge variant={DELIVERY[d.status]}>{d.status}{d.statusCode ? ` · ${d.statusCode}` : ""}</Badge></TD>
              <TD className="hidden sm:table-cell text-muted-foreground">{d.attempts}</TD>
              <TD className="hidden sm:table-cell text-muted-foreground" title={fmtDateTime(d.createdAt)}>{fmtRelative(d.createdAt)}</TD>
              <TD className="text-right">{d.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => redeliver.mutate(d)}><RotateCw /> Resend</Button>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export function WebhooksPage() {
  const { api, can } = useTenant();
  const hooks = useTQuery<Webhook[]>(["webhooks"], "/webhooks");
  const catalog = useTQuery<Catalog>(["workflow-catalog"], "/workflow-catalog", undefined, { enabled: can("core:workflows.read") });
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);
  useEffect(() => {
    if (editing === "new") setForm(empty);
    else if (editing) setForm({ url: editing.url, description: editing.description ?? "", events: editing.events.join("\n"), active: editing.active });
  }, [editing]);

  const events = form.events.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const badEvents = events.filter((e) => !PATTERN.test(e));
  const body = { url: form.url.trim(), description: form.description.trim() || null, events, active: form.active };
  const save = useTMutation(
    () => editing === "new" ? api.post<Webhook & { secret: string }>("/webhooks", body) : api.put<Webhook>(`/webhooks/${(editing as Webhook).id}`, body),
    { invalidate: [["webhooks"]], success: editing === "new" ? undefined : "Webhook saved", onSuccess: (r) => { setEditing(null); if ("secret" in r) setSecret(r.secret as string); } },
  );
  const toggle = useTMutation((h: Webhook) => api.put(`/webhooks/${h.id}`, { url: h.url, description: h.description, events: h.events, active: !h.active }), { invalidate: [["webhooks"]] });
  const del = useTMutation((h: Webhook) => api.del(`/webhooks/${h.id}`), { invalidate: [["webhooks"]], success: "Webhook deleted" });
  const suggestions = ["*", ...new Set((catalog.data?.events ?? []).map((e) => `${e.split(".")[0]}.*`))];

  return (
    <>
      <PageHeader title="Webhooks" description="Send signed HTTPS notifications to other systems when events happen."
        actions={<Button onClick={() => setEditing("new")}><Plus /> Add endpoint</Button>} />
      <Card>
        {hooks.isPending ? <div className="p-4"><Skeleton className="h-10" /></div>
          : hooks.isError ? <ErrorState error={hooks.error} onRetry={() => hooks.refetch()} />
          : !hooks.data.length ? <EmptyState icon={<WebhookIcon />} title="No endpoints" description="Add an endpoint to receive events like core.contact.created." />
          : (
            <Table>
              <THead><TR><TH>Endpoint</TH><TH className="hidden md:table-cell">Events</TH><TH>Active</TH><TH className="w-12" /></TR></THead>
              <TBody>
                {hooks.data.map((h) => (
                  <TR key={h.id}>
                    <TD className="max-w-xs">
                      <button className="block max-w-full cursor-pointer truncate text-left font-mono text-xs font-medium hover:underline" onClick={() => setViewing(h)}>{h.url}</button>
                      {h.description && <p className="truncate text-xs text-muted-foreground">{h.description}</p>}
                      {h.failureStreak > 0 && <Badge variant="warning" className="mt-1">{h.failureStreak} failures in a row</Badge>}
                    </TD>
                    <TD className="hidden md:table-cell"><div className="flex flex-wrap gap-1">{h.events.slice(0, 3).map((e) => <Badge key={e} variant="outline" className="font-mono">{e}</Badge>)}{h.events.length > 3 && <Badge variant="neutral">+{h.events.length - 3}</Badge>}</div></TD>
                    <TD><Switch aria-label={`${h.active ? "Pause" : "Activate"} ${h.url}`} checked={h.active} onCheckedChange={() => toggle.mutate(h)} /></TD>
                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${h.url}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setViewing(h)}>View deliveries</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(h)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => setDeleting(h)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === "new" ? "Add endpoint" : "Edit endpoint"} description="Requests are signed with Office-Signature (HMAC-SHA256). Private network addresses are blocked.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
            <Field label="URL" required>{(a) => <Input {...a} type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hooks/office" />}</Field>
            <Field label="Description">{(a) => <Input {...a} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
            <Field label="Events" required hint="One per line: an event type, “module.*”, “module.entity.*” or “*”."
              error={badEvents.length ? `Invalid: ${badEvents.join(", ")}` : undefined}>
              {(a) => <Textarea {...a} rows={4} className="font-mono text-xs" value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} placeholder={"core.contact.created\ninvoicing.*"} />}
            </Field>
            <div className="-mt-2 flex flex-wrap gap-1">
              {suggestions.filter((s) => !events.includes(s)).slice(0, 10).map((s) => (
                <button key={s} type="button" className="cursor-pointer rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent"
                  onClick={() => setForm({ ...form, events: [...events, s].join("\n") })}>+ {s}</button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-4 text-sm font-medium">Active<Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} /></label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={save.isPending} disabled={!events.length || badEvents.length > 0}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent title="Signing secret" description="Use it to verify the Office-Signature header. It is shown only once.">
          {secret && <CopyField value={secret} label="Copy signing secret" />}
          <DialogFooter><Button onClick={() => setSecret(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing && <DialogContent wide title="Recent deliveries" description={viewing.url}><Deliveries hook={viewing} /></DialogContent>}
      </Dialog>

      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive confirmLabel="Delete"
        title="Delete this endpoint?" description={deleting?.url} onConfirm={() => del.mutateAsync(deleting!)} />
    </>
  );
}

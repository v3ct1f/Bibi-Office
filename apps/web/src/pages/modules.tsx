import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardContent, Dialog, EmptyState, PageHeader, Switch } from "@office/ui";
import { Settings } from "lucide-react";
import { errorMessage, patch, post } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { ModuleInfo } from "../lib/types.ts";
import { SchemaForm, cleanPatch } from "../components/schema-form.tsx";

export function ModulesPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ModuleInfo | null>(null);
  const [err, setErr] = useState<string>();
  const manage = s.can("core:modules.manage");
  const toggle = useMutation({
    mutationFn: ({ key, on }: { key: string; on: boolean }) => post(`/modules/${key}/${on ? "enable" : "disable"}`),
    onMutate: () => setErr(undefined),
    onError: (e) => setErr(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tenant", s.tenantId] }),
  });
  return (
    <>
      <PageHeader title="Modules" description="Switch on the parts of Office your business needs. Data is kept when a module is switched off." />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {s.modules.length === 0 ? <EmptyState title="No modules installed">Modules are added by the platform operator.</EmptyState> : (
        <div className="grid gap-3 md:grid-cols-2">
          {s.modules.map((m) => (
            <Card key={m.key}>
              <CardContent className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{m.name} <span className="text-xs text-muted">v{m.version}</span></p>
                    <p className="text-sm text-muted">{m.description || "—"}</p>
                  </div>
                  <Switch label={`${m.enabled ? "Disable" : "Enable"} ${m.name}`} checked={m.enabled} disabled={!manage || toggle.isPending}
                    onCheckedChange={(on) => toggle.mutate({ key: m.key, on })} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.enabled ? "success" : "neutral"}>{m.enabled ? "Enabled" : "Off"}</Badge>
                  {m.dependsOn.map((d) => <Badge key={d}>needs {d}</Badge>)}
                  {manage && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(m)}><Settings size={14} />Settings</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && <SettingsDialog m={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SettingsDialog({ m, onClose }: { m: ModuleInfo; onClose(): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const save = useMutation({
    mutationFn: () => patch(`/modules/${m.key}/settings`, cleanPatch(draft)),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "modules"] }); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${m.name} settings`} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </>}>
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <SchemaForm schema={m.settingsSchema} values={m.settings} secretsSet={m.secretsSet} onChange={setDraft} />
    </Dialog>
  );
}

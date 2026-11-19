import { useEffect, useState } from "react";
import { ArrowRight, Blocks, Settings2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, ConfirmDialog, Dialog, DialogContent, DialogFooter,
  EmptyState, ErrorState, PageHeader, SchemaForm, Skeleton, Switch,
} from "@office/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { ModuleInfo } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";

const hasSettings = (m: ModuleInfo) => Object.keys((m.settingsSchema?.properties as object | undefined) ?? {}).length > 0;
/** A module may ship its own settings page (ui slot "nav.settings"); else we render its JSON Schema. */
const settingsRoute = (m: ModuleInfo) => m.ui.slots.find((s) => s.slot === "nav.settings" && s.route)?.route;
const mainRoute = (m: ModuleInfo) => m.ui.slots.find((s) => s.slot === "nav.main" && s.route);

export function ModulesPage() {
  const { api, can, tenant } = useTenant();
  const navigate = useNavigate();
  const go = (m: ModuleInfo, route: string) => void navigate({ to: `/t/${tenant.slug}/m/${m.key}${route}` });
  const qc = useQueryClient();
  const mods = useTQuery<ModuleInfo[]>(["modules"], "/modules");
  const manage = can("core:modules.manage");
  const [disabling, setDisabling] = useState<ModuleInfo | null>(null);
  const [configuring, setConfiguring] = useState<ModuleInfo | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => { if (configuring) setValues({ ...configuring.settings }); }, [configuring]);

  // Enabling changes nav, permissions and slots -> refresh the access summary too.
  const refreshAccess = () => qc.invalidateQueries({ queryKey: ["access", tenant.id] });
  const toggle = useTMutation((m: { key: string; on: boolean }) => api.post(`/modules/${m.key}/${m.on ? "enable" : "disable"}`), {
    invalidate: [["modules"], ["roles"]], success: (_r, v) => (v.on ? "App enabled" : "App disabled"), onSuccess: () => void refreshAccess(),
  });
  const save = useTMutation((m: ModuleInfo) => api.patch<ModuleInfo>(`/modules/${m.key}/settings`, values), {
    invalidate: [["modules"]], success: "Settings saved", onSuccess: () => setConfiguring(null),
  });
  const enabledKeys = new Set(mods.data?.filter((m) => m.enabled).map((m) => m.key));

  return (
    <>
      <PageHeader title="Apps & modules" description="Turn business apps on or off for this workspace. Disabling keeps all data." />
      {mods.isPending ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : mods.isError ? <Card><ErrorState error={mods.error} onRetry={() => mods.refetch()} /></Card>
        : !mods.data.length ? <Card><EmptyState icon={<Blocks />} title="No apps installed" description="This deployment doesn’t include any modules yet. Modules are added at build time by your administrator." /></Card>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {mods.data.map((m) => {
              const missing = m.dependsOn.filter((d) => !enabledKeys.has(d));
              return (
                <Card key={m.key} className="flex flex-col">
                  <CardHeader className="flex-row items-start justify-between gap-4">
                    <div className="grid gap-1">
                      <CardTitle className="flex items-center gap-2">{m.name}<Badge variant="outline" className="font-mono">v{m.version}</Badge></CardTitle>
                      <CardDescription>{m.description || "No description."}</CardDescription>
                    </div>
                    <Switch aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.name}`} checked={m.enabled}
                      disabled={!manage || toggle.isPending || (!m.enabled && missing.length > 0)}
                      onCheckedChange={(on) => (on ? toggle.mutate({ key: m.key, on }) : setDisabling(m))} />
                  </CardHeader>
                  <CardContent className="grid gap-2 text-xs text-muted-foreground">
                    {m.dependsOn.length > 0 && <p>Requires: {m.dependsOn.map((d) => <Badge key={d} variant={enabledKeys.has(d) ? "success" : "warning"} className="mr-1">{d}</Badge>)}</p>}
                    {m.requires.length > 0 && <p>Uses your data: {m.requires.map((r) => r.replace(/^core:/, "")).join(", ")}</p>}
                    {m.permissions.length > 0 && <p>Adds {m.permissions.length} permission{m.permissions.length === 1 ? "" : "s"} (granted to Admin on enable)</p>}
                  </CardContent>
                  {(hasSettings(m) || (m.enabled && mainRoute(m))) && (
                    <CardFooter className="mt-auto">
                      {hasSettings(m) && (settingsRoute(m)
                        ? <Button size="sm" variant="outline" disabled={!manage || !m.enabled} title={m.enabled ? undefined : "Turn the app on first"}
                            onClick={() => go(m, settingsRoute(m)!)}><Settings2 /> Settings</Button>
                        : <Button size="sm" variant="outline" disabled={!manage} onClick={() => setConfiguring(m)}><Settings2 /> Settings</Button>)}
                      {m.enabled && mainRoute(m) && (
                        <Button size="sm" variant="ghost" onClick={() => go(m, mainRoute(m)!.route!)}>Open {mainRoute(m)!.label ?? m.name} <ArrowRight /></Button>
                      )}
                      {m.secretsSet.length > 0 && <span className="text-xs text-muted-foreground">{m.secretsSet.length} secret{m.secretsSet.length === 1 ? "" : "s"} stored</span>}
                    </CardFooter>
                  )}
                </Card>
              );
            })}
          </div>
        )}

      <ConfirmDialog open={!!disabling} onOpenChange={(o) => !o && setDisabling(null)} destructive confirmLabel="Disable"
        title={`Disable ${disabling?.name}?`} description="Its pages, automations and API routes stop working for everyone. Data is kept and comes back when you re-enable it."
        onConfirm={() => toggle.mutateAsync({ key: disabling!.key, on: false })} />

      <Dialog open={!!configuring} onOpenChange={(o) => !o && setConfiguring(null)}>
        {configuring && (
          <DialogContent title={`${configuring.name} settings`} description="Secret values are encrypted and never shown again.">
            <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save.mutate(configuring); }}>
              <SchemaForm schema={configuring.settingsSchema} value={values} onChange={setValues} secretsSet={configuring.secretsSet} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfiguring(null)}>Cancel</Button>
                <Button type="submit" loading={save.isPending}>Save settings</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

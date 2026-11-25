import { useEffect, useState } from "react";
import { ArrowRight, Blocks, Check, Lock, Plus, Settings2 } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, ConfirmDialog, Dialog, DialogContent, DialogFooter,
  EmptyState, ErrorState, Field, Input, PageHeader, SchemaForm, Skeleton, cn,
} from "@office/ui";
import type { ModuleInfo } from "../api/types.ts";
import { useTMutation, useTQuery } from "../api/hooks.ts";
import { useTenant } from "../lib/tenant.tsx";
import { fmtDate } from "../lib/format.ts";
import { moduleIcon } from "../shell/icons.tsx";

/** Features every business has from the start: not added or removed on this page. */
export const BUILT_IN_FEATURES = ["workmail"];

export const CATEGORY_LABELS: Record<string, string> = {
  finance: "Money", sales: "Sales", team: "Team", operations: "Operations", other: "Other",
};
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", member: "Member", viewer: "Viewer" };

const hasSettings = (m: ModuleInfo) => Object.keys((m.settingsSchema?.properties as object | undefined) ?? {}).length > 0;
/** A module may ship its own settings page (ui slot "nav.settings"); else we render its JSON Schema. */
const settingsRoute = (m: ModuleInfo) => m.ui.slots.find((s) => s.slot === "nav.settings" && s.route)?.route;
const mainRoute = (m: ModuleInfo) => m.ui.slots.find((s) => s.slot === "nav.main" && s.route);

/** "Add features": every business turns on only what it needs. Nothing is on by default; removing keeps the data. */
export function FeaturesPage() {
  const { api, can, tenant } = useTenant();
  const navigate = useNavigate();
  const go = (m: ModuleInfo, route: string) => void navigate({ to: `/t/${tenant.slug}/m/${m.key}${route}` });
  const qc = useQueryClient();
  const mods = useTQuery<ModuleInfo[]>(["modules"], "/modules");
  const manage = can("core:modules.manage");
  const [removing, setRemoving] = useState<ModuleInfo | null>(null);
  const [configuring, setConfiguring] = useState<ModuleInfo | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => { if (configuring) setValues({ ...configuring.settings }); }, [configuring]);

  // Adding changes nav, permissions and slots -> refresh the access summary too.
  const refreshAccess = () => qc.invalidateQueries({ queryKey: ["access", tenant.id] });
  const toggle = useTMutation((m: { key: string; name: string; on: boolean }) => api.post(`/modules/${m.key}/${m.on ? "enable" : "disable"}`), {
    invalidate: [["modules"], ["roles"]], success: (_r, v) => (v.on ? `${v.name} added` : `${v.name} removed`), onSuccess: () => void refreshAccess(),
  });
  const save = useTMutation((m: ModuleInfo) => api.patch<ModuleInfo>(`/modules/${m.key}/settings`, values), {
    invalidate: [["modules"]], success: "Settings saved", onSuccess: () => setConfiguring(null),
  });
  // Built-in features (Work email) are always on and have their own place in the menu, so they are not listed here.
  const all = (mods.data ?? []).filter((m) => !BUILT_IN_FEATURES.includes(m.key));
  const enabledKeys = new Set(all.filter((m) => m.enabled).map((m) => m.key));
  const categories = [...new Set(all.map((m) => m.category))].sort((a, b) => Object.keys(CATEGORY_LABELS).indexOf(a) - Object.keys(CATEGORY_LABELS).indexOf(b));
  const nameOf = (key: string) => all.find((m) => m.key === key)?.name ?? key;

  return (
    <>
      <PageHeader title="Add features" description={manage
        ? "Turn on only what your business needs. Each feature adds its own pages; removing one hides them and keeps all of its data."
        : "Features your workspace can use. Only owners and admins can add or remove them."} />

      {mods.isPending ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        : mods.isError ? <Card><ErrorState error={mods.error} onRetry={() => mods.refetch()} /></Card>
        : !all.length ? <Card><EmptyState icon={<Blocks />} title="No features available" description="This installation doesn’t include any feature modules yet." /></Card>
        : (
          <div className="grid gap-8">
            {categories.map((c) => (
              <section key={c} aria-labelledby={`cat-${c}`} data-testid={`category-${c}`}>
                <h2 id={`cat-${c}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[c] ?? c}</h2>
                <div className="grid gap-3 md:grid-cols-2">
            {all.filter((m) => m.category === c).map((m) => {
              const Icon = moduleIcon(m.icon ?? undefined);
              const missing = m.dependsOn.filter((d) => !enabledKeys.has(d));
              return (
                <Card key={m.key} className="flex flex-col" data-testid={`feature-${m.key}`}>
                  <CardHeader className="flex-row items-start gap-3">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", m.enabled ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-5" />
                    </span>
                    <div className="grid min-w-0 flex-1 gap-1">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {m.name}
                        {m.enabled && <Badge variant="success"><Check className="size-3" /> Added</Badge>}
                        {!m.allowed && <Badge variant="neutral"><Lock className="size-3" /> Not included</Badge>}
                      </CardTitle>
                      <CardDescription>{m.description || "No description."}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-1.5 text-xs text-muted-foreground">
                    <p><Badge variant="outline" className="mr-1.5">{CATEGORY_LABELS[m.category] ?? m.category}</Badge>
                      Who can use it: {m.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</p>
                    {m.dependsOn.length > 0 && (
                      <p>Needs: {m.dependsOn.map((d) => <Badge key={d} variant={enabledKeys.has(d) ? "success" : "warning"} className="mr-1">{nameOf(d)}</Badge>)}</p>
                    )}
                    {!m.allowed && <p>Not part of your plan. <Link to={`/t/${tenant.slug}/settings/plan`} className="font-medium text-primary underline">{manage ? "See plans and upgrade" : "See the plans"}</Link></p>}
                    {m.enabled && m.enabledAt && <p>Added {fmtDate(m.enabledAt)}{m.enabledBy ? ` by ${m.enabledBy.name}` : ""}</p>}
                    {!m.enabled && m.disabledAt && <p>Removed {fmtDate(m.disabledAt)}{m.disabledBy ? ` by ${m.disabledBy.name}` : ""}. Its data is kept and comes back when you add it again.</p>}
                  </CardContent>
                  <CardFooter className="mt-auto flex-wrap gap-2">
                    {manage && m.allowed && (m.enabled
                      ? <Button size="sm" variant="outline" aria-label={`Remove ${m.name}`} disabled={toggle.isPending} onClick={() => setRemoving(m)}>Remove</Button>
                      : <Button size="sm" aria-label={`Add ${m.name}`} loading={toggle.isPending && toggle.variables?.key === m.key}
                          disabled={toggle.isPending || missing.length > 0} title={missing.length ? `Add ${missing.map(nameOf).join(", ")} first` : undefined}
                          onClick={() => toggle.mutate({ key: m.key, name: m.name, on: true })}><Plus /> Add</Button>)}
                    {m.enabled && mainRoute(m) && (
                      <Button size="sm" variant="ghost" onClick={() => go(m, mainRoute(m)!.route!)}>Open {mainRoute(m)!.label ?? m.name} <ArrowRight /></Button>
                    )}
                    {manage && hasSettings(m) && (settingsRoute(m)
                      ? m.enabled && <Button size="sm" variant="ghost" aria-label={`${m.name} settings`} onClick={() => go(m, settingsRoute(m)!)}><Settings2 /> Settings</Button>
                      : <Button size="sm" variant="ghost" aria-label={`${m.name} settings`} onClick={() => setConfiguring(m)}><Settings2 /> Settings</Button>)}
                  </CardFooter>
                </Card>
              );
            })}
                </div>
              </section>
            ))}
          </div>
        )}

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Remove"
        title={`Remove ${removing?.name}?`} description="Its pages, automations and API access stop for everyone in this workspace. Nothing is deleted: add it again any time and everything is back."
        onConfirm={() => toggle.mutateAsync({ key: removing!.key, name: removing!.name, on: false })} />

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

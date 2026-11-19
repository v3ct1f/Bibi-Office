import { Component, createContext, useContext, useMemo, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, PackageX } from "lucide-react";
import { EmptyState } from "@office/ui";
import { ModuleHostProvider, findPage, type ModuleHost, type ModuleUi, type SlotProps } from "@office/ui/module-ui";
import { httpClient } from "../api/client.ts";
import { useTenant } from "../lib/tenant.tsx";
import { MODULE_UIS } from "./registry.ts";

/** Injectable for tests; the app uses the build-time MODULE_UIS. */
export const ModuleUiRegistry = createContext<ModuleUi[]>(MODULE_UIS);

/** One module's crash never takes down the shell. */
class ModuleBoundary extends Component<{ module: string; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[module:${this.props.module}]`, error, info.componentStack); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-danger-soft p-3 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0" /> The “{this.props.module}” module failed to render.
      </div>
    );
  }
}

export function useModuleHost(moduleKey: string): ModuleHost {
  const { tenant, can } = useTenant();
  const navigate = useNavigate();
  return useMemo(() => {
    const href = (p: string) => `/t/${tenant.slug}/m/${moduleKey}${p.startsWith("/") ? p : `/${p}`}`;
    return {
      moduleKey, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, can,
      api: httpClient(`/m/${moduleKey}`, tenant.id), core: httpClient("", tenant.id),
      href, navigate: (p: string) => void navigate({ to: href(p) }),
    };
  }, [moduleKey, tenant, can, navigate]);
}

function Hosted({ module, children }: { module: string; children: ReactNode }) {
  const host = useModuleHost(module);
  return <ModuleBoundary module={module}><ModuleHostProvider host={host}>{children}</ModuleHostProvider></ModuleBoundary>;
}

export interface SlotEntry { module: string; moduleName: string; label: string; Component: ComponentType<SlotProps> | null }

/** Resolved entries for a component slot (entity tabs, widgets...). Component null = manifest names a component the bundle lacks. */
export function useSlotEntries(slot: string): SlotEntry[] {
  const { slots } = useTenant();
  const reg = useContext(ModuleUiRegistry);
  return slots(slot).map(({ module, moduleName, slot: s }) => ({
    module, moduleName, label: s.label ?? moduleName,
    Component: (s.component && reg.find((m) => m.key === module)?.components?.[s.component]) || null,
  }));
}

export function SlotComponent({ entry, props }: { entry: SlotEntry; props?: SlotProps }) {
  if (!entry.Component) return <p className="text-sm text-muted-foreground">UI for “{entry.moduleName}” is not bundled in this build.</p>;
  const C = entry.Component;
  return <Hosted module={entry.module}><C {...props} /></Hosted>;
}

/** Renders every component for a slot, e.g. dashboard widgets. */
export function SlotOutlet({ slot, props, wrap }: { slot: string; props?: SlotProps; wrap?: (node: ReactNode, e: SlotEntry) => ReactNode }) {
  const entries = useSlotEntries(slot).filter((e) => e.Component);
  return <>{entries.map((e) => <div key={`${e.module}:${e.label}`}>{wrap ? wrap(<SlotComponent entry={e} props={props ?? {}} />, e) : <SlotComponent entry={e} props={props ?? {}} />}</div>)}</>;
}

/** Full page owned by a module: /t/<slug>/m/<module>/<path>. */
export function ModulePage({ module, path }: { module: string; path: string }) {
  const { access } = useTenant();
  const reg = useContext(ModuleUiRegistry);
  const enabled = access.modules.find((m) => m.key === module);
  const ui = reg.find((m) => m.key === module);
  const page = ui ? findPage(ui, `/${path}`) : null;
  if (!enabled || !page) {
    return <EmptyState icon={<PackageX />} title="Page not found" description={!enabled ? "This module is not enabled for this workspace." : "This module has no page at this address."} />;
  }
  const { Component: P, params } = page;
  return <Hosted module={module}><P params={params} path={`/${path}`} /></Hosted>;
}

import { lazy, use, type ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
export type { PublicPageProps, SlotProps };

/**
 * Build-time UI registry for first-party modules (third-party: sandboxed iframes, v2).
 * Each module's UI is its own chunk, loaded the first time one of its pages or slots renders.
 * Each module session adds a line to MODULE_UI_LOADERS: x: () => import("@office/module-x/ui"),
 *   components: names referenced by manifest ui.slots[].component
 *   pages: module routes referenced by ui.slots[].route (served at /m/<key><route>, sub-paths go to the same page)
 */
export interface ModuleUi {
  components?: Record<string, ComponentType<SlotProps>>;
  pages?: Record<string, ComponentType<SlotProps>>;
  /** Signed-out pages served at /p/<tenantSlug>/<key><route> (e.g. a booking page). */
  publicPages?: Record<string, ComponentType<PublicPageProps>>;
}

export const MODULE_UI_LOADERS: Record<string, () => Promise<{ default: ModuleUi }>> = {
  invoicing: () => import("@office/module-invoicing/ui"),
  crm: () => import("@office/module-crm/ui"),
  expenses: () => import("@office/module-expenses/ui"),
  scheduling: () => import("@office/module-scheduling/ui"),
  support: () => import("@office/module-support/ui"),
  hr: () => import("@office/module-hr/ui"),
  inventory: () => import("@office/module-inventory/ui"),
  docs: () => import("@office/module-docs/ui"),
  ai: () => import("@office/module-ai/ui"),
  kpi: () => import("@office/module-kpi/ui"),
};

const loaded = new Map<string, Promise<ModuleUi | null>>();
/** Load (once) a module's UI chunk; null for modules without a UI. A failed load is retried next time. */
export function loadModuleUi(key: string): Promise<ModuleUi | null> {
  let p = loaded.get(key);
  if (!p) {
    const load = MODULE_UI_LOADERS[key];
    p = load ? load().then((m) => m.default, (e) => { loaded.delete(key); throw e; }) : Promise.resolve(null);
    loaded.set(key, p);
  }
  return p;
}
/** Suspends until the module's UI is loaded (wrap in <Suspense>). */
export const useModuleUi = (key: string) => use(loadModuleUi(key));

const Missing: ComponentType<SlotProps> = () => null;
const lazyCache = new Map<string, ComponentType<SlotProps>>();
/** A slot component that loads its module's chunk on first render (renders nothing if the name isn't exported). */
export function lazySlotComponent(module: string, name: string): ComponentType<SlotProps> {
  const k = `${module}:${name}`;
  let C = lazyCache.get(k);
  if (!C) {
    C = lazy(async () => ({ default: (await loadModuleUi(module))?.components?.[name] ?? Missing }));
    lazyCache.set(k, C);
  }
  return C;
}

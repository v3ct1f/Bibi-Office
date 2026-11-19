/**
 * Build-time registry of module UIs (v1: first-party only, bundled with the app).
 * A module session adds: import invoicing from "@office/module-invoicing/ui"; MODULE_UIS = [invoicing]
 * Manifests (server) decide WHERE things show (ui.slots); this registry supplies the components.
 */
import type { ModuleUi } from "@office/ui/module-ui";
import invoicing from "@office/module-invoicing/ui";

export const MODULE_UIS: ModuleUi[] = [invoicing];

export const moduleUi = (key: string, list: ModuleUi[] = MODULE_UIS) => list.find((m) => m.key === key);

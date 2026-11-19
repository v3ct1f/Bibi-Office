/**
 * Build-time registry of module UIs (v1: first-party only, bundled with the app).
 * A module session adds its import here: MODULE_UIS = [invoicing, crm, ...]
 * Manifests (server) decide WHERE things show (ui.slots); this registry supplies the components.
 */
import type { ModuleUi } from "@office/ui/module-ui";
import crm from "@office/module-crm/ui";
import invoicing from "@office/module-invoicing/ui";

export const MODULE_UIS: ModuleUi[] = [invoicing, crm];

export const moduleUi = (key: string, list: ModuleUi[] = MODULE_UIS) => list.find((m) => m.key === key);

// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds its import here and to MODULES.
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import invoicing from "@office/module-invoicing";
import crm from "@office/module-crm";

export const MODULES: ModuleDefinition[] = [invoicing, crm];
export const createRegistry = () => new ModuleRegistry(MODULES);

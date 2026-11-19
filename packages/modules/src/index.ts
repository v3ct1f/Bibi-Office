// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds its import here and to MODULES.
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import invoicing from "@office/module-invoicing";
import crm from "@office/module-crm";
import expenses from "@office/module-expenses";
import scheduling from "@office/module-scheduling";

export const MODULES: ModuleDefinition[] = [invoicing, crm, expenses, scheduling];
export const createRegistry = () => new ModuleRegistry(MODULES);

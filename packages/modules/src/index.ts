// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds its import here: MODULES = [invoicing, crm, ...]
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import crm from "@office/module-crm";
import expenses from "@office/module-expenses";
import scheduling from "@office/module-scheduling";
import invoicing from "@office/module-invoicing";

export const MODULES: ModuleDefinition[] = [invoicing, crm, expenses, scheduling];
export const createRegistry = () => new ModuleRegistry(MODULES);

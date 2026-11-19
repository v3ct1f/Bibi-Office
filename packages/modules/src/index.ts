// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds its import here and to MODULES.
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import invoicing from "@office/module-invoicing";
import crm from "@office/module-crm";
import expenses from "@office/module-expenses";
import scheduling from "@office/module-scheduling";
import support from "@office/module-support";
import hr from "@office/module-hr";
import inventory from "@office/module-inventory";
import docs from "@office/module-docs";
import ai from "@office/module-ai";
import kpi from "@office/module-kpi";

export const MODULES: ModuleDefinition[] = [invoicing, crm, expenses, scheduling, support, hr, inventory, docs, ai, kpi];
export const createRegistry = () => new ModuleRegistry(MODULES);

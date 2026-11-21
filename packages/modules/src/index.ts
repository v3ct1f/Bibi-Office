// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds its import here: MODULES = [invoicing, crm, ...]
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import crm from "@office/module-crm";
import expenses from "@office/module-expenses";
import inventory from "@office/module-inventory";
import scheduling from "@office/module-scheduling";
import support from "@office/module-support";
import hr from "@office/module-hr";
import ai from "@office/module-ai";
import kpi from "@office/module-kpi";
import docs from "@office/module-docs";
import invoicing from "@office/module-invoicing";

export const MODULES: ModuleDefinition[] = [invoicing, crm, expenses, scheduling, inventory, support, hr, docs, ai, kpi];
export const createRegistry = () => new ModuleRegistry(MODULES);

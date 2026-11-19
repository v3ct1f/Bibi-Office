// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds: import invoicing from "@office/module-invoicing"; ... MODULES = [invoicing]
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";
import invoicing from "@office/module-invoicing";

export const MODULES: ModuleDefinition[] = [invoicing];
export const createRegistry = () => new ModuleRegistry(MODULES);

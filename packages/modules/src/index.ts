// Build-time list of built-in modules, shared by api, worker and the installer.
// Each module session adds: import invoicing from "@office/module-invoicing"; ... MODULES = [invoicing]
import type { ModuleDefinition } from "@office/sdk";
import { ModuleRegistry } from "@office/platform";

export const MODULES: ModuleDefinition[] = [];
export const createRegistry = () => new ModuleRegistry(MODULES);

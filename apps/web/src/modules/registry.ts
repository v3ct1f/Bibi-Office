import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import invoicing from "@office/module-invoicing/ui";

export type { SlotProps };

/**
 * Build-time UI registry for first-party modules (third-party: sandboxed iframes, v2).
 * Each module session adds: import x from "@office/module-x/ui"; MODULE_UI.x = x;
 *   components: names referenced by manifest ui.slots[].component
 *   pages: module routes referenced by ui.slots[].route (served at /m/<key><route>, sub-paths go to the same page)
 */
export interface ModuleUi {
  components?: Record<string, ComponentType<SlotProps>>;
  pages?: Record<string, ComponentType<SlotProps>>;
}

export const MODULE_UI: Record<string, ModuleUi> = { invoicing };

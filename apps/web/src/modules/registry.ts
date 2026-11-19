import type { ComponentType } from "react";

/** Props every slot component receives. `entity` is set for entity.* slots. */
export interface SlotProps { tenantId: string; entity?: { type: string; id: string; data?: Record<string, unknown> } }

/**
 * Build-time UI registry for first-party modules (third-party: sandboxed iframes, v2).
 * Each module session adds: import invoicing from "@office/module-invoicing/ui"; MODULE_UI.invoicing = invoicing;
 *   components: names referenced by manifest ui.slots[].component
 *   pages: module routes referenced by ui.slots[].route (served at /m/<key><route>)
 */
export interface ModuleUi {
  components?: Record<string, ComponentType<SlotProps>>;
  pages?: Record<string, ComponentType<SlotProps>>;
}

export const MODULE_UI: Record<string, ModuleUi> = {};

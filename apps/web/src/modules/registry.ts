import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import invoicing from "@office/module-invoicing/ui";
import crm from "@office/module-crm/ui";
import expenses from "@office/module-expenses/ui";
import scheduling from "@office/module-scheduling/ui";
import support from "@office/module-support/ui";
import hr from "@office/module-hr/ui";
import inventory from "@office/module-inventory/ui";

export type { PublicPageProps, SlotProps };

/**
 * Build-time UI registry for first-party modules (third-party: sandboxed iframes, v2).
 * Each module session adds: import x from "@office/module-x/ui"; MODULE_UI.x = x;
 *   components: names referenced by manifest ui.slots[].component
 *   pages: module routes referenced by ui.slots[].route (served at /m/<key><route>, sub-paths go to the same page)
 */
export interface ModuleUi {
  components?: Record<string, ComponentType<SlotProps>>;
  pages?: Record<string, ComponentType<SlotProps>>;
  /** Signed-out pages served at /p/<tenantSlug>/<key><route> (e.g. a booking page). */
  publicPages?: Record<string, ComponentType<PublicPageProps>>;
}

export const MODULE_UI: Record<string, ModuleUi> = { invoicing, crm, expenses, scheduling, support, hr, inventory };

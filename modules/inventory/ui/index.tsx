// Inventory UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { InventoryPage } from "./pages.tsx";
import { LowStockWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/inventory": InventoryPage },
  components: { LowStockWidget },
};
export default ui;

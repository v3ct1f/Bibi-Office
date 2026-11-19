// Expenses UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { ExpensesPage } from "./pages.tsx";
import { ExpensesWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/expenses": ExpensesPage },
  components: { ExpensesWidget },
};
export default ui;

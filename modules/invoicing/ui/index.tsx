// Invoicing UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { InvoicesPage } from "./pages.tsx";
import { InvoicesTab, OutstandingWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/invoices": InvoicesPage },
  components: { InvoicesTab, OutstandingWidget },
};
export default ui;

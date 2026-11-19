// Invoicing UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { InvoicesPage } from "./pages.tsx";
import { ContactInvoicesTab, OutstandingWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/invoices": InvoicesPage },
  components: { ContactInvoicesTab, OutstandingWidget },
};
export default ui;

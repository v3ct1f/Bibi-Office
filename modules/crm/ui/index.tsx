// CRM UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { DealsPage } from "./pages.tsx";
import { ActivityTab, DealsTab, PipelineWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/deals": DealsPage },
  components: { DealsTab, ActivityTab, PipelineWidget },
};
export default ui;

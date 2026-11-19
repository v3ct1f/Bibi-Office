// KPI dashboard UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import { KpiPage } from "./pages.tsx";
import { KpiWidget } from "./widgets.tsx";

const ui: {
  pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>>; publicPages: Record<string, ComponentType<PublicPageProps>>;
} = { pages: { "/dashboards": KpiPage }, components: { KpiWidget }, publicPages: {} };
export default ui;

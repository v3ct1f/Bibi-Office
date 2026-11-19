// AI summaries UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import { SummariesPage } from "./pages.tsx";

const ui: {
  pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>>; publicPages: Record<string, ComponentType<PublicPageProps>>;
} = { pages: { "/summaries": SummariesPage }, components: {}, publicPages: {} };
export default ui;

// HR ("People") UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { SlotProps } from "@office/sdk/ui";
import { PeoplePage } from "./pages.tsx";
import { AwayWidget } from "./widgets.tsx";

const ui: { pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>> } = {
  pages: { "/people": PeoplePage },
  components: { AwayWidget },
};
export default ui;

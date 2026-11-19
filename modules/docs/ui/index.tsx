// Docs & e-sign UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import { DocsPage } from "./pages.tsx";
import { SignPage } from "./public.tsx";
import { SignaturesWidget } from "./widgets.tsx";

const ui: {
  pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>>; publicPages: Record<string, ComponentType<PublicPageProps>>;
} = {
  pages: { "/documents": DocsPage },
  components: { SignaturesWidget },
  publicPages: { "/sign": SignPage },
};
export default ui;

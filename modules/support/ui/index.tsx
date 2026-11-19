// Support UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import { InboxPage } from "./pages.tsx";
import { ContactPage } from "./public.tsx";
import { QueueWidget, TicketsTab } from "./widgets.tsx";

const ui: {
  pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>>;
  publicPages: Record<string, ComponentType<PublicPageProps>>;
} = {
  pages: { "/inbox": InboxPage },
  components: { TicketsTab, QueueWidget },
  publicPages: { "/contact": ContactPage },
};
export default ui;

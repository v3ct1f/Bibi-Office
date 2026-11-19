// Scheduling UI registered in apps/web/src/modules/registry.ts.
import type { ComponentType } from "react";
import type { PublicPageProps, SlotProps } from "@office/sdk/ui";
import { CalendarPage } from "./pages.tsx";
import { BookingPage } from "./public.tsx";
import { BookingsTab, TodayWidget } from "./widgets.tsx";

const ui: {
  pages: Record<string, ComponentType<SlotProps>>; components: Record<string, ComponentType<SlotProps>>;
  publicPages: Record<string, ComponentType<PublicPageProps>>;
} = {
  pages: { "/calendar": CalendarPage },
  components: { BookingsTab, TodayWidget },
  publicPages: { "/book": BookingPage },
};
export default ui;

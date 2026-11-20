import { defineModuleUi } from "@office/ui/module-ui";
import { MeetingsPage, TicketsPage, UsagePage } from "./List.tsx";
import { NewMeeting } from "./NewMeeting.tsx";
import { SummaryPage } from "./SummaryPage.tsx";
import { AiWidget, ContactSummariesTab, DealSummariesPanel, TicketAiPanel } from "./widgets.tsx";

export default defineModuleUi({
  key: "ai",
  pages: {
    "/ai": MeetingsPage,
    "/ai/tickets": TicketsPage,
    "/ai/usage": UsagePage,
    "/ai/new": NewMeeting,
    "/ai/:id": SummaryPage,
  },
  components: { AiWidget, ContactSummariesTab, DealSummariesPanel, TicketAiPanel },
});

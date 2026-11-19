import { defineModuleUi } from "@office/ui/module-ui";
import { Inbox, NewTicket } from "./Inbox.tsx";
import { SupportSettings } from "./SettingsPage.tsx";
import { TicketPage } from "./TicketPage.tsx";
import { SupportWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "support",
  pages: {
    "/support": Inbox,
    "/support/new": NewTicket,
    "/support/settings": SupportSettings,
    "/support/:id": TicketPage,
  },
  components: { SupportWidget },
});

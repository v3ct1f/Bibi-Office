import { defineModuleUi } from "@office/ui/module-ui";
import { InboxPage } from "./Inbox.tsx";

export default defineModuleUi({
  key: "mail",
  pages: { "/inbox": InboxPage },
});

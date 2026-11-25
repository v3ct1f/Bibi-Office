import { defineModuleUi } from "@office/ui/module-ui";
import { WorkEmailPage } from "./WorkEmailPage.tsx";

/** The price wording, shared with the app's Colleagues and Add features pages so every screen says the same. */
export { mailboxCostAfter, mailboxCostBefore, mailboxCostShort, type MailboxPrice } from "./shared.tsx";

export default defineModuleUi({
  key: "workmail",
  pages: { "/email": WorkEmailPage },
});

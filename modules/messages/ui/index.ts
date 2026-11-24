import { defineModuleUi } from "@office/ui/module-ui";
import { Chat } from "./Chat.tsx";

export default defineModuleUi({
  key: "messages",
  pages: {
    "/chat": Chat,
    "/chat/new": Chat,
    "/chat/:id": Chat,
  },
});

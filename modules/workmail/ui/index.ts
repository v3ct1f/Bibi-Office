import { defineModuleUi } from "@office/ui/module-ui";
import { WorkEmailPage } from "./WorkEmailPage.tsx";

export default defineModuleUi({
  key: "workmail",
  pages: { "/email": WorkEmailPage },
});

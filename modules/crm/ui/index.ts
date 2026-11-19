import { defineModuleUi } from "@office/ui/module-ui";
import { DealBoard } from "./DealBoard.tsx";
import { DealDetail } from "./DealDetail.tsx";
import { DealEditor } from "./DealEditor.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { CustomerDealsTab, PipelineWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "crm",
  pages: {
    "/deals": DealBoard,
    "/deals/new": DealEditor,
    "/deals/:id": DealDetail,
    "/deals/:id/edit": DealEditor,
    "/settings": SettingsPage,
  },
  components: { CustomerDealsTab, PipelineWidget },
});

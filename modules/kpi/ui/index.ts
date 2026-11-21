import { defineModuleUi } from "@office/ui/module-ui";
import { BoardPage } from "./Board.tsx";
import { KpiWidget, ManualListPage, ManualPage } from "./Manual.tsx";

export default defineModuleUi({
  key: "kpi",
  pages: { "/kpi": BoardPage, "/kpi/manual": ManualListPage, "/kpi/manual/:id": ManualPage },
  components: { KpiWidget },
});

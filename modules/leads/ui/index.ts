import { defineModuleUi } from "@office/ui/module-ui";
import { FormSettings } from "./FormSettings.tsx";
import { ImportLeads } from "./ImportLeads.tsx";
import { LeadDetail } from "./LeadDetail.tsx";
import { LeadEditor } from "./LeadEditor.tsx";
import { LeadList } from "./LeadList.tsx";
import { PublicForm } from "./PublicForm.tsx";
import { LeadsWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "leads",
  pages: {
    "/leads": LeadList,
    "/leads/new": LeadEditor,
    "/leads/import": ImportLeads,
    "/leads/:id": LeadDetail,
    "/leads/:id/edit": LeadEditor,
    "/form": FormSettings,
  },
  publicPages: { "/form/:token": PublicForm },
  components: { LeadsWidget },
});

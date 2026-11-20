import { defineModuleUi } from "@office/ui/module-ui";
import { ProfilePage } from "./ProfilePage.tsx";
import { Checklists, Directory, LeaveOverview, OrgChart } from "./Team.tsx";
import { PeopleWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "hr",
  pages: {
    "/people": Directory,
    "/people/org": OrgChart,
    "/people/leave": LeaveOverview,
    "/people/checklists": Checklists,
    "/people/:userId": ProfilePage,
  },
  components: { PeopleWidget },
});

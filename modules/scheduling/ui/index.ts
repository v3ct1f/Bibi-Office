import { defineModuleUi } from "@office/ui/module-ui";
import { Clock } from "./Clock.tsx";
import { Hours } from "./Hours.tsx";
import { Requests } from "./Requests.tsx";
import { Schedule } from "./Schedule.tsx";
import { ScheduleWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "scheduling",
  pages: {
    "/schedule": Schedule,
    "/clock": Clock,
    "/requests": Requests,
    "/hours": Hours,
  },
  components: { ScheduleWidget },
});

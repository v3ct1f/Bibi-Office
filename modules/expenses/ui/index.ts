import { defineModuleUi } from "@office/ui/module-ui";
import { ExpenseDetail } from "./ExpenseDetail.tsx";
import { ExpenseEditor } from "./ExpenseEditor.tsx";
import { ExpenseList } from "./ExpenseList.tsx";
import { ExpensesWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "expenses",
  pages: {
    "/expenses": ExpenseList,
    "/expenses/new": ExpenseEditor,
    "/expenses/:id": ExpenseDetail,
    "/expenses/:id/edit": ExpenseEditor,
  },
  components: { ExpensesWidget },
});

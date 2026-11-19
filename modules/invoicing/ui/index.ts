import { defineModuleUi } from "@office/ui/module-ui";
import { InvoiceDetail } from "./InvoiceDetail.tsx";
import { InvoiceEditor } from "./InvoiceEditor.tsx";
import { InvoiceList } from "./InvoiceList.tsx";
import { CustomerInvoicesTab, OutstandingWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "invoicing",
  pages: {
    "/invoices": InvoiceList,
    "/invoices/new": InvoiceEditor,
    "/invoices/:id": InvoiceDetail,
    "/invoices/:id/edit": InvoiceEditor,
  },
  components: { CustomerInvoicesTab, OutstandingWidget },
});

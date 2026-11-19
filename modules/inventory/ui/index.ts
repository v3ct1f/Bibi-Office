import { defineModuleUi } from "@office/ui/module-ui";
import { History } from "./History.tsx";
import { ItemDetail } from "./ItemDetail.tsx";
import { ItemEditor } from "./ItemEditor.tsx";
import { Items } from "./Items.tsx";
import { OrderDetail } from "./OrderDetail.tsx";
import { NewOrder, Orders } from "./Orders.tsx";
import { LowStockWidget } from "./widgets.tsx";

export default defineModuleUi({
  key: "inventory",
  pages: {
    "/inventory": Items,
    "/inventory/new": ItemEditor,
    "/inventory/history": History,
    "/inventory/:id": ItemDetail,
    "/inventory/:id/edit": ItemEditor,
    "/purchase-orders": Orders,
    "/purchase-orders/new": NewOrder,
    "/purchase-orders/:id": OrderDetail,
  },
  components: { LowStockWidget },
});

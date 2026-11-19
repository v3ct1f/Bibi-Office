import {
  Blocks, BookOpen, Boxes, Building2, Calendar, CalendarClock, Clock, Wallet, ChartBar, CircleDollarSign, Contact, FileText, Folder, Inbox, LayoutDashboard,
  Handshake, ListTodo, Mail, Notebook, Package, Receipt, ShoppingCart, Sparkles, Users, Workflow, type LucideIcon,
} from "lucide-react";

/** Icon names module manifests may use in ui.slots[].icon. Unknown names fall back to a generic block. */
const ICONS: Record<string, LucideIcon> = {
  receipt: Receipt, invoice: Receipt, users: Users, contact: Contact, building: Building2, calendar: Calendar,
  chart: ChartBar, dashboard: LayoutDashboard, money: CircleDollarSign, file: FileText, folder: Folder, inbox: Inbox,
  tasks: ListTodo, mail: Mail, notebook: Notebook, package: Package, cart: ShoppingCart, sparkles: Sparkles,
  workflow: Workflow, book: BookOpen, handshake: Handshake, deals: Handshake,
  wallet: Wallet, clock: Clock, "calendar-clock": CalendarClock, boxes: Boxes,
};
export const moduleIcon = (name?: string): LucideIcon => (name && ICONS[name]) || Blocks;

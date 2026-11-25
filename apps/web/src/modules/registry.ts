/**
 * Build-time registry of module UIs (v1: first-party only, bundled with the app).
 * A module session adds its import here: MODULE_UIS = [invoicing, crm, ...]
 * Manifests (server) decide WHERE things show (ui.slots); this registry supplies the components.
 */
import type { ModuleUi } from "@office/ui/module-ui";
import crm from "@office/module-crm/ui";
import expenses from "@office/module-expenses/ui";
import inventory from "@office/module-inventory/ui";
import support from "@office/module-support/ui";
import hr from "@office/module-hr/ui";
import ai from "@office/module-ai/ui";
import kpi from "@office/module-kpi/ui";
import leads from "@office/module-leads/ui";
import messages from "@office/module-messages/ui";
import workmail from "@office/module-workmail/ui";
import mail from "@office/module-mail/ui";
import docs from "@office/module-docs/ui";
import scheduling from "@office/module-scheduling/ui";
import invoicing from "@office/module-invoicing/ui";

export const MODULE_UIS: ModuleUi[] = [invoicing, crm, expenses, scheduling, inventory, support, hr, docs, ai, kpi, leads, messages, workmail, mail];

export const moduleUi = (key: string, list: ModuleUi[] = MODULE_UIS) => list.find((m) => m.key === key);

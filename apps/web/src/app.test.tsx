import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { can } from "./lib/session.tsx";
import { moduleNav, resolveSlots } from "./modules/slot.tsx";
import { SchemaForm, cleanPatch } from "./components/schema-form.tsx";
import type { ModuleInfo } from "./lib/types.ts";

const mod = (over: Partial<ModuleInfo>): ModuleInfo => ({
  key: "crm", name: "CRM", version: "1.0.0", description: "", dependsOn: [], enabled: true, settings: {}, secretsSet: [],
  permissions: [], settingsSchema: {}, ui: { slots: [] }, ...over,
});
const Tab = () => <p>tab</p>;

describe("permissions", () => {
  it("matches API rules", () => {
    expect(can(new Set(["*"]), "core:x.read")).toBe(true);
    expect(can(new Set(["crm:*"]), "crm:deal.write")).toBe(true);
    expect(can(new Set(["crm:*"]), "invoicing:x")).toBe(false);
    expect(can(new Set(["core:contacts.read"]), "core:contacts.write")).toBe(false);
  });
});

describe("module UI slots", () => {
  const registry = { crm: { components: { DealsTab: Tab } } };
  const slots = [
    { slot: "entity.tab:contact", label: "Deals", component: "DealsTab", permission: "crm:deal.read" },
    { slot: "entity.tab:contact", label: "Ghost", component: "Missing" },
    { slot: "nav.main", label: "Deals", route: "/deals", permission: "crm:deal.read" },
  ];
  it("shows only enabled modules, permitted slots and registered components", () => {
    expect(resolveSlots("entity.tab:contact", [mod({ ui: { slots } })], new Set(["crm:deal.read"]), registry)).toHaveLength(1);
    expect(resolveSlots("entity.tab:contact", [mod({ ui: { slots } })], new Set([]), registry)).toHaveLength(0);
    expect(resolveSlots("entity.tab:contact", [mod({ enabled: false, ui: { slots } })], new Set(["*"]), registry)).toHaveLength(0);
  });
  it("builds module nav under /m/<key>", () => {
    expect(moduleNav([mod({ ui: { slots } })], new Set(["*"]))).toEqual([{ module: "crm", label: "Deals", to: "/m/crm/deals" }]);
  });
});

describe("SchemaForm", () => {
  it("renders typed fields and keeps secrets write-only", () => {
    const onChange = vi.fn();
    render(<SchemaForm
      schema={{ type: "object", properties: { currency: { type: "string", enum: ["EUR", "USD"] }, days: { type: "integer", title: "Payment days" }, apiKey: { type: "string", "x-secret": true } }, required: ["days"] }}
      values={{ currency: "EUR", days: 30 }} secretsSet={["apiKey"]} onChange={onChange} />);
    expect(screen.getByText("Stored. Leave blank to keep.")).toBeInTheDocument();
    expect((screen.getByLabelText("apiKey") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Payment days *"), { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith({ days: 45 });
    fireEvent.change(screen.getByLabelText("currency"), { target: { value: "USD" } });
    expect(cleanPatch(onChange.mock.lastCall![0])).toEqual({ days: 45, currency: "USD" });
  });
});

describe("module page routing", () => {
  it("matches the longest page route and passes the rest as subPath", async () => {
    const { matchPage } = await import("./pages/module-page.tsx");
    const pages = { "/invoices": 1, "/invoices/settings": 2 };
    expect(matchPage(pages, "/invoices")).toEqual({ route: "/invoices", subPath: "" });
    expect(matchPage(pages, "/invoices/0190-a/edit")).toEqual({ route: "/invoices", subPath: "/0190-a/edit" });
    expect(matchPage(pages, "/invoices/settings")).toEqual({ route: "/invoices/settings", subPath: "" });
    expect(matchPage(pages, "/invoicesx")).toBeNull();
  });
});

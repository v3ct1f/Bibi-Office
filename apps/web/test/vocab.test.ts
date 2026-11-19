import { describe, expect, it } from "vitest";
import { eventFields, eventGroup, eventLabel, fieldLabel, RECIPES, recipesFor } from "../src/pages/workflows/vocab.ts";

describe("workflow vocabulary", () => {
  it("names triggers in plain language, with a fallback for unknown events", () => {
    expect(eventLabel("core.contact.created")).toBe("A contact is added");
    expect(eventLabel("core.task.updated")).toBe("A task is changed");
    expect(eventLabel("invoicing.invoice.overdue")).toBe("An invoice becomes overdue");
    expect(eventLabel("shop.order.placed")).toBe("Order placed");
    expect(eventGroup("core.company.deleted")).toBe("Companies");
    expect(eventGroup("core.member.added")).toBe("Workspace");
    expect(eventGroup("invoicing.payment.recorded")).toBe("Invoicing");
  });

  it("lists the details each trigger carries", () => {
    expect(eventFields("core.contact.created").map((f) => f.path)).toContain("payload.email");
    expect(eventFields("core.contact.updated").map((f) => f.path)).toContain("payload.changes.email");
    expect(eventFields("invoicing.invoice.overdue").map((f) => f.path)).toContain("payload.daysOverdue");
    expect(eventFields("shop.order.placed")).toEqual([]);
    expect(fieldLabel("core.contact.created", "payload.email")).toBe("Email");
    expect(fieldLabel("shop.order.placed", "payload.amount")).toBe("payload.amount");
  });

  it("offers only recipes whose trigger exists, and each builds a valid draft", () => {
    expect(recipesFor(["core.contact.created", "core.member.added"]).map((r) => r.id)).toEqual(["follow-up-contact", "onboard-member"]);
    for (const r of RECIPES) {
      const w = r.build();
      expect(w.trigger.event).toBe(r.event);
      expect(w.name).toBeTruthy();
      expect(w.actions.length).toBeGreaterThan(0);
    }
  });
});

describe("CRM vocabulary", () => {
  it("names deal events and their details", () => {
    expect(eventLabel("crm.deal.won")).toBe("A deal is won");
    expect(eventGroup("crm.deal.won")).toBe("Deals (CRM)");
    expect(eventFields("crm.deal.lost").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.title", "payload.lostReason", "payload.id"]));
    expect(eventFields("crm.activity.logged").map((f) => f.path)).toContain("payload.dealId");
  });
  it("hides recipes whose actions are missing", () => {
    expect(recipesFor(["core.company.created"], ["core.create_task"])).toEqual([]);
    expect(recipesFor(["core.company.created"], ["crm.create_deal"]).map((r) => r.id)).toEqual(["deal-for-company"]);
  });
});

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

describe("Expenses vocabulary", () => {
  it("names expense events and their details", () => {
    expect(eventLabel("expenses.expense.submitted")).toBe("An expense is submitted for approval");
    expect(eventGroup("expenses.expense.paid")).toBe("Expenses");
    expect(eventFields("expenses.expense.rejected").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.vendor", "payload.comment", "payload.id"]));
    expect(eventFields("expenses.expense.paid").map((f) => f.path)).not.toContain("payload.comment");
  });
});

describe("Scheduling vocabulary", () => {
  it("names scheduling events and their details", () => {
    expect(eventLabel("scheduling.time_off.requested")).toBe("Someone asks for time off");
    expect(eventGroup("scheduling.clock.in")).toBe("Schedule & time clock");
    expect(eventFields("scheduling.time_off.rejected").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.startDate", "payload.comment"]));
    expect(eventFields("scheduling.clock.out").map((f) => f.path)).toContain("payload.minutes");
  });
});

describe("Inventory vocabulary", () => {
  it("names HR events and their details", () => {
    expect(eventLabel("hr.document.expiring")).toBe("An employee document is about to expire");
    expect(eventGroup("hr.checklist.completed")).toBe("HR");
    expect(eventFields("hr.document.expiring").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.personName", "payload.expiresOn"]));
    expect(eventLabel("docs.request.completed")).toBe("A document is signed by everyone");
    expect(eventGroup("docs.request.declined")).toBe("Docs & e-sign");
    expect(eventFields("docs.request.declined").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.signerName", "payload.reason"]));
    expect(eventLabel("scheduling.time_off.cancelled")).toBe("Time off is cancelled");
  });
  it("names support events and their details", () => {
    expect(eventLabel("support.ticket.created")).toBe("A support ticket comes in");
    expect(eventGroup("support.ticket.customer_replied")).toBe("Support");
    expect(eventFields("support.ticket.created").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.subject", "payload.requesterEmail"]));
  });
  it("names inventory events and their details", () => {
    expect(eventLabel("inventory.stock.low")).toBe("An item drops to its minimum stock");
    expect(eventGroup("inventory.order.sent")).toBe("Inventory");
    expect(eventFields("inventory.stock.low").map((f) => f.path)).toEqual(expect.arrayContaining(["payload.name", "payload.minStock"]));
  });
});

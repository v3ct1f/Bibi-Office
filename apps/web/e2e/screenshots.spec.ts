import { test } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Docs only: SCREENSHOTS_DIR=/path pnpm e2e  (runs after the admin flow has created data)
const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "set SCREENSHOTS_DIR to capture screenshots");
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

test("capture", async ({ page }) => {
  await signIn(page);
  for (const [path, name, theme] of [
    ["/contacts", "contacts-light", "light"], ["/admin/workflows", "workflows-list-light", "light"],
    ["/admin/audit", "audit-dark", "dark"], ["/admin/roles", "roles-dark", "dark"],
    ["/m/invoicing/invoices", "invoices-light", "light"], ["/", "dashboard-dark", "dark"],
    ["/m/crm/deals", "deals-board-light", "light"], ["/companies", "companies-dark", "dark"],
  ] as const) {
    await page.addInitScript((t) => localStorage.setItem("office.theme", t), theme);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  await page.goto("/admin/workflows");
  await page.getByRole("link", { name: "Follow up new contacts" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/workflow-editor-dark.png`, fullPage: true });
  await page.addInitScript(() => localStorage.setItem("office.theme", "light"));
  await page.goto("/m/invoicing/invoices");
  await page.getByRole("link", { name: /^INV-/ }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/invoice-detail-light.png`, fullPage: true });
  await page.goto("/m/invoicing/invoices/new");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/invoice-new-light.png`, fullPage: true });
  await page.goto("/m/crm/deals");
  await page.getByRole("tab", { name: "List" }).click();
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("cell", { name: "Catering contract" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/deal-detail-light.png`, fullPage: true });
  await page.goto("/companies");
  await page.getByRole("link", { name: "Globex Corp" }).click();
  await page.getByRole("tab", { name: "Activity" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/company-activity-light.png`, fullPage: true });

  // Expenses: a realistic receipt (rendered here), detail, queue, dialog
  const r = await page.context().newPage();
  await r.setViewportSize({ width: 360, height: 480 });
  await r.setContent(`<body style="margin:0;font:14px/1.5 ui-monospace,monospace;background:#fff;color:#222;padding:24px">
    <div style="text-align:center;font-weight:700;font-size:18px">HARBOR HOTEL</div><div style="text-align:center">12 Quay Street · Portside</div>
    <hr style="border:0;border-top:1px dashed #999;margin:12px 0"><div>Date: 2026-11-12 &nbsp; Room 214</div><div>Guest: Alice</div>
    <hr style="border:0;border-top:1px dashed #999;margin:12px 0">
    <div style="display:flex;justify-content:space-between"><span>1 night, double</span><span>118.00</span></div>
    <div style="display:flex;justify-content:space-between"><span>Breakfast</span><span>14.00</span></div>
    <div style="display:flex;justify-content:space-between"><span>City tax</span><span>3.00</span></div>
    <hr style="border:0;border-top:1px dashed #999;margin:12px 0">
    <div style="display:flex;justify-content:space-between;font-weight:700"><span>TOTAL EUR</span><span>135.00</span></div>
    <div style="display:flex;justify-content:space-between"><span>incl. VAT 7%</span><span>8.83</span></div>
    <p style="text-align:center;margin-top:24px">Paid by card ****4421<br>Thank you for staying with us</p></body>`);
  const receipt = await r.screenshot();
  await r.close();
  await page.goto("/m/expenses/expenses");
  await page.getByRole("button", { name: "New expense" }).click();
  const dlg = page.getByRole("dialog", { name: "New expense" });
  await dlg.getByLabel("Date").fill("2026-11-12");
  await dlg.getByLabel("Merchant").fill("Harbor Hotel (client visit)");
  await dlg.getByLabel("Category").selectOption({ label: "Lodging" });
  await dlg.getByLabel("Amount").fill("135.00");
  await dlg.getByLabel("Of which tax").fill("8.83");
  await dlg.getByLabel("Description (optional)").fill("Overnight for the Globex catering tasting.");
  await dlg.getByLabel("Receipt").setInputFiles({ name: "harbor-hotel.png", mimeType: "image/png", buffer: receipt });
  await page.screenshot({ path: `${dir}/expense-new-light.png` });
  await dlg.getByRole("button", { name: "Save and submit" }).click();
  await page.getByRole("img", { name: /^Receipt from/ }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/expense-detail-light.png`, fullPage: true });
  await page.goto("/m/expenses/expenses");
  await page.getByRole("tab", { name: "All" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/expenses-all-light.png` });
  await page.addInitScript(() => localStorage.setItem("office.theme", "dark"));
  await signIn(page, "bob");
  await page.goto("/m/expenses/expenses");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/expenses-mine-dark.png` });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/dashboard-member-dark.png`, fullPage: true });

  // Scheduling: team calendar (alice), public booking page (signed out, phone size)
  await page.addInitScript(() => localStorage.setItem("office.theme", "light"));
  await signIn(page);
  await page.goto("/m/scheduling/calendar");
  await page.getByRole("region").first().waitFor();
  if (!(await page.getByRole("button", { name: /Ada/ }).isVisible())) await page.getByRole("button", { name: "Next week" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/calendar-agenda-light.png`, fullPage: true });
  await page.getByRole("tab", { name: "My hours" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/calendar-hours-light.png` });
  await page.getByRole("tab", { name: "Services" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/calendar-services-light.png` });
  const pub = await page.context().browser()!.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await pub.goto("/p/acme-bakery/scheduling/book");
  await pub.getByRole("link", { name: /Cake tasting/ }).waitFor();
  await pub.screenshot({ path: `${dir}/booking-public-services-mobile.png` });
  await pub.getByRole("link", { name: /Cake tasting/ }).click();
  await pub.getByRole("button", { name: /^\d{2}:\d{2}/ }).first().waitFor();
  await pub.screenshot({ path: `${dir}/booking-public-times-mobile.png`, fullPage: true });
  await pub.getByRole("button", { name: /^\d{2}:\d{2}/ }).nth(3).click();
  await pub.getByLabel("Your name").fill("Katherine Johnson");
  await pub.getByLabel("Email").fill("katherine@example.com");
  await pub.screenshot({ path: `${dir}/booking-public-form-mobile.png`, fullPage: true });
  await pub.getByRole("button", { name: "Confirm booking" }).click();
  await pub.getByRole("heading", { name: "You're booked" }).waitFor();
  await pub.screenshot({ path: `${dir}/booking-public-confirmed-mobile.png`, fullPage: true });
  await pub.close();

  // Support inbox (alice): list, ticket, and the public contact form on a phone
  await page.goto("/m/support/inbox");
  await page.getByRole("list", { name: "Tickets" }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/support-inbox-light.png` });
  await page.getByRole("link", { name: /Wedding cake order/ }).click();
  await page.getByRole("list", { name: "Conversation" }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/support-ticket-light.png`, fullPage: true });
  await page.goto("/m/support/inbox");
  await page.getByRole("button", { name: "Inbox address" }).click();
  await page.getByLabel("Inbox email address").waitFor();
  await page.screenshot({ path: `${dir}/support-setup-light.png` });
  const form = await page.context().browser()!.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await form.goto("/p/acme-bakery/support/contact");
  await form.getByLabel("Your name").fill("Katherine Johnson");
  await form.getByLabel("Email").fill("katherine@example.com");
  await form.getByLabel("Subject").fill("Order pickup time");
  await form.getByLabel("Message").fill("Can I pick up my order at 7 am?");
  await form.screenshot({ path: `${dir}/support-contact-mobile.png`, fullPage: true });
  await form.close();

  // People (alice): directory, profile, approvals; bob's time off
  await page.goto("/m/hr/people");
  await page.getByRole("tab", { name: "Directory" }).click();
  await page.getByRole("list", { name: "People" }).waitFor();
  await page.screenshot({ path: `${dir}/people-directory-light.png` });
  await page.getByRole("link", { name: /Bob Baker/ }).click();
  await page.getByRole("list", { name: "Documents" }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/people-profile-light.png`, fullPage: true });
  await page.goto("/m/hr/people");
  await page.getByRole("tab", { name: "Who's away" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("list", { name: "Away" }).waitFor();
  await page.screenshot({ path: `${dir}/people-away-light.png` });
  await page.getByRole("tab", { name: "Setup" }).click();
  await page.getByRole("list", { name: "Leave types" }).waitFor();
  await page.screenshot({ path: `${dir}/people-setup-light.png` });
  const bob = await page.context().browser()!.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await signIn(bob, "bob");
  await bob.goto("/m/hr/people");
  await bob.getByRole("tab", { name: "My time off" }).click();
  await bob.getByRole("list", { name: "Time off requests" }).waitFor();
  await bob.screenshot({ path: `${dir}/people-timeoff-mobile.png`, fullPage: true });
  await bob.close();

  // Inventory (alice): items, item page, reorder; count sheet
  await page.goto("/m/inventory/inventory");
  await page.getByRole("tab", { name: "Items" }).click();
  await page.getByRole("table", { name: "Items" }).waitFor();
  await page.screenshot({ path: `${dir}/inventory-items-light.png` });
  await page.getByRole("table", { name: "Items" }).getByText("Flour 25kg").click();
  await page.getByRole("table", { name: "Movements" }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/inventory-item-light.png`, fullPage: true });
  await page.goto("/m/inventory/inventory");
  await page.getByRole("tab", { name: "Reorder" }).click();
  await page.getByRole("table", { name: "Reorder list" }).waitFor();
  await page.screenshot({ path: `${dir}/inventory-reorder-light.png` });
  await page.getByRole("tab", { name: "Items" }).click();
  await page.getByRole("button", { name: "Stock count" }).click();
  await page.getByRole("table", { name: "Count sheet" }).waitFor();
  await page.screenshot({ path: `${dir}/inventory-count-light.png` });
});

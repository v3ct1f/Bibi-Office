import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after sales.spec.ts (alice owns "Acme Bakery"; bob has signed in once and has no organization).
test.describe.configure({ mode: "serial" });

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("expenses: enable and add a member", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Expenses" }).click();
  await expect(page.getByRole("switch", { name: "Disable Expenses" })).toBeChecked();
  await page.goto("/admin/members");
  await page.getByRole("button", { name: "Add member" }).click();
  const dlg = page.getByRole("dialog", { name: "Add member" });
  await dlg.getByLabel("Email").fill("bob@example.com");
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText("bob@example.com")).toBeVisible();
});

test("expenses: member submits with a receipt; a second one is held for a receipt", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await nav(page).getByRole("link", { name: "Expenses" }).click();
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);   // members only see their own list
  await page.getByRole("button", { name: "New expense" }).click();
  let dlg = page.getByRole("dialog", { name: "New expense" });
  await dlg.getByLabel("Merchant").fill("Rail Co");
  await dlg.getByLabel("Category").selectOption({ label: "Travel" });
  await dlg.getByLabel("Amount").fill("42.00");
  await dlg.getByLabel("Of which tax").fill("7");
  await dlg.getByLabel("Receipt").setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: PNG });
  await dlg.getByRole("button", { name: "Save and submit" }).click();
  await expect(page.getByRole("heading", { name: "Rail Co" })).toBeVisible();
  await expect(page.getByText("Awaiting approval")).toBeVisible();
  await expect(page.getByRole("img", { name: "Receipt from Rail Co" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.getByRole("link", { name: "← Expenses" }).click();
  await page.getByRole("button", { name: "New expense" }).click();
  dlg = page.getByRole("dialog", { name: "New expense" });
  await dlg.getByLabel("Merchant").fill("Harbor Hotel");
  await dlg.getByLabel("Category").selectOption({ label: "Lodging" });
  await dlg.getByLabel("Amount").fill("80");
  await dlg.getByRole("button", { name: "Save and submit" }).click();
  await expect(page.getByRole("heading", { name: "Harbor Hotel" })).toBeVisible();
  await expect(page.getByText(/Saved as a draft, not submitted yet: Attach a receipt/)).toBeVisible();
  await page.getByLabel("Receipt file").setInputFiles({ name: "folio.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(page.getByRole("link", { name: "Open folio.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting approval")).toBeVisible();
});

test("expenses: approver approves one, sends one back; finance reimburses and exports", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/expenses/expenses");
  await page.getByRole("tab", { name: "To approve" }).click();
  await page.getByRole("link", { name: "Rail Co" }).click();
  await expect(page.getByText("bob", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Mark reimbursed" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Approved" })).toBeVisible();

  await page.getByRole("link", { name: "← Expenses" }).click();
  await page.getByRole("tab", { name: "To approve" }).click();
  await page.getByRole("link", { name: "Harbor Hotel" }).click();
  await page.getByRole("button", { name: "Send back" }).click();
  const dlg = page.getByRole("dialog", { name: "Send back for changes" });
  await dlg.getByLabel("Reason").fill("Please add the itemized folio");
  await dlg.getByRole("button", { name: "Send back" }).click();
  await expect(page.getByText("Sent back: Please add the itemized folio")).toBeVisible();

  await page.getByRole("link", { name: "← Expenses" }).click();
  await page.getByRole("tab", { name: "To reimburse" }).click();
  await page.getByRole("checkbox", { name: "Select Rail Co" }).click();
  await expect(page.getByText("€42.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark 1 reimbursed" }).click();
  const pay = page.getByRole("dialog", { name: "Mark 1 expense reimbursed" });
  await pay.getByLabel("Payment reference (optional)").fill("Payroll Nov");
  await pay.getByRole("button", { name: "Mark reimbursed" }).click();
  await expect(page.getByText("Nothing to reimburse")).toBeVisible();

  await page.getByRole("button", { name: "Export CSV" }).click();
  const exp = page.getByRole("dialog", { name: "Export expenses" });
  const [download] = await Promise.all([page.waitForEvent("download"), exp.getByRole("button", { name: "Download CSV" }).click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(csv).toContain("Rail Co,Travel,,42.00,7.00,EUR,reimbursed");
});

test("expenses: member sees the reason and their numbers on the dashboard", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/m/expenses/expenses");
  await expect(page.getByText("Needs changes")).toBeVisible();
  await expect(page.getByText("Reimbursed", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
});

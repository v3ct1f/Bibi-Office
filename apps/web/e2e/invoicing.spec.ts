import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after admin.spec.ts (alice owns "Acme Bakery" with contacts Ada and Grace).
test.describe.configure({ mode: "serial" });

test("enable invoicing and set seller details", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Invoicing" }).click();
  await expect(page.getByRole("switch", { name: "Disable Invoicing" })).toBeChecked();
  await page.getByRole("button", { name: "Invoicing settings" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Your company name").fill("Acme Bakery Ltd");
  await dlg.getByLabel("Payment instructions (e.g. IBAN)").fill("IBAN DE89 3704 0044 0532 0130 00");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" })).toBeVisible();
});

test("create, issue, pay an invoice", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByLabel("Contact").selectOption({ label: "Ada" });
  await page.getByLabel("Description").fill("Wedding cake");
  await page.getByLabel("Qty").fill("2");
  await page.getByLabel("Unit price (EUR)").fill("150");
  await page.getByLabel("Tax %").fill("19");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Description").nth(1).fill("Delivery");
  await page.getByLabel("Unit price (EUR)").nth(1).fill("25.50");
  await expect(page.getByTestId("totals")).toContainText("€382.50"); // 300 + 57 tax + 25.50
  await page.getByRole("button", { name: "Save and issue" }).click();

  const year = new Date().getUTCFullYear();
  await expect(page.getByRole("heading", { name: `Invoice INV-${year}-00001` })).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record payment" });
  await pay.getByLabel("Amount (EUR)").fill("100");
  await pay.getByRole("button", { name: "Save payment" }).click();
  await expect(pay).toBeHidden();
  await expect(page.getByText("Partly paid")).toBeVisible();
  await expect(page.getByTestId("totals")).toContainText("€282.50");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toBe(`INV-${year}-00001.pdf`);

  await page.getByRole("button", { name: "Record payment" }).click();
  await pay.getByRole("button", { name: "Save payment" }).click(); // prefilled with the balance
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toBeHidden();
});

test("issued invoices can't be edited; drafts can be deleted; widget and contact tab", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/invoicing/invoices");
  await page.getByRole("link", { name: /^INV-/ }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeHidden();

  await page.goto("/m/invoicing/invoices/new");
  await page.getByLabel("Description").fill("Sample");
  await page.getByLabel("Unit price (EUR)").fill("10");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "Draft invoice" })).toBeVisible();
  await page.getByRole("button", { name: "Delete draft" }).click();
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Paid, last 30 days")).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Ada" }).click();
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page.getByRole("cell", { name: /^INV-/ })).toBeVisible();
});

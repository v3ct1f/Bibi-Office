import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
let slug: string;
const year = new Date().getUTCFullYear();

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("dana@example.com");
  await page.getByLabel("Name").fill("Dana Ledger");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Ledger Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
  slug = new URL(page.url()).pathname.split("/")[2]!;
});

test("enable Invoicing from Settings → Modules", async () => {
  await page.goto(`/t/${slug}/settings/modules`);
  await page.getByRole("switch", { name: "Enable Invoicing" }).click();
  await expect(page.getByRole("switch", { name: "Disable Invoicing" })).toBeChecked();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" })).toBeVisible();
});

test("create a company, then a draft invoice with live totals", async () => {
  await page.goto(`/t/${slug}/companies`);
  await page.getByRole("button", { name: "New company" }).first().click();
  await page.getByLabel("Name").fill("Initech");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Initech" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await page.getByLabel("Customer search").fill("init");
  await page.getByRole("option", { name: /Initech/ }).click();
  await expect(page.getByTestId("selected-customer")).toHaveText("Initech");

  await page.getByLabel("Line 1 description").fill("Consulting");
  await page.getByLabel("Line 1 quantity").fill("3");
  await page.getByLabel("Line 1 unit price").fill("19.99");
  await page.getByLabel("Line 1 tax rate").fill("21");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Line 2 description").fill("Travel");
  await page.getByLabel("Line 2 unit price").fill("40");
  await page.getByLabel("Line 2 tax rate").fill("0");
  // 59.97 + 12.59 tax + 40.00 = 112.56
  await expect(page.getByTestId("editor-total")).toContainText("112.56");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Draft invoice created")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Draft invoice/ })).toBeVisible();
  await expect(page.getByTestId("invoice-total")).toContainText("112.56");
});

test("edit the draft, send it and get a number", async () => {
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Line 2 unit price").fill("50");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("invoice-total")).toContainText("122.56");

  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByTestId("invoice-number")).toHaveText(`INV-${year}-00001`);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("record a partial then a full payment", async () => {
  await page.getByRole("button", { name: "Record payment" }).click();
  const dlg = page.getByRole("dialog", { name: "Record payment" });
  await dlg.getByLabel(/Amount/).fill("22.56");
  await dlg.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Partially paid")).toBeVisible();
  await expect(page.getByTestId("invoice-balance")).toContainText("100.00");

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog", { name: "Record payment" }).getByRole("button", { name: "Record payment" }).click(); // prefilled balance
  await expect(page.getByText("Invoice paid in full")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
});

test("company tab, list filter and dashboard widget", async () => {
  await page.goto(`/t/${slug}/companies`);
  await page.getByRole("cell", { name: "Initech", exact: true }).click();
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page.getByRole("link", { name: `INV-${year}-00001` })).toBeVisible();

  // Second invoice from the company tab is prefilled with the customer, then sent and left open.
  await page.getByRole("button", { name: "New invoice" }).click();
  await expect(page.getByTestId("selected-customer")).toHaveText("Initech");
  await page.getByLabel("Line 1 description").fill("Retainer");
  await page.getByLabel("Line 1 unit price").fill("500");
  await page.getByLabel("Line 1 tax rate").fill("0");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByTestId("invoice-number")).toHaveText(`INV-${year}-00002`);

  await page.getByRole("link", { name: "Invoices" }).first().click();
  await page.getByRole("tab", { name: "Paid" }).click();
  await expect(page.getByRole("link", { name: `INV-${year}-00001` })).toBeVisible();
  await expect(page.getByRole("link", { name: `INV-${year}-00002` })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("outstanding-EUR")).toContainText("500.00");
});

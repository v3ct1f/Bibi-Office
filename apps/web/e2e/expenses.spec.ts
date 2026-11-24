import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";

async function signIn(page: Page, email: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function newUser(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, name);
  return { ctx, page };
}

/** A real receipt photo: render one and screenshot it, so OCR runs on actual pixels. */
async function receiptPng(browser: Browser): Promise<Buffer> {
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#fff">
    <pre id="r" style="font:28px/1.5 'Courier New',monospace;color:#000;padding:32px;width:560px;margin:0">CAFETERIA SOL
Fecha: 14/03/2026
2 x CAFE            3,00
TOSTADA             4,50
IVA 10%             0,68
TOTAL               7,50</pre></body>`);
  const png = await p.locator("#r").screenshot();
  await ctx.close();
  return png;
}

test.describe.configure({ mode: "serial" });

let olga: Page;   // owner (approves)
let max: Page;    // employee
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  const m = await newUser(browser, "max@example.com", "Max Waiter");
  await expect(m.page.getByText("Set up your workspace")).toBeVisible();
  await m.ctx.close();
  olga = (await newUser(browser, "olga@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Taberna Sol");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});

test("owner adds the feature and an employee", async ({ browser }) => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Invoices & Expenses" }).click();
  await expect(nav(olga).getByRole("link", { name: "Expenses" })).toBeVisible();

  await olga.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(olga, browser, "max@example.com", "Max Waiter");
  await expect(olga.getByRole("cell", { name: /Max Waiter/ })).toBeVisible();
});

test("employee photographs a receipt; the fields are read and can be checked before submitting", async ({ browser }) => {
  test.setTimeout(120_000);
  max = (await newUser(browser, "max@example.com", "Max Waiter")).page;
  await expect(max.getByRole("heading", { name: "Welcome back, Max" })).toBeVisible();
  await nav(max).getByRole("link", { name: "Expenses" }).click();
  await expect(max.getByRole("tab")).toHaveCount(0); // employees only see their own
  await max.getByRole("button", { name: "New expense" }).first().click();

  await max.getByLabel("Upload receipt file").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: await receiptPng(browser) });
  await expect(max.getByTestId("ocr-result")).toContainText("Please check every field", { timeout: 90_000 });
  await expect(max.getByRole("img", { name: "Receipt" })).toBeVisible();
  await expect(max.getByLabel("Total")).toHaveValue("7.50");
  await expect(max.getByLabel(/^Date/)).toHaveAttribute("data-value", "2026-03-14");
  await expect(max.getByLabel("Vendor")).toHaveValue(/SOL/i);
  await expect(max.getByLabel("Line 2 description")).toHaveValue(/TOSTADA/i);

  // Review and correct before saving.
  await max.getByLabel("Vendor").fill("Cafetería Sol");
  await max.getByLabel("Category").selectOption("Food & drink supplies");
  await max.getByLabel("Line 1 amount").fill("9.99");
  await max.getByRole("button", { name: "Save and submit" }).click();
  await expect(max.getByRole("alert")).toContainText("The lines add up to");
  await max.getByLabel("Line 1 amount").fill("3.00");
  await max.getByRole("button", { name: "Save and submit" }).click();
  await expect(max.getByText("Sent for approval")).toBeVisible();
  await expect(max.getByRole("heading", { name: /Cafetería Sol/ })).toContainText("Waiting for approval");
  await expect(max.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(max.getByTestId("expense-total")).toContainText("7.50");
});

test("manager rejects with a comment; employee fixes and resubmits", async () => {
  await nav(olga).getByRole("link", { name: "Expenses" }).click();
  await expect(olga.getByRole("tab", { name: "To approve" })).toHaveAttribute("aria-selected", "true");
  await olga.getByRole("link", { name: "Cafetería Sol" }).click();
  await olga.getByRole("button", { name: "Reject" }).click();
  await olga.getByRole("dialog").getByLabel("Reason").fill("Please add what the coffee was for");
  await olga.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
  await expect(olga.getByRole("heading", { name: /Cafetería Sol/ })).toContainText("Rejected");

  await max.reload();
  await expect(max.getByTestId("rejected-callout")).toContainText("Please add what the coffee was for");
  await max.getByRole("button", { name: "Edit" }).click();
  await max.getByLabel("What was it for?").fill("Coffee with the new supplier");
  await max.getByRole("button", { name: "Save and submit" }).click();
  await expect(max.getByRole("heading", { name: /Cafetería Sol/ })).toContainText("Waiting for approval");
});

test("manager approves and marks paid; history shows every step", async () => {
  await olga.reload();
  await olga.getByRole("button", { name: "Approve" }).click();
  await olga.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(olga.getByRole("heading", { name: /Cafetería Sol/ })).toContainText("Approved");
  await olga.getByRole("button", { name: "Mark as paid" }).click();
  await expect(olga.getByRole("heading", { name: /Cafetería Sol/ })).toContainText("Paid");
  const history = olga.getByRole("list", { name: "History" });
  for (const step of ["Created", "Submitted for approval", "Rejected", "Edited", "Approved", "Marked as paid"]) await expect(history).toContainText(step);
  await expect(olga.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("manual supplier invoice, filters and CSV export", async () => {
  await olga.goto(`/t/${slug}/m/expenses/expenses/new`);
  await olga.getByLabel("Type").selectOption("invoice");
  await olga.getByLabel("Vendor").fill("Distribuciones Norte");
  await olga.getByLabel(/^Date/).fill("2026-02-20");
  await olga.getByLabel("Invoice number").fill("F-2026-118");
  await olga.getByLabel("Due date").fill("2026-03-20");
  await olga.getByLabel("Tax").fill("21.00");
  await olga.getByLabel("Total").fill("121.00");
  await olga.getByRole("button", { name: "Save draft" }).click();
  await expect(olga.getByRole("heading", { name: /Distribuciones Norte/ })).toContainText("Draft");

  await nav(olga).getByRole("link", { name: "Expenses" }).click();
  await olga.getByRole("tab", { name: "Everyone" }).click();
  await expect(olga.getByRole("table", { name: "Expenses" }).getByRole("row")).toHaveCount(3);
  await olga.getByLabel("Vendor search").fill("norte");
  await expect(olga.getByRole("table", { name: "Expenses" }).getByRole("row")).toHaveCount(2);
  await olga.getByRole("button", { name: "Clear filters" }).click();
  await olga.getByLabel("Status").selectOption("paid");
  await expect(olga.getByRole("link", { name: "Cafetería Sol" })).toBeVisible();
  await expect(olga.getByRole("link", { name: "Distribuciones Norte" })).toHaveCount(0);
  await olga.getByLabel("Employee").selectOption({ label: "Max Waiter" });
  await expect(olga.getByTestId("list-total")).toContainText("7.50");

  const [download] = await Promise.all([olga.waitForEvent("download"), olga.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^expenses-.*\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(csv).toContain("Cafetería Sol");
  expect(csv).toContain("Paid");
  expect(csv).not.toContain("Distribuciones Norte");
});

test("dashboard shows the expenses card", async () => {
  await nav(olga).getByRole("link", { name: "Dashboard" }).click();
  await expect(olga.getByTestId("expenses-widget")).toContainText("Waiting for approval (0)");
});

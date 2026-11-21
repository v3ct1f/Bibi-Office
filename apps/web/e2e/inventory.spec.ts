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

test.describe.configure({ mode: "serial" });

let olga: Page;   // owner
let tom: Page;    // staff member
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const dialog = (p: Page) => p.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  const t = await newUser(browser, "tom.barista@example.com", "Tom Barista");
  await expect(t.page.getByText("Set up your workspace")).toBeVisible();
  await t.ctx.close();
  olga = (await newUser(browser, "olga.cafe@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Cafe Sol");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});

test("owner adds the feature, a staff member and two suppliers", async ({ browser }) => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Inventory & Purchasing" }).click();
  await expect(nav(olga).getByRole("link", { name: "Inventory" })).toBeVisible();
  await expect(nav(olga).getByRole("link", { name: "Purchase orders" })).toBeVisible();

  await olga.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(olga, browser, "tom.barista@example.com", "Tom Barista");
  await expect(olga.getByRole("cell", { name: /Tom Barista/ })).toBeVisible();

  for (const name of ["Fresh Farms", "Drinks Co"]) {
    await olga.goto(`/t/${slug}/companies`);
    await olga.getByRole("button", { name: "New company" }).first().click();
    await olga.getByLabel("Name").fill(name);
    await olga.getByRole("button", { name: "Create" }).click();
    await expect(olga.getByRole("heading", { name })).toBeVisible();
  }
});

async function addItem(p: Page, f: { name: string; category: string; unit: string; stock: string; min: string; reorder?: string; cost: string; supplier: string }) {
  await nav(p).getByRole("link", { name: "Inventory" }).click();
  await p.getByRole("button", { name: "New item" }).first().click();
  await p.getByLabel("Name").fill(f.name);
  await p.getByLabel("Category").fill(f.category);
  await p.getByRole("combobox", { name: "Unit *" }).fill(f.unit);
  await p.getByLabel("Unit cost (EUR)").fill(f.cost);
  await p.getByLabel("Stock now").fill(f.stock);
  await p.getByLabel("Minimum stock").fill(f.min);
  if (f.reorder) await p.getByLabel("Reorder amount").fill(f.reorder);
  await p.getByLabel("Supplier").fill(f.supplier.slice(0, 5));
  await p.getByRole("option", { name: f.supplier }).click();
  await expect(p.getByTestId("selected-supplier")).toHaveText(f.supplier);
  await p.getByRole("button", { name: "Add item" }).click();
  await expect(p.getByRole("heading", { name: f.name })).toBeVisible();
}

test("manager adds items; validation is clear; low items stand out", async () => {
  await nav(olga).getByRole("link", { name: "Inventory" }).click();
  await expect(olga.getByText("No items yet")).toBeVisible();
  await olga.getByRole("button", { name: "New item" }).first().click();
  await olga.getByLabel("Minimum stock").fill("abc");
  await olga.getByRole("button", { name: "Add item" }).click();
  await expect(olga.getByRole("alert")).toContainText("Check the highlighted fields");
  await expect(olga.getByText("Give the item a name")).toBeVisible();
  await expect(olga.getByText("Use a number with at most 3 decimals")).toBeVisible();

  await addItem(olga, { name: "Whole milk", category: "Dairy", unit: "l", stock: "12", min: "10", cost: "0.95", supplier: "Fresh Farms" });
  await expect(olga.getByTestId("stock-card")).toContainText("12 l");
  await addItem(olga, { name: "Coffee beans", category: "Coffee", unit: "kg", stock: "1.5", min: "2", reorder: "5", cost: "18.00", supplier: "Drinks Co" });
  await expect(olga.getByTestId("stock-card")).toContainText("Low");

  await nav(olga).getByRole("link", { name: "Inventory" }).click();
  await expect(olga.getByTestId("low-banner")).toContainText("1 item is at or below the minimum");
  await expect(olga.getByTestId("stock-value")).toHaveText(/38\.40/); // 12 × 0.95 + 1.5 × 18
});

test("staff record usage and waste with a reason; can't take more than there is", async ({ browser }) => {
  tom = (await newUser(browser, "tom.barista@example.com", "Tom Barista")).page;
  await nav(tom).getByRole("link", { name: "Inventory" }).click();
  await expect(tom.getByRole("button", { name: "New item" })).toHaveCount(0);
  await expect(tom.getByRole("button", { name: "Order low stock" })).toHaveCount(0);

  await tom.getByRole("button", { name: "Change stock of Whole milk" }).click();
  await dialog(tom).getByRole("radio", { name: /^Usage/ }).check();
  await dialog(tom).getByLabel("Quantity (l)").fill("50");
  await expect(dialog(tom)).toContainText("Only 12 l in stock");
  await dialog(tom).getByLabel("Quantity (l)").fill("3");
  await expect(dialog(tom)).toContainText("Stock after: 9 l");
  await dialog(tom).getByRole("button", { name: "Save change" }).click();
  await expect(tom.getByRole("table", { name: "Items" }).getByRole("row", { name: /Whole milk/ })).toContainText("Low");

  await tom.getByRole("link", { name: "Whole milk" }).click();
  await tom.getByRole("button", { name: "Waste" }).click();
  await dialog(tom).getByLabel("Quantity (l)").fill("0.5");
  await dialog(tom).getByLabel("Note").fill("Past the date");
  await dialog(tom).getByRole("button", { name: "Save change" }).click();
  await expect(tom.getByTestId("stock-card")).toContainText("8.5 l");
  const hist = tom.getByRole("table", { name: "Stock history" });
  await expect(hist.getByRole("row").nth(1)).toContainText("Waste");
  await expect(hist.getByRole("row").nth(1)).toContainText("Past the date");
  await expect(hist.getByRole("row").nth(1)).toContainText("Tom Barista");
  await expect(hist.getByRole("row").nth(2)).toContainText("Usage");
  await expect(hist).toContainText("Starting stock");
});

test("dashboard warns; one click orders low stock from each supplier", async () => {
  await nav(olga).getByRole("link", { name: "Dashboard" }).click();
  await expect(olga.getByTestId("low-stock-widget")).toContainText("2 items low");
  await expect(olga.getByTestId("low-stock-widget")).toContainText("Whole milk");

  await nav(olga).getByRole("link", { name: "Purchase orders" }).click();
  await expect(olga.getByText("No open orders")).toBeVisible();
  await olga.getByRole("button", { name: "Order low stock" }).click();
  await dialog(olga).getByRole("button", { name: "Create orders" }).click();
  const table = olga.getByRole("table", { name: "Purchase orders" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("Fresh Farms");
  await expect(table).toContainText("Drinks Co");
  await expect(table).toContainText("Draft");
});

test("edit, send and receive an order; receiving adds to stock", async () => {
  await olga.getByRole("table", { name: "Purchase orders" }).getByRole("row", { name: /Drinks Co/ }).getByRole("link").click();
  await expect(olga.getByTestId("order-title")).toContainText("Drinks Co");
  await expect(olga.getByLabel("Quantity of Coffee beans")).toHaveValue("5");
  await olga.getByLabel("Quantity of Coffee beans").fill("6");
  await olga.getByLabel("Unit cost of Coffee beans").fill("17.50");
  await expect(olga.getByTestId("order-total")).toHaveText(/105\.00/);
  await olga.getByRole("button", { name: "Save changes" }).click();
  await expect(olga.getByText("Order saved")).toBeVisible();

  await olga.getByRole("button", { name: "Mark as sent" }).click();
  await dialog(olga).getByRole("button", { name: "Mark as sent" }).click();
  await expect(olga.getByTestId("order-title")).toContainText("Sent");

  await olga.getByRole("button", { name: "Receive" }).click();
  await expect(dialog(olga).getByLabel("Arrived of Coffee beans")).toHaveValue("6");
  await dialog(olga).getByRole("button", { name: "Receive and update stock" }).click();
  await expect(olga.getByTestId("order-title")).toContainText("Received");
  await expect(olga.getByRole("button", { name: "Receive" })).toHaveCount(0);

  await olga.getByRole("button", { name: "Coffee beans" }).click();
  await expect(olga.getByTestId("stock-card")).toContainText("7.5 kg");
  await expect(olga.getByTestId("stock-card")).not.toContainText("Low");
  const first = olga.getByRole("table", { name: "Stock history" }).getByRole("row").nth(1);
  await expect(first).toContainText("Delivery");
  await expect(first).toContainText(/PO-000\d Received$|PO-000\dReceived/);
});

test("cancel the other order; stock history filters", async () => {
  await nav(olga).getByRole("link", { name: "Purchase orders" }).click();
  await olga.getByRole("table", { name: "Purchase orders" }).getByRole("row", { name: /Fresh Farms/ }).getByRole("link").click();
  await olga.getByRole("button", { name: "Mark as sent" }).click();
  await dialog(olga).getByRole("button", { name: "Mark as sent" }).click();
  await expect(olga.getByTestId("order-title")).toContainText("Sent");
  await olga.getByRole("button", { name: "Cancel order" }).click();
  await dialog(olga).getByRole("button", { name: "Cancel order" }).click();
  await expect(olga.getByTestId("order-title")).toContainText("Cancelled");

  await nav(olga).getByRole("link", { name: "Inventory" }).click();
  await olga.getByRole("button", { name: "Stock history" }).click();
  await olga.getByLabel("Why").selectOption("waste");
  const rows = olga.getByRole("table", { name: "Stock history" }).getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Whole milk");
});

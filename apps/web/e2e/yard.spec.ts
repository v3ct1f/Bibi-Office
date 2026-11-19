import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after workforce.spec.ts (alice owns "Acme Bakery"; bob is a member).
test.describe.configure({ mode: "serial" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const ROOT = "/m/inventory/inventory";

test("inventory: enable, add a location and an item, receive stock", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Inventory" }).click();
  await expect(page.getByRole("switch", { name: "Disable Inventory" })).toBeChecked();
  await nav(page).getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByText("No items yet")).toBeVisible();

  await page.getByRole("tab", { name: "Locations" }).click();
  await expect(page.getByRole("list", { name: "Locations" })).toContainText("Main");
  await page.getByLabel("New location").fill("Van");
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByRole("list", { name: "Locations" })).toContainText("Van");

  await page.getByRole("tab", { name: "Items" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const dlg = page.getByRole("dialog", { name: "Add item" });
  await dlg.getByLabel("SKU").fill("FLR-25");
  await dlg.getByLabel("Name", { exact: true }).fill("Flour 25kg");
  await dlg.getByLabel("Category (optional)").fill("Baking");
  await dlg.getByLabel("Unit", { exact: true }).fill("bag");
  await dlg.getByLabel("Unit cost (EUR)").fill("18");
  await dlg.getByLabel("Reorder point (optional)").fill("8");
  await dlg.getByLabel("Reorder quantity (optional)").fill("20");
  await dlg.getByLabel("Opening stock (optional)").fill("12");
  await dlg.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("heading", { name: "Flour 25kg" })).toBeVisible();
  await expect(page.getByLabel("On hand")).toHaveText("12 bag");

  await page.getByRole("button", { name: "Receive" }).click();
  const rcv = page.getByRole("dialog", { name: "Receive stock: Flour 25kg" });
  await rcv.getByLabel("Quantity (bag)").fill("8");
  await rcv.getByLabel("Unit cost (EUR, optional)").fill("21");
  await rcv.getByLabel("Reference (optional)").fill("PO-1001");
  await rcv.getByRole("button", { name: "Receive stock" }).click();
  await expect(rcv).toBeHidden();
  await expect(page.getByLabel("On hand")).toHaveText("20 bag");
  await expect(page.getByRole("table", { name: "Movements" })).toContainText("PO-1001");

  await page.getByRole("button", { name: "Move" }).click();
  const mv = page.getByRole("dialog", { name: "Move stock: Flour 25kg" });
  await mv.getByLabel("Quantity (bag)").fill("5");
  await mv.getByRole("button", { name: "Move stock" }).click();
  await expect(mv).toBeHidden();
  await expect(page.getByRole("list", { name: "Stock by location" })).toContainText("Van5");
});

test("member: issues stock, can't oversell or adjust", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto(ROOT);
  await page.getByRole("searchbox", { name: "Search items" }).fill("flour");
  await page.getByRole("table", { name: "Items" }).getByText("Flour 25kg").click();
  await expect(page.getByRole("heading", { name: "Flour 25kg" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

  const issue = async (qty: string) => {
    await page.getByRole("button", { name: "Issue" }).click();
    const d = page.getByRole("dialog", { name: "Issue stock: Flour 25kg" });
    await d.getByLabel("Quantity (bag)").fill(qty);
    await d.getByLabel("Reference (optional)").fill("Order 77");
    await d.getByRole("button", { name: "Issue stock" }).click();
    return d;
  };
  const over = await issue("50");
  await expect(over.getByRole("alert")).toContainText("Not enough Flour 25kg in stock at that location");
  await over.getByRole("button", { name: "Cancel" }).click();
  await expect(await issue("11")).toBeHidden();
  await expect(page.getByLabel("On hand")).toHaveText("9 bag");
  const d2 = await issue("4");
  await expect(d2).toBeHidden();
  await expect(page.getByText("Low", { exact: true })).toBeVisible();
});

test("admin: reorder list and a stock count", async ({ page }) => {
  await signIn(page);
  await page.goto(ROOT);
  await page.getByRole("tab", { name: "Reorder" }).click();
  const r = page.getByRole("table", { name: "Reorder list" });
  await expect(r).toContainText("Flour 25kg");
  await expect(r).toContainText("20 bag");

  await page.getByRole("tab", { name: "Items" }).click();
  await page.getByRole("button", { name: "Stock count" }).click();
  const dlg = page.getByRole("dialog", { name: "Stock count" });
  await dlg.getByLabel("Counted Flour 25kg").fill("1");
  await dlg.getByRole("button", { name: "Save count (1)" }).click();
  await expect(page.getByRole("dialog", { name: "Count saved" })).toContainText("1 difference recorded");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("tab", { name: "Movements" }).click();
  await expect(page.getByRole("table", { name: "Movements" }).getByText("Counted").first()).toBeVisible();
});

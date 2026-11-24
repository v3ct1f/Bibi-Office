import { expect, test, type Browser, type Page } from "@playwright/test";

/** The program owner (boss@example.com in playwright.config) sets up a business, its owner joins, then it's paused. */
async function signIn(page: Page, email: string, name: string, path = "/") {
  await page.goto(path);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function newUser(browser: Browser, email: string, name: string, path = "/") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, name, path);
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

let boss: Page;
let link: string;

test.beforeAll(async ({ browser }) => {
  boss = (await newUser(browser, "boss@example.com", "Bea Boss")).page;
});

test("the program owner lands on the business list and creates a business", async () => {
  await expect(boss.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await expect(boss).toHaveURL(/\/admin$/);
  await boss.getByRole("button", { name: "New business" }).first().click();
  const d = boss.getByRole("dialog");
  await d.getByLabel("Business name").fill("Corner Bakery");
  await expect(d.getByLabel("Workspace URL")).toHaveValue("corner-bakery");
  await d.getByLabel("Owner's email").fill("olga@example.com");
  await d.getByRole("button", { name: "Create and invite" }).click();
  await expect(d.getByRole("status")).toContainText("olga@example.com");
  link = (await d.locator("code").textContent())!.trim();
  await d.getByRole("button", { name: "Done" }).click();
  const row = boss.getByRole("table", { name: "Businesses" }).getByRole("row", { name: /Corner Bakery/ });
  await expect(row).toContainText("olga@example.com");
  await expect(row).toContainText("Active");
});

test("the business owner accepts and gets their own dashboard", async ({ browser }) => {
  const { ctx, page } = await newUser(browser, "olga@example.com", "Olga Owner", link);
  await expect(page.getByRole("heading", { name: "Join Corner Bakery" })).toBeVisible();
  await page.getByRole("button", { name: "Accept and join" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  await expect(page).toHaveURL(/\/t\/corner-bakery/);
  await ctx.close();

  await boss.reload();
  const row = boss.getByRole("table", { name: "Businesses" }).getByRole("row", { name: /Corner Bakery/ });
  await expect(row).toContainText("Olga Owner");
});

test("pausing closes the business for its people; reactivating opens it", async ({ browser }) => {
  await boss.getByRole("button", { name: "Actions for Corner Bakery" }).click();
  await boss.getByRole("menuitem", { name: "Pause business" }).click();
  await boss.getByRole("dialog").getByRole("button", { name: "Pause" }).click();
  const row = boss.getByRole("table", { name: "Businesses" }).getByRole("row", { name: /Corner Bakery/ });
  await expect(row).toContainText("Paused");

  const { ctx, page } = await newUser(browser, "olga@example.com", "Olga Owner", "/t/corner-bakery");
  await expect(page.getByText("Corner Bakery is paused")).toBeVisible();
  await ctx.close();

  await boss.getByRole("button", { name: "Actions for Corner Bakery" }).click();
  await boss.getByRole("menuitem", { name: "Reactivate business" }).click();
  await boss.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
  await expect(row).toContainText("Active");
});

test("the program owner chooses which features a business can use", async ({ browser }) => {
  await boss.getByRole("button", { name: "Actions for Corner Bakery" }).click();
  await boss.getByRole("menuitem", { name: "Choose features" }).click();
  const d = boss.getByRole("dialog");
  await d.getByRole("checkbox", { name: "All features" }).click();
  await d.getByRole("checkbox", { name: "Inventory & Purchasing" }).click();
  await d.getByRole("button", { name: "Save features" }).click();
  await expect(d).toBeHidden();
  const row = boss.getByRole("table", { name: "Businesses" }).getByRole("row", { name: /Corner Bakery/ });
  await expect(row).toContainText("11 of 12 included");

  const { ctx, page } = await newUser(browser, "olga@example.com", "Olga Owner", "/t/corner-bakery/features");
  const card = page.getByTestId("feature-inventory");
  await expect(card).toContainText("Not included");
  await expect(card.getByRole("button", { name: /Add/ })).toHaveCount(0);
  await expect(page.getByTestId("feature-crm").getByRole("button", { name: "Add CRM" })).toBeVisible();
  await ctx.close();
});

test("the program owner adds a co-owner, who sees Program admin, then removes them", async ({ browser }) => {
  await boss.getByRole("button", { name: "Add co-owner" }).click();
  const d = boss.getByRole("dialog");
  await d.getByLabel("Their email").fill("cleo@example.com");
  await d.getByRole("button", { name: "Add co-owner" }).click();
  await expect(d.getByRole("status")).toContainText("cleo@example.com is now a program owner");
  await d.getByRole("button", { name: "Done" }).click();
  const list = boss.getByRole("list", { name: "Program owners" });
  await expect(list).toContainText("Hasn't signed in yet");

  const { ctx, page } = await newUser(browser, "cleo@example.com", "Cleo Co", "/admin");
  await expect(page.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Program owners" })).toContainText("Bea Boss");
  await ctx.close();

  await boss.reload();
  await expect(list).toContainText("Cleo Co");
  await boss.getByRole("button", { name: "Remove cleo@example.com" }).click();
  await boss.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(list).not.toContainText("Cleo");
});

test("deleting a business needs its name typed", async () => {
  await boss.goto("/admin");
  await boss.getByRole("button", { name: "New business" }).first().click();
  const d = boss.getByRole("dialog");
  await d.getByLabel("Business name").fill("Short Lived");
  await d.getByLabel("Owner's email").fill("sid@example.com");
  await d.getByRole("button", { name: "Create and invite" }).click();
  await d.getByRole("button", { name: "Done" }).click();
  const table = boss.getByRole("table", { name: "Businesses" });
  await expect(table.getByRole("row", { name: /Short Lived/ })).toBeVisible();

  await boss.getByRole("button", { name: "Actions for Short Lived" }).click();
  await boss.getByRole("menuitem", { name: "Delete business…" }).click();
  const del = boss.getByRole("dialog", { name: "Delete Short Lived?" });
  const go = del.getByRole("button", { name: "Delete business" });
  await expect(go).toBeDisabled();
  await del.getByLabel('Type "Short Lived" to confirm').fill("short lived");
  await go.click();

  await expect(boss.getByText("Short Lived was deleted")).toBeVisible();
  await expect(table.getByRole("row", { name: /Short Lived/ })).toHaveCount(0);
  await expect(table.getByRole("row", { name: /Corner Bakery/ })).toBeVisible();
});

test("the program owner can look inside a business, read-only", async () => {
  await boss.goto("/admin");
  await boss.getByRole("table", { name: "Businesses" }).getByRole("link", { name: "Corner Bakery" }).click();
  await expect(boss).toHaveURL(/\/t\/corner-bakery/);
  const banner = boss.getByRole("status").filter({ hasText: "as the program owner" });
  await expect(banner).toContainText("read-only");
  await expect(banner).toContainText("This visit is recorded in its history");

  await boss.goto("/t/corner-bakery/contacts");
  await expect(boss.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(boss.getByRole("button", { name: "New contact" })).toHaveCount(0);

  await banner.getByRole("link", { name: "Back to Program admin" }).click();
  await expect(boss.getByRole("heading", { name: "Businesses" })).toBeVisible();
});

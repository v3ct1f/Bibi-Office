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

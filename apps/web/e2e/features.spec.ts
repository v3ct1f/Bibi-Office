import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
let slug: string;
const nav = () => page.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("fran@example.com");
  await page.getByLabel("Name").fill("Fran Owner");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Corner Bar");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Fran" })).toBeVisible();
  slug = new URL(page.url()).pathname.split("/")[2]!;
});

test("nothing is on by default; adding a feature shows its pages", async () => {
  await expect(nav().getByRole("link", { name: "Deals" })).toHaveCount(0);
  await nav().getByRole("link", { name: "Add features" }).click();
  await expect(page.getByRole("heading", { name: "Add features" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // Features are grouped by category, each under its own heading.
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
  await expect(page.getByTestId("category-sales").getByTestId("feature-crm")).toBeVisible();
  await expect(page.getByTestId("category-sales").getByTestId("feature-invoicing")).toHaveCount(0);
  await expect(page.getByTestId("category-finance").getByTestId("feature-invoicing")).toBeVisible();

  await page.getByRole("button", { name: "Add CRM" }).click();
  await expect(page.getByText("CRM added").first()).toBeVisible();
  await expect(page.getByTestId("feature-crm")).toContainText("Added");
  await expect(page.getByTestId("feature-crm")).toContainText("by Fran Owner");
  await expect(nav().getByRole("link", { name: "Deals" })).toBeVisible();

  await nav().getByRole("link", { name: "Deals" }).click();
  await page.getByRole("button", { name: "New deal" }).first().click();
  await page.getByLabel("Deal name").fill("Wine tasting night");
  await page.getByLabel("Value").fill("900");
  await page.getByRole("button", { name: "Add deal" }).first().click();
  await expect(page.getByRole("heading", { name: /Wine tasting night/ })).toBeVisible();
});

test("removing hides the pages and keeps the data; adding again brings it back", async () => {
  await nav().getByRole("link", { name: "Add features" }).click();
  await page.getByRole("button", { name: "Remove CRM" }).click();
  await expect(page.getByRole("dialog")).toContainText("Nothing is deleted");
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("CRM removed").first()).toBeVisible();
  await expect(page.getByTestId("feature-crm")).toContainText("Its data is kept");
  await expect(nav().getByRole("link", { name: "Deals" })).toHaveCount(0);

  await page.goto(`/t/${slug}/m/crm/board`);
  await expect(page.getByText("This feature is turned off")).toBeVisible();
  await page.getByRole("link", { name: "Add features" }).last().click();

  await page.getByRole("button", { name: "Add CRM" }).click();
  await expect(page.getByText("CRM added").first()).toBeVisible();
  await nav().getByRole("link", { name: "Deals" }).click();
  await expect(page.getByTestId("deal-card")).toContainText("Wine tasting night");
});

test("the old settings address forwards to Add features", async () => {
  await page.goto(`/t/${slug}/settings/modules`);
  await expect(page.getByRole("heading", { name: "Add features" })).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
const nav = () => page.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("cora@example.com");
  await page.getByLabel("Name").fill("Cora Colleague");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Team Shop");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Cora" })).toBeVisible();
});

test("the owner creates an account for a worker", async () => {
  await nav().getByRole("link", { name: "Colleagues" }).click();
  await expect(page.getByRole("heading", { name: "Colleagues" })).toBeVisible();
  await page.getByRole("button", { name: "Add colleague" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Walt Worker");
  await d.getByLabel(/^Email/).fill("walt@example.com");
  await d.getByLabel("Role").selectOption("member");
  const pw = d.getByLabel("Starting password");
  await expect(pw).not.toHaveValue(""); // one is made up for you
  await pw.fill("short");
  await expect(d.getByRole("button", { name: "Create account" })).toBeDisabled();
  await pw.fill("walts-start-01");
  await d.getByRole("button", { name: "Create account" }).click();

  await expect(d.getByRole("heading", { name: "Account ready" })).toBeVisible();
  await expect(d.getByText("walts-start-01")).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table", { name: "Colleagues" })).toContainText("Walt Worker");
});

test("someone already in the business can't be added twice", async () => {
  await page.getByRole("button", { name: "Add colleague" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Walt Again");
  await d.getByLabel(/^Email/).fill("walt@example.com");
  await d.getByRole("button", { name: "Create account" }).click();
  await expect(d.getByRole("alert")).toContainText("already a member");
  await d.getByRole("button", { name: "Cancel" }).click();
});

test("the worker signs in and is already in the business", async ({ browser }) => {
  const w = await (await browser.newContext()).newPage();
  await w.goto("/");
  await w.getByRole("button", { name: "Sign in" }).click();
  await w.getByLabel("Email").fill("walt@example.com");
  await w.getByLabel("Name").fill("Walt Worker");
  await w.getByRole("button", { name: "Sign in" }).click();
  await expect(w.getByRole("heading", { name: "Welcome back, Walt" })).toBeVisible();
  await expect(w.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Colleagues" })).toBeVisible();
  await expect(w.getByRole("button", { name: "Add colleague" })).toHaveCount(0);
  await w.context().close();
});

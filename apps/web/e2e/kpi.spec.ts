import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let olga: Page;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const tile = (p: Page, name: string) => p.getByRole("list", { name: "Numbers" }).getByRole("group", { name, exact: true });

test.beforeAll(async ({ browser }) => {
  olga = await (await browser.newContext()).newPage();
  await olga.goto("/");
  await olga.getByRole("button", { name: "Sign in" }).click();
  await olga.getByLabel("Email").fill("olga.kpi@example.com");
  await olga.getByLabel("Name").fill("Olga Owner");
  await olga.getByRole("button", { name: "Sign in" }).click();
  await olga.getByLabel("Company name").fill("Kiosk Sol");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
});

test("owner adds KPIs and CRM, and starts a board with suggested numbers", async () => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add CRM" }).click();
  await olga.getByRole("button", { name: "Add KPI dashboard" }).click();
  await nav(olga).getByRole("link", { name: "KPIs" }).click();
  await expect(olga.getByText("No boards yet")).toBeVisible();

  await olga.getByRole("button", { name: "Create a board" }).click();
  const d = olga.getByRole("dialog");
  await d.getByLabel("Name").fill("Monthly review");
  await d.getByRole("button", { name: "Create board" }).click();
  await expect(d).toBeHidden();
  await expect(tile(olga, "Deals won (value)")).toBeVisible();
  await expect(tile(olga, "New contacts")).toContainText("0");
  await expect(olga.getByRole("group", { name: "Period length" }).getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
});

test("a number typed in by hand goes on the board with a target", async () => {
  await olga.getByRole("navigation", { name: "KPI sections" }).getByRole("link", { name: "Your own numbers" }).click();
  await olga.getByRole("button", { name: "New number" }).click();
  const d = olga.getByRole("dialog");
  await d.getByLabel("Name").fill("Visitors");
  await d.getByRole("button", { name: "Add number" }).click();
  await expect(olga.getByRole("heading", { name: "Visitors" })).toBeVisible();
  await olga.getByLabel("Value").fill("120");
  await olga.getByLabel("Note").fill("Market day");
  await olga.getByRole("button", { name: "Save value" }).click();
  await expect(olga.getByRole("table", { name: "Values" })).toContainText("Market day");

  await nav(olga).getByRole("link", { name: "KPIs" }).click();
  await olga.getByRole("button", { name: "Edit board" }).click();
  const e = olga.getByRole("dialog");
  await e.getByLabel("Add a number").selectOption({ label: "Visitors" });
  await expect(e.getByRole("list", { name: "Numbers on this board" })).toContainText("Visitors");
  await e.getByRole("button", { name: "Save board" }).click();
  await expect(e).toBeHidden();
  await expect(tile(olga, "Visitors")).toContainText("120");

  await tile(olga, "Visitors").getByRole("button", { name: "Details" }).click();
  const t = olga.getByRole("dialog");
  await t.getByLabel("Target for each month").fill("100");
  await t.getByRole("button", { name: "Save target" }).click();
  await expect(tile(olga, "Visitors")).toContainText("Target met");
});

test("periods can be switched and stepped through", async () => {
  await olga.getByRole("group", { name: "Period length" }).getByRole("button", { name: "Year" }).click();
  const year = String(new Date().getFullYear());
  const shown = olga.getByRole("status", { name: "Period shown" });
  await expect(shown).toHaveText(new RegExp(`^${year} · day`));
  await expect(tile(olga, "Visitors")).toContainText("120");
  await olga.getByRole("button", { name: "Earlier period" }).click();
  await expect(shown).toHaveText(String(Number(year) - 1));
  await expect(tile(olga, "Visitors")).toContainText("—");
  await olga.getByRole("button", { name: "Back to now" }).click();
  await expect(tile(olga, "Visitors")).toContainText("120");
});

test("the weekly email says when email isn't set up, and the dashboard shows the numbers", async () => {
  await olga.getByRole("button", { name: "Weekly email" }).click();
  const d = olga.getByRole("dialog");
  await expect(d.getByRole("status")).toContainText("Email isn't set up yet");
  await expect(d.getByRole("button", { name: "Send now" })).toBeDisabled();
  await d.getByRole("button", { name: "Cancel" }).click();

  await nav(olga).getByRole("link", { name: "Dashboard" }).click();
  await expect(olga.getByRole("list", { name: "Key numbers" })).toBeVisible();
});

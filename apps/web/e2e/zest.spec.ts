import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after zero-paper.spec.ts (alice owns "Acme Bakery"). The API talks to a local fake Claude API (see global-setup).
test.describe.configure({ mode: "serial" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const NOTES = `Weekly ops sync, Monday.
Flour costs rose 12% this quarter. Saturday queues are over 20 minutes.
Decision: switch to Mill & Co. from March 1. Grace signs the contract by Feb 20.
Someone should post the weekend baker job ad. Open question: keep the old supplier for rye?`;

test("AI summaries: nothing is sent until an admin adds a key", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable AI summaries" }).click();
  await expect(page.getByRole("switch", { name: "Disable AI summaries" })).toBeChecked();
  await nav(page).getByRole("link", { name: "Summaries" }).click();
  await expect(page.getByText("AI isn't set up yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New summary" })).toHaveCount(0);

  await page.goto("/admin/modules");
  await page.getByRole("button", { name: "AI summaries settings" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Anthropic API key (sk-ant-…)").fill("sk-ant-e2e-0123456789");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
});

test("summarize meeting notes and turn action items into tasks", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/ai/summaries");
  await expect(page.getByText("No summaries yet")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Monthly AI usage" })).toBeVisible();
  await page.getByRole("button", { name: "New summary" }).click();
  const dlg = page.getByRole("dialog", { name: "New summary" });
  await dlg.getByLabel("Paste the text").fill(NOTES);
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) await page.screenshot({ path: `${shots}/ai-new-summary-light.png` });
  await dlg.getByRole("button", { name: "Summarize" }).click();

  await expect(page.getByRole("heading", { name: "Weekly ops sync" })).toBeVisible();
  await expect(page.getByText("switch flour suppliers in March")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
  const items = page.getByRole("list", { name: "Action items" });
  await expect(items).toContainText("Sign the Mill & Co. supply contract");
  await expect(items).toContainText("Grace · due 2027-02-20");
  if (shots) await page.screenshot({ path: `${shots}/ai-summary-light.png`, fullPage: true });

  await page.getByLabel("Select: Sign the Mill & Co. supply contract").check();
  await page.getByLabel("Select: Post the weekend baker job ad").check();
  await page.getByRole("button", { name: "Create 2 tasks" }).click();
  await expect(page.getByText("2 tasks created")).toBeVisible();

  await page.goto("/m/ai/summaries");
  await expect(page.getByRole("table", { name: "Summaries" })).toContainText("2 (2 as tasks)");
  if (shots) {
    await page.addInitScript(() => localStorage.setItem("office.theme", "dark"));
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shots}/ai-summaries-dark.png` });
  }

  await page.goto("/");
  const open = page.getByRole("list", { name: "Open tasks" });
  await expect(open).toContainText("Sign the Mill & Co. supply contract");
  await page.getByLabel("Mark done: Post the weekend baker job ad").check();
  await expect(open).not.toContainText("Post the weekend baker job ad");
  if (shots) await page.screenshot({ path: `${shots}/home-open-tasks-light.png` });
});

test("summaries on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/m/ai/summaries");
  await page.getByRole("table", { name: "Summaries" }).getByText("Weekly ops sync").click();
  await expect(page.getByRole("heading", { name: "Weekly ops sync" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) await page.screenshot({ path: `${shots}/ai-summary-mobile.png`, fullPage: true });
});

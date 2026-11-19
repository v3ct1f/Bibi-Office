import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs last: earlier specs filled Acme Bakery with invoices, deals, expenses, bookings, tickets, stock and signed documents.
test.describe.configure({ mode: "serial" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const kpis = (page: Page) => page.getByRole("list", { name: "KPIs" });

test("KPI dashboard: enable, see live numbers from other modules, change the period", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable KPI dashboard" }).click();
  await expect(page.getByRole("switch", { name: "Disable KPI dashboard" })).toBeChecked();
  await nav(page).getByRole("link", { name: "KPIs" }).click();
  await expect(page.getByRole("heading", { name: "KPIs" })).toBeVisible();

  const list = kpis(page);
  await expect(list.getByRole("heading", { name: "Payments received" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Open tickets" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Items to reorder" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Waiting for signatures" })).toBeVisible();
  await expect(list.getByRole("img", { name: /Payments received, \d+ points/ })).toBeVisible();
  await expect(page.getByText(/compared with/)).toBeVisible();
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) await page.screenshot({ path: `${shots}/kpi-overview-light.png` });

  await page.getByLabel("Period").selectOption("last_12m");
  await expect(list.getByRole("img", { name: "Payments received, 12 points" })).toBeVisible();
  await page.getByLabel("Period").selectOption("custom");
  await page.getByLabel("From").fill("2026-01-01");
  await expect(page.getByText(/1 Jan 2026|Jan 1, 2026/).first()).toBeVisible();
});

test("arrange: add a number with a target, reorder, save, new dashboard", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/kpi/dashboards");
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add a number" }).click();
  const dlg = page.getByRole("dialog", { name: "Add a number" });
  await dlg.getByLabel("Number").selectOption({ label: "Win rate" });
  await dlg.getByLabel("Show as").selectOption("line");
  await dlg.getByRole("button", { name: "Add" }).click();

  const tile = kpis(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Win rate" }) });
  await tile.getByLabel("Target").fill("50");
  await tile.getByRole("button", { name: "Move earlier" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
  await expect(kpis(page).getByText("Target 50%")).toBeVisible();

  await page.reload();
  await expect(kpis(page).getByText("Target 50%")).toBeVisible();

  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "New dashboard" }).click();
  const nd = page.getByRole("dialog", { name: "New dashboard" });
  await nd.getByLabel("Name").fill("Sales");
  await nd.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("tab", { name: "Sales" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("No numbers on this dashboard")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(kpis(page).getByText("Target 50%")).toBeVisible();
});

test("home widget and dark theme, phone layout", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "KPIs this month" })).toBeVisible();
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) {
    await page.addInitScript(() => localStorage.setItem("office.theme", "dark"));
    await page.goto("/m/kpi/dashboards");
    await expect(kpis(page).getByRole("heading", { name: "Payments received" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shots}/kpi-overview-dark.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/m/kpi/dashboards");
  await expect(kpis(page).getByRole("heading", { name: "Payments received" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (shots) await page.screenshot({ path: `${shots}/kpi-mobile.png`, fullPage: true });
});

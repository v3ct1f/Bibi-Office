import { test } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Docs only: SCREENSHOTS_DIR=/path pnpm e2e  (runs after the admin flow has created data)
const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "set SCREENSHOTS_DIR to capture screenshots");
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

test("capture", async ({ page }) => {
  await signIn(page);
  for (const [path, name, theme] of [
    ["/contacts", "contacts-light", "light"], ["/admin/workflows", "workflows-list-light", "light"],
    ["/admin/audit", "audit-dark", "dark"], ["/admin/roles", "roles-dark", "dark"],
    ["/m/invoicing/invoices", "invoices-light", "light"], ["/", "dashboard-dark", "dark"],
    ["/m/crm/deals", "deals-board-light", "light"], ["/companies", "companies-dark", "dark"],
  ] as const) {
    await page.addInitScript((t) => localStorage.setItem("office.theme", t), theme);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  await page.goto("/admin/workflows");
  await page.getByRole("link", { name: "Follow up new contacts" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/workflow-editor-dark.png`, fullPage: true });
  await page.addInitScript(() => localStorage.setItem("office.theme", "light"));
  await page.goto("/m/invoicing/invoices");
  await page.getByRole("link", { name: /^INV-/ }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/invoice-detail-light.png`, fullPage: true });
  await page.goto("/m/invoicing/invoices/new");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/invoice-new-light.png`, fullPage: true });
  await page.goto("/m/crm/deals");
  await page.getByRole("tab", { name: "List" }).click();
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("cell", { name: "Catering contract" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/deal-detail-light.png`, fullPage: true });
  await page.goto("/companies");
  await page.getByRole("link", { name: "Globex Corp" }).click();
  await page.getByRole("tab", { name: "Activity" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/company-activity-light.png`, fullPage: true });
});

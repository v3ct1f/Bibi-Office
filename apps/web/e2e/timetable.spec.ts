import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after spend.spec.ts (alice owns "Acme Bakery" at /p/acme-bakery; contacts Ada and Grace exist).
test.describe.configure({ mode: "serial" });
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

test("scheduling: enable, add a service, set working hours", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Scheduling" }).click();
  await expect(page.getByRole("switch", { name: "Disable Scheduling" })).toBeChecked();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calendar" }).click();

  await page.getByRole("tab", { name: "Services" }).click();
  await page.getByRole("button", { name: "New service" }).click();
  const dlg = page.getByRole("dialog", { name: "New service" });
  await dlg.getByLabel("Name").fill("Cake tasting");
  await dlg.getByLabel("Length (minutes)").fill("30");
  await dlg.getByLabel("Location (optional)").fill("Acme Bakery, Main St 1");
  await dlg.getByRole("checkbox", { name: "alice" }).check();
  await dlg.getByRole("button", { name: "Create service" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("cell", { name: "Cake tasting" })).toBeVisible();
  await expect(page.getByRole("link", { name: /\/p\/acme-bakery\/scheduling\/book$/ })).toBeVisible();

  await page.getByRole("tab", { name: "My hours" }).click();
  for (const d of WEEK) {
    await page.getByRole("switch", { name: d }).click();
    await page.getByLabel(`${d} from`).fill("08:00");
    await page.getByLabel(`${d} until`).fill("20:00");
  }
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

let manageUrl = "";
test("public: a signed-out customer books a time", async ({ page }) => {
  await page.goto("/p/acme-bakery/scheduling/book");
  await expect(page.getByRole("heading", { name: "Book an appointment" })).toBeVisible();
  await page.getByRole("link", { name: /Cake tasting/ }).click();
  await expect(page.getByRole("heading", { name: "Cake tasting" })).toBeVisible();
  await expect(page.getByText(/Times are in UTC/)).toBeVisible();
  await page.getByRole("tabpanel").or(page.locator("main")).getByRole("button", { name: /^\d{2}:\d{2}/ }).first().click();
  await page.getByLabel("Your name").fill("Hedy Lamarr");
  await page.getByLabel("Email").fill("hedy@example.com");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await expect(page.getByText("For Hedy Lamarr")).toBeVisible();
  manageUrl = page.url();
  expect(manageUrl).toMatch(/\/p\/acme-bakery\/scheduling\/book\/booking\/[0-9a-f-]{36}#[\w-]{43}$/);
});

test("team: the booking shows up; book for a contact", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/scheduling/calendar");
  const hedy = page.getByRole("button", { name: /Hedy Lamarr/ });
  await expect(page.getByRole("region").first()).toBeVisible();   // agenda loaded
  if (!(await hedy.isVisible())) await page.getByRole("button", { name: "Next week" }).click();
  await hedy.click();
  const dlg = page.getByRole("dialog", { name: "Hedy Lamarr" });
  await expect(dlg.getByText("Online by the customer")).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).first().click();

  await page.getByRole("button", { name: "New booking" }).click();
  const nb = page.getByRole("dialog", { name: "New booking" });
  await nb.getByLabel("Service").selectOption({ label: "Cake tasting (30 min)" });
  await nb.getByRole("button", { name: /^\d{2}:\d{2}/ }).nth(2).click();
  await nb.getByLabel("Contact").selectOption({ label: "Ada" });
  await nb.getByRole("button", { name: "Book" }).click();
  await expect(nb).toBeHidden();
  await page.getByRole("button", { name: "This week" }).click();
  const ada = page.getByRole("button", { name: /Ada/ });
  await expect(page.getByRole("region").first()).toBeVisible();
  if (!(await ada.isVisible())) await page.getByRole("button", { name: "Next week" }).click();
  await expect(ada).toBeVisible();
});

test("public: the customer cancels with their private link", async ({ page }) => {
  await page.goto(manageUrl);
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  await page.goto(manageUrl.replace(/#.*/, "#" + "x".repeat(43)));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Booking not found" })).toBeVisible();
});

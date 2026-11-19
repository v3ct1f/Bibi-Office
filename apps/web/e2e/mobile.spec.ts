import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test("mobile: menu, no horizontal scroll, dark theme", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await page.getByRole("button", { name: /Theme/ }).click(); // system -> light
  await page.getByRole("button", { name: /Theme/ }).click(); // light -> dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

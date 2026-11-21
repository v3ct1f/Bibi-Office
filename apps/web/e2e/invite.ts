import { expect, type Browser, type Page } from "@playwright/test";

/**
 * The owner (on Settings → Members) invites someone, then that person opens the link in their own
 * browser, signs in with the invited address and accepts. Returns once they are in the workspace.
 */
export async function inviteAndJoin(owner: Page, browser: Browser, email: string, name: string, roles: { tick?: string[]; untick?: string[] } = {}) {
  await owner.getByRole("button", { name: "Invite people" }).click();
  const d = owner.getByRole("dialog");
  await d.getByLabel("Email").fill(email);
  for (const r of roles.untick ?? []) await d.getByRole("checkbox", { name: r }).click();
  for (const r of roles.tick ?? []) await d.getByRole("checkbox", { name: r }).click();
  await d.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(d.getByRole("status")).toContainText(email);
  const link = (await d.locator("code").textContent())!.trim();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(owner.getByRole("list", { name: "Open invitations" })).toContainText(email);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Join / })).toBeVisible();
  await page.getByRole("button", { name: "Accept and join" }).click();
  await expect(page.getByRole("heading", { name: `Welcome back, ${name.split(" ")[0]}` })).toBeVisible();
  await ctx.close();
  await owner.reload();
}

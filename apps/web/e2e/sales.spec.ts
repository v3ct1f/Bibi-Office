import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after admin.spec.ts and invoicing.spec.ts (alice owns "Acme Bakery"; contacts Ada, Grace).
test.describe.configure({ mode: "serial" });

test("companies: create and open", async ({ page }) => {
  await signIn(page);
  await page.goto("/companies");
  await page.getByRole("button", { name: "New company" }).click();
  const dlg = page.getByRole("dialog", { name: "New company" });
  await dlg.getByLabel("Name").fill("Globex Corp");
  await dlg.getByLabel("City").fill("Springfield");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(dlg).toBeHidden();
  await page.getByRole("link", { name: "Globex Corp" }).click();
  await expect(page.getByRole("heading", { name: "Globex Corp" })).toBeVisible();
  await expect(page.getByText("Springfield")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Invoices" })).toBeVisible(); // invoicing adds a company tab
});

test("crm: enable, create deal, move it on the board, log a task, win", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable CRM" }).click();
  await expect(page.getByRole("switch", { name: "Disable CRM" })).toBeChecked();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Deals" }).click();
  for (const s of ["Lead", "Qualified", "Proposal", "Negotiation"]) await expect(page.getByRole("region", { name: s })).toBeVisible();
  await page.getByRole("button", { name: "New deal" }).click();
  const dlg = page.getByRole("dialog", { name: "New deal" });
  await dlg.getByLabel("Title").fill("Catering contract");
  await dlg.getByLabel("Value").fill("12000");
  await dlg.getByLabel("Company").selectOption({ label: "Globex Corp" });
  await dlg.getByRole("button", { name: "Create deal" }).click();

  await expect(page.getByRole("heading", { name: "Catering contract" })).toBeVisible();
  await expect(page.getByText("€12,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Proposal" }).click();
  await expect(page.getByRole("button", { name: "Proposal" })).toHaveAttribute("aria-current", "step");

  await page.getByLabel("Type").selectOption("task");
  await page.getByLabel("Subject").fill("Send tasting menu");
  await page.getByRole("button", { name: "Add task" }).click();
  const task = page.getByRole("checkbox", { name: "Done: Send tasting menu" });
  await expect(task).not.toBeChecked();
  await task.click();
  await expect(task).toBeChecked();

  // drag on the board back to Qualified
  await page.getByRole("link", { name: "← Deals" }).click();
  await page.getByRole("region", { name: "Proposal" }).getByRole("link", { name: /Catering contract/ })
    .dragTo(page.getByRole("region", { name: "Qualified" }));
  await expect(page.getByRole("region", { name: "Qualified" }).getByRole("link", { name: /Catering contract/ })).toBeVisible();

  await page.getByRole("link", { name: /Catering contract/ }).click();
  await page.getByRole("button", { name: "Mark won" }).click();
  await expect(page.getByText("Won", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Won this month (1)")).toBeVisible();

  await page.goto("/companies");
  await page.getByRole("link", { name: "Globex Corp" }).click();
  await page.getByRole("tab", { name: "Deals" }).click();
  await expect(page.getByRole("cell", { name: "Catering contract" })).toBeVisible();

  // leave a couple of open deals on the board
  await page.goto("/m/crm/deals");
  for (const [stage, title, value] of [["Proposal", "Wedding season supply", "8500"], ["Lead", "Office breakfast weekly", "2400"]] as const) {
    await page.getByRole("region", { name: stage }).getByRole("button", { name: "+ Add deal" }).click();
    const d = page.getByRole("dialog", { name: "New deal" });
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("Value").fill(value);
    await d.getByRole("button", { name: "Create deal" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.goto("/m/crm/deals");
  }
  await expect(page.getByRole("region", { name: "Proposal" }).getByRole("link", { name: /Wedding season supply/ })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

test("first sign-in creates an organization", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Acme Bakery");
  await expect(page.getByLabel("URL name")).toHaveValue("acme-bakery");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Acme Bakery" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toBeVisible();
});

test("contacts: create, search, open", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts");
  await expect(page.getByText("No contacts yet")).toBeVisible();
  for (const [first, email] of [["Ada", "ada@example.org"], ["Grace", "grace@example.org"]]) {
    await page.getByRole("button", { name: "New contact" }).click();
    const dlg = page.getByRole("dialog", { name: "New contact" });
    await dlg.getByLabel("First name").fill(first!);
    await dlg.getByLabel("Email").fill(email!);
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(dlg).toBeHidden();
  }
  await expect(page.getByRole("link", { name: "Ada" })).toBeVisible();
  await page.getByLabel("Search contacts").fill("grace");
  await expect(page.getByRole("link", { name: "Ada" })).toBeHidden();
  await page.getByRole("link", { name: "Grace" }).click();
  await expect(page.getByRole("heading", { name: "Grace" })).toBeVisible();
  await expect(page.getByText("grace@example.org")).toBeVisible();
});

test("validation errors from the API are shown", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "New contact" }).click();
  const dlg = page.getByRole("dialog", { name: "New contact" });
  await dlg.getByLabel("Phone").fill("123");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(dlg.getByRole("alert")).toContainText("firstName, lastName or email required");
});

test("workflow: build and save", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/workflows");
  await page.getByRole("link", { name: "New workflow" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Follow up new contacts");
  await page.getByLabel("Event").selectOption("core.contact.created");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 1 action").selectOption("core.create_task");
  await page.getByLabel("Input (JSON)").fill('{ "title": "Call {{payload.firstName}}", "dueInDays": 2 }');
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Recent runs")).toBeVisible();
  await page.goto("/admin/workflows");
  await expect(page.getByRole("link", { name: "Follow up new contacts" })).toBeVisible();
});

test("workflow: bad conditions show the API error", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/workflows/new");
  await page.getByLabel("Name", { exact: true }).fill("Broken");
  await page.getByLabel("Event").selectOption("core.contact.created");
  await page.getByLabel("Conditions (JSONLogic)").fill('{"nope_op": [1]}');
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Input (JSON)").fill('{"title": "x"}');
  await page.getByLabel("Step 1 action").selectOption("core.create_task");
  await page.getByLabel("Input (JSON)").fill('{"title": "x"}');
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid conditions");
});

test("roles, API key shown once, audit chain", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/roles");
  await page.getByRole("button", { name: "New role" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("Sales");
  await dlg.getByLabel("Key", { exact: true }).fill("sales");
  await dlg.getByLabel("contacts.read", { exact: true }).check();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText("1 permission(s)")).toBeVisible();

  await page.goto("/admin/api-keys");
  await page.getByRole("button", { name: "New key" }).click();
  const k = page.getByRole("dialog");
  await k.getByLabel("Name", { exact: true }).fill("Zapier");
  await k.getByLabel("core:contacts.read").check();
  await k.getByRole("button", { name: "Create" }).click();
  await expect(k.getByRole("textbox", { name: "API key" })).toHaveValue(/^ok_[0-9a-f]{32}_/);
  await k.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("cell", { name: "Zapier" })).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByText("Chain intact")).toBeVisible();
  await expect(page.getByText("apikey.created")).toBeVisible();
  await expect(page.getByText("role.created")).toBeVisible();
});

test("other users can't see the organization", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible();
});

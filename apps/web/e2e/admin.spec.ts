import { expect, test, type Browser, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function newUser(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, name);
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

let alice: Page;
let slug: string;

test.beforeAll(async ({ browser }) => {
  // Bob signs in once first so Alice can add him (email invites are a later session).
  const bob = await newUser(browser, "bob@example.com", "Bob Builder");
  await expect(bob.page.getByText("Set up your workspace")).toBeVisible();
  await bob.ctx.close();
  alice = (await newUser(browser, "alice@example.com", "Alice Example")).page;
});

test("onboarding creates a workspace and lands on the dashboard", async () => {
  await expect(alice.getByText("Set up your workspace")).toBeVisible();
  await alice.getByLabel("Company name").fill("Acme Ltd");
  await expect(alice.getByLabel("Workspace URL")).toHaveValue("acme-ltd");
  await alice.getByRole("button", { name: "Create workspace" }).click();
  await expect(alice.getByRole("heading", { name: "Welcome back, Alice" })).toBeVisible();
  slug = new URL(alice.url()).pathname.split("/")[2]!;
  expect(slug).toBe("acme-ltd");
  await expect(alice.getByText("Get set up")).toBeVisible();
});

test("contacts: create, open detail, search, activity", async () => {
  await alice.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Contacts" }).click();
  await expect(alice.getByText("No contacts yet")).toBeVisible();
  await alice.getByRole("button", { name: "New contact" }).first().click();
  await alice.getByLabel("First Name").fill("Ann");
  await alice.getByLabel("Last Name").fill("Lee");
  await alice.getByLabel("Email").fill("ann@client.com");
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByRole("heading", { name: "Ann Lee" })).toBeVisible();
  await alice.getByRole("tab", { name: "Activity" }).click();
  await expect(alice.getByText("contact.created")).toBeVisible();

  await alice.getByRole("link", { name: "Contacts" }).first().click();
  await alice.getByRole("button", { name: "New contact" }).click();
  await alice.getByLabel("First Name").fill("Zed");
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByRole("heading", { name: "Zed" })).toBeVisible();
  await alice.getByRole("link", { name: "Contacts" }).first().click();
  await alice.getByLabel("Search contacts").fill("ann");
  await expect(alice.getByRole("cell", { name: "Ann Lee", exact: true })).toBeVisible();
  await expect(alice.getByRole("cell", { name: "Zed", exact: true })).toHaveCount(0);
});

test("tasks: global New menu, then mark done", async () => {
  await alice.getByRole("button", { name: "New", exact: true }).click();
  await alice.getByRole("menuitem", { name: "Task" }).click();
  await expect(alice.getByRole("dialog", { name: "New task" })).toBeVisible();
  await alice.getByLabel("Title").fill("Call Ann");
  await alice.getByLabel("Priority").fill("3");
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByRole("cell", { name: "Call Ann", exact: true })).toBeVisible();
  await alice.getByRole("checkbox", { name: "Done" }).click();
  await expect(alice.getByText("Done", { exact: true })).toBeVisible();
});

test("workflow builder: trigger, condition, templated action", async () => {
  await alice.getByRole("link", { name: "Workflows" }).click();
  await alice.getByRole("link", { name: "New workflow" }).first().click();
  await alice.getByLabel("Workflow name").fill("Follow up new contacts");
  await alice.getByLabel("Trigger event").selectOption("core.contact.created");
  await alice.getByRole("button", { name: "Add condition" }).click();
  await alice.getByLabel("Condition 1 field").fill("payload.email");
  await alice.getByLabel("Condition 1 operator").selectOption("exists");
  await alice.getByRole("button", { name: "Add action" }).click();
  await alice.getByLabel("Step 1 action").selectOption("core.create_task");
  await alice.getByLabel("Title").fill("Follow up {{payload.firstName}}");
  await alice.getByLabel("Due In Days").fill("2");
  await alice.getByRole("button", { name: "Create workflow" }).click();
  await expect(alice.getByText("Workflow created")).toBeVisible();
  await expect(alice.getByRole("tab", { name: "Runs" })).toBeVisible();

  // Round-trip: reload shows the saved definition in the simple editor.
  await alice.reload();
  await expect(alice.getByLabel("Condition 1 field")).toHaveValue("payload.email");
  await expect(alice.getByLabel("Title")).toHaveValue("Follow up {{payload.firstName}}");
  await alice.getByRole("link", { name: "Workflows" }).first().click();
  await expect(alice.getByRole("cell", { name: "Follow up new contacts", exact: true })).toBeVisible();
});

test("settings: webhook secret and API key are shown once", async () => {
  await alice.goto(`/t/${slug}/settings/webhooks`);
  await alice.getByRole("button", { name: "Add endpoint" }).click();
  await alice.getByLabel("URL").fill("https://example.com/hooks/office");
  await alice.getByRole("button", { name: "+ core.*" }).click();
  await alice.getByRole("button", { name: "Save" }).click();
  await expect(alice.getByRole("dialog", { name: "Signing secret" }).getByText(/^whsec_/)).toBeVisible();
  await alice.getByRole("button", { name: "Done" }).click();
  await expect(alice.getByText("https://example.com/hooks/office")).toBeVisible();

  await alice.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "API keys" }).click();
  await alice.getByRole("button", { name: "Create key" }).click();
  await alice.getByLabel("Name").fill("Accounting sync");
  await alice.getByRole("checkbox", { name: "core:contacts.read" }).click();
  await alice.getByRole("button", { name: "Create key" }).last().click();
  await expect(alice.getByRole("dialog", { name: "Copy your API key" }).getByText(/^ok_[0-9a-f]{32}_/)).toBeVisible();
  await alice.getByRole("button", { name: "I’ve stored it" }).click();
  await expect(alice.getByRole("cell", { name: "Accounting sync", exact: true })).toBeVisible();
});

test("roles + members: custom role, add Bob", async () => {
  await alice.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Roles" }).click();
  await alice.getByRole("button", { name: "New role" }).click();
  await alice.getByLabel("Name").fill("Sales");
  await alice.getByRole("textbox", { name: "Key" }).fill("sales");
  await alice.getByRole("checkbox", { name: "core:contacts.read" }).click();
  await alice.getByRole("checkbox", { name: "core:contacts.write" }).click();
  await alice.getByRole("button", { name: "Save role" }).click();
  await expect(alice.getByText("Role saved")).toBeVisible();

  await alice.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Members" }).click();
  await alice.getByRole("button", { name: "Add member" }).click();
  await alice.getByLabel("Email").fill("bob@example.com");
  await alice.getByRole("checkbox", { name: "Member" }).click(); // untick default
  await alice.getByRole("checkbox", { name: "Sales" }).click();
  await alice.getByRole("button", { name: "Add member" }).last().click();
  await expect(alice.getByRole("cell", { name: /Bob Builder/ })).toBeVisible();
});

test("audit log shows changes and verifies the hash chain", async () => {
  await alice.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Audit log" }).click();
  await expect(alice.getByText("member.added")).toBeVisible();
  await alice.getByRole("button", { name: "Verify integrity" }).click();
  await expect(alice.getByText("Chain intact")).toBeVisible();
});

test("Bob (Sales role) only sees what he may use", async ({ browser }) => {
  const { ctx, page } = await newUser(browser, "bob@example.com", "Bob Builder");
  await expect(page.getByRole("heading", { name: "Welcome back, Bob" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Tasks" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Workflows" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto(`/t/${slug}/settings/audit`);
  await expect(page.getByText("No access")).toBeVisible();
  await page.goto(`/t/${slug}/contacts`);
  await expect(page.getByRole("cell", { name: "Ann Lee", exact: true })).toBeVisible();
  await page.goto("/t/not-my-workspace");
  await expect(page.getByText("Workspace not found")).toBeVisible();
  await ctx.close();
});

test("sign out returns to the sign-in screen", async () => {
  await alice.goto(`/t/${slug}`);
  await alice.getByRole("button", { name: "Account menu" }).click();
  await alice.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(alice.getByRole("button", { name: "Sign in" })).toBeVisible();
});

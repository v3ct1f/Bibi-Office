import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
let slug: string;
const nav = () => page.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Name").fill("Sam Seller");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Pipeline Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();
  slug = new URL(page.url()).pathname.split("/")[2]!;
});

test("enable CRM and Invoicing", async () => {
  await nav().getByRole("link", { name: "Add features" }).click();
  await page.getByRole("button", { name: "Add CRM" }).click();
  await expect(page.getByRole("button", { name: "Remove CRM" })).toBeVisible();
  await page.getByRole("button", { name: "Add Invoicing" }).click();
  await expect(page.getByRole("button", { name: "Remove Invoicing" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "Deals" })).toBeVisible();
});

test("add a deal for a company", async () => {
  await page.goto(`/t/${slug}/companies`);
  await page.getByRole("button", { name: "New company" }).first().click();
  await page.getByLabel("Name").fill("Umbrella Corp");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Umbrella Corp" })).toBeVisible();

  await nav().getByRole("link", { name: "Deals" }).click();
  await expect(page.getByText("No deals yet")).toBeVisible();
  await expect(page.getByText("3. Win (or lose) it")).toBeVisible();
  await page.getByRole("button", { name: "New deal" }).first().click();
  await page.getByLabel("Deal name").fill("Security audit");
  await page.getByLabel("Company search").fill("umbr");
  await page.getByRole("option", { name: /Umbrella Corp/ }).click();
  await expect(page.getByTestId("selected-company")).toHaveText("Umbrella Corp");
  await page.getByLabel("Value").fill("4000");
  await page.getByLabel("Next step", { exact: true }).fill("Send proposal");
  await page.getByRole("button", { name: "Add deal" }).first().click();
  await expect(page.getByText("Deal added")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Security audit/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("Deal created in Lead");
  await expect(page.getByText("Next step: Send proposal")).toBeVisible();
});

test("log a call and move the deal along the stage bar", async () => {
  await page.getByRole("tab", { name: "Call" }).click();
  await page.getByLabel("Activity").fill("Spoke to the CISO, wants a quote by Friday");
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("Spoke to the CISO");

  await page.getByRole("list", { name: "Stages" }).getByRole("button", { name: "Proposal sent" }).click();
  await expect(page.getByText("Moved to Proposal sent")).toBeVisible();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("Moved from Lead to Proposal sent");
});

test("board shows the deal; moving it there works too", async () => {
  await nav().getByRole("link", { name: "Deals" }).click();
  const column = page.getByRole("region", { name: "Proposal sent" });
  await expect(column.getByTestId("deal-card")).toContainText("Security audit");
  await expect(column).toContainText("1");
  await page.getByLabel("Move Security audit").selectOption({ label: "Stage: Negotiation" });
  await expect(page.getByText("Moved to Negotiation")).toBeVisible();
  await expect(page.getByRole("region", { name: "Negotiation" }).getByTestId("deal-card")).toContainText("Security audit");
});

test("win the deal: a draft invoice appears in Invoicing", async () => {
  await page.getByRole("button", { name: "Security audit" }).click();
  await page.getByRole("button", { name: "Mark as won" }).click();
  await expect(page.getByText("Deal won 🎉")).toBeVisible();
  await expect(page.getByTestId("won-callout")).toContainText("draft invoice was created");

  // The worker handles crm.deal.won asynchronously; poll the Drafts list.
  await expect(async () => {
    await page.goto(`/t/${slug}/m/invoicing/invoices?status=draft`);
    await expect(page.getByRole("cell", { name: "Umbrella Corp" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("€4,000.00").first()).toBeVisible();
});

test("lose a second deal with a reason; company tab and dashboard", async () => {
  await page.goto(`/t/${slug}/companies`);
  await page.getByRole("cell", { name: "Umbrella Corp", exact: true }).click();
  await page.getByRole("tab", { name: "Deals" }).click();
  await expect(page.getByRole("cell", { name: "Security audit" })).toBeVisible();
  await page.getByRole("button", { name: "New deal" }).click();
  await expect(page.getByTestId("selected-company")).toHaveText("Umbrella Corp");
  await page.getByLabel("Deal name").fill("Pen test");
  await page.getByLabel("Value").fill("2500");
  await page.getByRole("button", { name: "Add deal" }).first().click();
  await expect(page.getByRole("heading", { name: /Pen test/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark as lost" }).click();
  await page.getByRole("dialog").getByLabel("Reason (optional)").selectOption("Price too high");
  await page.getByRole("dialog").getByRole("button", { name: "Mark as lost" }).click();
  await expect(page.getByText("Lost on")).toContainText("Price too high");
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Moved to Lead")).toBeVisible();

  await nav().getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("pipeline-EUR")).toContainText("2,500.00");
});

test("pipeline settings: rename a stage", async () => {
  await nav().getByRole("link", { name: "Deals" }).click();
  await page.getByRole("button", { name: "Pipeline settings" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline settings" })).toBeVisible();
  await page.getByLabel("Stage 1 name").fill("New lead");
  await page.getByRole("button", { name: "Save pipeline" }).click();
  await expect(page.getByText("Pipeline saved")).toBeVisible();
  await page.getByRole("link", { name: "Deals" }).first().click();
  await expect(page.getByRole("region", { name: "New lead" })).toContainText("Pen test");
});

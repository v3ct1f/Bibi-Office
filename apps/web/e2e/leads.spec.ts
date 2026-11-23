import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
let slug: string;
const nav = () => page.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("lena@example.com");
  await page.getByLabel("Name").fill("Lena Leads");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Lead Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Lena" })).toBeVisible();
  slug = new URL(page.url()).pathname.split("/")[2]!;
});

test("turn on Leads and CRM", async () => {
  await nav().getByRole("link", { name: "Add features" }).click();
  await page.getByRole("button", { name: "Add Leads" }).click();
  await expect(page.getByRole("button", { name: "Remove Leads" })).toBeVisible();
  await page.getByRole("button", { name: "Add CRM" }).click();
  await expect(page.getByRole("button", { name: "Remove CRM" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "Leads" })).toBeVisible();
});

test("add a lead by hand", async () => {
  await nav().getByRole("link", { name: "Leads" }).click();
  await expect(page.getByText("No leads to work on")).toBeVisible();
  await page.getByRole("button", { name: "New lead" }).first().click();
  await page.getByLabel("First name").fill("Michael");
  await page.getByLabel("Last name").fill("Bolton");
  await page.getByLabel("Email").fill("michael@initrode.test");
  await page.getByLabel("Company", { exact: true }).fill("Initrode");
  await page.getByLabel("Where they came from").selectOption("event");
  await page.getByRole("button", { name: "Add lead" }).first().click();
  await expect(page.getByText("Lead added", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Michael Bolton/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("Lead added (Event)");
});

test("logging a call marks the lead as contacted, then qualify it", async () => {
  await page.getByLabel("Activity").fill("Interested in 5 licences, call back next week");
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("New → Contacted");
  await expect(page.getByRole("button", { name: "Contacted" })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Qualified" }).click();
  await expect(page.getByText("Marked as qualified")).toBeVisible();
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("Contacted → Qualified");
});

test("convert into a customer with a deal in CRM", async () => {
  await page.getByRole("button", { name: "Convert to customer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Create company")).toBeChecked();
  await expect(dialog.getByLabel("Create deal")).toBeChecked();
  await dialog.getByLabel("Deal name").fill("Initrode licences");
  await dialog.getByLabel(/Value/).fill("2500");
  await dialog.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByTestId("converted-callout")).toBeVisible();

  await page.getByRole("link", { name: "Open contact" }).click();
  await expect(page.getByRole("heading", { name: /Michael Bolton/ })).toBeVisible();
  // The worker hands the conversion to CRM, which opens the deal.
  await expect(async () => {
    await page.goto(`/t/${slug}/m/crm/deals`);
    await expect(page.getByText("Initrode licences")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
});

test("the web form turns visitors into leads", async ({ browser }) => {
  await page.goto(`/t/${slug}/m/leads/form`);
  await expect(page.getByRole("main").getByText("The form is off")).toBeVisible();
  await page.getByLabel("Form on").click();
  await expect(page.getByRole("main").getByText("The form is on")).toBeVisible();
  const url = (await page.locator("code").first().innerText()).trim();
  expect(url).toContain(`/leads/form/`);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  await expect(visitor.getByRole("heading", { name: "Get in touch" })).toBeVisible();
  await visitor.getByLabel("Your name").fill("Samir Nagheenanajar");
  await visitor.getByLabel("Email").fill("samir@initech.test");
  await visitor.getByLabel("How can we help?").fill("We need a new printer contract");
  await visitor.getByRole("button", { name: "Send" }).click();
  await expect(visitor.getByRole("status")).toContainText("Thanks! We'll be in touch soon.");
  await visitor.context().close();

  await page.goto(`/t/${slug}/m/leads/leads`);
  await page.getByRole("cell", { name: /Samir Nagheenanajar/ }).click();
  await expect(page.getByText("We need a new printer contract")).toBeVisible();
  await expect(page.getByText("Web form", { exact: true })).toBeVisible();
});

test("disqualify a lead and reopen it", async () => {
  await page.getByRole("button", { name: "Disqualify" }).click();
  await page.getByRole("dialog").getByLabel("Reason (optional)").selectOption("Not a good fit");
  await page.getByRole("dialog").getByRole("button", { name: "Disqualify" }).click();
  await expect(page.getByText("Disqualified: Not a good fit.")).toBeVisible();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Contacted" })).toHaveAttribute("aria-current", "step");
});

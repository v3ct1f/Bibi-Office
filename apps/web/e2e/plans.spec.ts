import { expect, test, type Page } from "@playwright/test";

/** Plans: the public plans page, signing up with a demo payment (no Stripe here), and switching plan inside the app. */
test.describe.configure({ mode: "serial" });

const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });

test("the public plans page shows the three plans; a visitor chooses one, pays on the demo page and creates their business", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "Your whole back office, in one place" })).toBeVisible();
  const starter = page.getByTestId("plan-starter"), business = page.getByTestId("plan-business"), complete = page.getByTestId("plan-complete");
  await expect(starter).toContainText("€29");
  await expect(starter).toContainText("Up to 15 people");
  await expect(business).toContainText("€79");
  await expect(business).toContainText("Up to 30 people");
  await expect(complete).toContainText("€149");
  await expect(complete).toContainText("Up to 60 people");
  await expect(complete).toContainText("API keys and webhooks");
  await expect(starter).not.toContainText("Expenses");
  await expect(business).toContainText("Everything in Starter, plus:");

  await page.getByRole("button", { name: /^Yearly/ }).click();
  // Yearly shows a monthly price first, with the year's total in small print.
  await expect(starter).toContainText("€24.17 per month");
  await expect(starter).toContainText("€290 in total by the end of the year");
  await expect(business).toContainText("€65.83 per month");
  await expect(complete).toContainText("€124.17 per month");
  await expect(complete).toContainText("€1,490 in total");
  await expect(starter).not.toContainText("per year");

  await business.getByRole("button", { name: "Choose Business" }).click();
  await expect(page).toHaveURL(/\/start\?plan=business&interval=yearly/);
  await expect(page.getByTestId("chosen-plan")).toContainText("Business plan");
  await expect(page.getByTestId("chosen-plan")).toContainText("nothing is charged");
  await expect(page.getByLabel("Business name")).toHaveCount(0);   // asked later, after the account is made
  const go = page.getByRole("button", { name: "Continue to payment" });
  await expect(go).toBeDisabled();
  await page.getByLabel("Your email").fill("baker@example.com");
  await page.getByRole("checkbox", { name: /business or professional use/ }).click();
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).click();
  await go.click();

  // The demo checkout page: plan and price from the same plan list, no card fields.
  await expect(page).toHaveURL(/\/start\/demo-pay\//);
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
  const order = page.getByTestId("demo-order");
  await expect(order).toContainText("Business");
  await expect(order).toContainText("€65.83 per month for a year (€790 in total)");
  await expect(order).toContainText("baker@example.com");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Pay (demo, no real money)" }).click();
  await expect(page.getByRole("heading", { name: "Demo payment received" })).toBeVisible();
  await expect(page.getByText("Nothing was charged")).toBeVisible();

  // The payer signs in with that email and creates their business, which starts on the Business plan.
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("baker@example.com");
  await page.getByLabel("Name").fill("Bo Baker");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Create your business" })).toBeVisible();
  await page.getByLabel("Business name").fill("Test Bakery");
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page).toHaveURL(/\/t\/test-bakery/);
  await page.goto("/t/test-bakery/settings/plan");
  await expect(page.getByText(/Business/).first()).toBeVisible();
});

test("cancelling on the demo checkout page goes back to the sign-up with the plan still chosen", async ({ page }) => {
  await page.goto("/start?plan=starter&interval=monthly");
  await page.getByLabel("Your email").fill("maybe.later@example.com");
  await page.getByRole("checkbox", { name: /business or professional use/ }).click();
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByTestId("demo-order")).toContainText("€29 per month");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/start\?plan=starter&interval=monthly/);
  await expect(page.getByTestId("chosen-plan")).toContainText("Starter plan");
});

test("opening the sign-up without a plan goes to the plans page", async ({ page }) => {
  await page.goto("/start");
  await expect(page).toHaveURL(/\/plans$/);
});

test("an owner sees the plan, upgrades and downgrades, and the features follow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("pia.plan@example.com");
  await page.getByLabel("Name").fill("Pia Plan");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Plan Cafe");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Pia" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Plan" }).click();
  await expect(page.getByTestId("current-plan")).toContainText("No plan chosen");

  // Choose Starter: only invoicing, leads and CRM stay available.
  await page.getByTestId("choose-starter").click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm switch" }).click();
  const cur = page.getByTestId("current-plan");
  await expect(cur).toContainText("Starter plan");
  await expect(cur).toContainText("Test payment, nothing charged");
  await expect(cur).toContainText("1 of 15 people used");

  await nav(page).getByRole("link", { name: "Add features" }).click();
  await expect(page.getByTestId("feature-expenses")).toContainText("Not part of your plan");
  await expect(page.getByTestId("feature-crm")).not.toContainText("Not part of your plan");
  await page.getByTestId("feature-expenses").getByRole("link", { name: "See plans and upgrade" }).click();

  // Upgrade to Business: Expenses can now be added; Support inbox still can't.
  await page.getByTestId("choose-business").click();
  await expect(page.getByRole("dialog")).toContainText("You get:");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm switch" }).click();
  await expect(page.getByTestId("current-plan")).toContainText("Business plan");
  await expect(page.getByTestId("current-plan")).toContainText("1 of 30 people used");
  await nav(page).getByRole("link", { name: "Add features" }).click();
  await expect(page.getByTestId("feature-expenses")).not.toContainText("Not part of your plan");
  await expect(page.getByTestId("feature-support")).toContainText("Not part of your plan");
  await page.getByRole("button", { name: "Add Expenses" }).or(page.getByRole("button", { name: /^Add Invoices & Expenses/ })).click();
  await expect(page.getByTestId("feature-expenses")).toContainText("Added");

  // Back down to Starter: Expenses is switched off (data kept) and the page says so before confirming.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("choose-starter").click();
  await expect(page.getByRole("dialog")).toContainText("These switch off:");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm switch" }).click();
  await expect(page.getByTestId("current-plan")).toContainText("Starter plan");
  await nav(page).getByRole("link", { name: "Add features" }).click();
  await expect(page.getByTestId("feature-expenses")).toContainText("Not part of your plan");
  await expect(page.getByTestId("feature-expenses")).not.toContainText("Added");
});

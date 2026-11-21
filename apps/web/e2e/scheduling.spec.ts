import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";

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

let olga: Page;   // owner = manager
let max: Page;    // staff
let lee: Page;    // staff
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const dialog = (p: Page) => p.getByRole("dialog");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async ({ browser }) => {
  for (const [email, name] of [["sam.waiter@example.com", "Sam Waiter"], ["lee.cook@example.com", "Lee Cook"]]) {
    const u = await newUser(browser, email!, name!);
    await expect(u.page.getByText("Set up your workspace")).toBeVisible();
    await u.ctx.close();
  }
  olga = (await newUser(browser, "olga.bar@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Bar Luna");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});

test("owner adds the feature and two staff members", async ({ browser }) => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Staff Scheduling & Time Clock" }).click();
  for (const label of ["Schedule", "Time clock", "Time off & swaps", "Hours"]) await expect(nav(olga).getByRole("link", { name: label })).toBeVisible();

  await olga.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(olga, browser, "sam.waiter@example.com", "Sam Waiter");
  await inviteAndJoin(olga, browser, "lee.cook@example.com", "Lee Cook");
  await expect(olga.getByRole("cell", { name: /Lee Cook/ })).toBeVisible();
});

test("manager builds next week's schedule; clashes are explained; publishing makes it visible", async () => {
  await nav(olga).getByRole("link", { name: "Schedule" }).click();
  await olga.getByRole("button", { name: "Positions" }).click();
  await dialog(olga).getByLabel("New position").fill("Bar");
  await dialog(olga).getByRole("button", { name: "Add" }).click();
  await expect(dialog(olga).getByRole("list", { name: "Positions" })).toContainText("Bar");
  await dialog(olga).getByRole("button", { name: "Close" }).click();

  await olga.getByRole("button", { name: "Next week" }).click();
  await olga.getByRole("button", { name: /^Add shift for Sam Waiter on Mon/ }).click();
  await dialog(olga).getByLabel("Position").selectOption({ label: "Bar" });
  await dialog(olga).getByLabel(/^Start/).fill("09:00");
  await dialog(olga).getByLabel(/^End/).fill("17:00");
  await dialog(olga).getByLabel("Break (minutes)").fill("30");
  await dialog(olga).getByRole("button", { name: "Add shift" }).click();
  await expect(olga.getByRole("button", { name: /^Sam Waiter Mon.* 09:00–17:00 Bar \(draft\)/ })).toBeVisible();
  await expect(olga.getByTestId("row-Sam Waiter")).toContainText("7h 30m");

  // Same person, overlapping time: clear message, nothing saved.
  await olga.getByRole("button", { name: /^Add shift for Sam Waiter on Mon/ }).click();
  await dialog(olga).getByLabel(/^Start/).fill("16:00");
  await dialog(olga).getByLabel(/^End/).fill("20:00");
  await dialog(olga).getByRole("button", { name: "Add shift" }).click();
  await expect(dialog(olga).getByRole("alert")).toContainText("Sam Waiter already works 09:00–17:00");
  await dialog(olga).getByRole("button", { name: "Cancel" }).click();

  await olga.getByRole("button", { name: /^Add shift for Lee Cook on Tue/ }).click();
  await dialog(olga).getByLabel(/^Start/).fill("18:00");
  await dialog(olga).getByLabel(/^End/).fill("02:00");
  await expect(dialog(olga)).toContainText("Ends after midnight");
  await dialog(olga).getByRole("button", { name: "Add shift" }).click();
  await expect(olga.getByRole("button", { name: /^Lee Cook Tue.* 18:00–02:00 \(\+1\)/ })).toBeVisible();

  await olga.getByRole("button", { name: "Publish week (2 drafts)" }).click();
  await dialog(olga).getByRole("button", { name: "Publish" }).click();
  await expect(olga.getByText("Published 2 shifts")).toBeVisible();
  await expect(olga.getByRole("button", { name: /\(draft\)/ })).toHaveCount(0);
});

test("staff see published shifts, ask for a swap and for time off", async ({ browser }) => {
  max = (await newUser(browser, "sam.waiter@example.com", "Sam Waiter")).page;
  await expect(max.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();
  await expect(nav(max).getByRole("link", { name: "Hours" })).toHaveCount(0);
  await nav(max).getByRole("link", { name: "Schedule" }).click();
  await expect(max.getByRole("button", { name: "Publish week" })).toHaveCount(0);
  await max.getByRole("button", { name: "Next week" }).click();
  await max.getByRole("button", { name: /^Sam Waiter Mon.* 09:00–17:00 Bar$/ }).click();
  await dialog(max).getByLabel("Colleague").selectOption({ label: "Lee Cook" });
  await dialog(max).getByLabel("Message").fill("Dentist in the morning");
  await dialog(max).getByRole("button", { name: "Send request" }).click();
  await expect(max.getByRole("button", { name: /^Sam Waiter Mon/ })).toContainText("Swap requested");

  await nav(max).getByRole("link", { name: "Time off & swaps" }).click();
  await expect(max.getByRole("group", { name: "Your swap request to Lee Cook" })).toContainText("Waiting for colleague");
  await max.getByLabel("First day").fill(inDays(30));
  await max.getByLabel("Last day").fill(inDays(28));
  await expect(max.getByText("The last day can't be before the first day")).toBeVisible();
  await max.getByLabel("Last day").fill(inDays(32));
  await max.getByLabel("Reason").fill("Sister's wedding");
  await max.getByRole("button", { name: "Request time off" }).click();
  await expect(max.getByRole("group", { name: `My time off ${inDays(30)}` })).toContainText("Waiting for approval");
});

test("colleague accepts the swap, manager approves it and the time off", async ({ browser }) => {
  lee = (await newUser(browser, "lee.cook@example.com", "Lee Cook")).page;
  await nav(lee).getByRole("link", { name: "Time off & swaps" }).click();
  const req = lee.getByRole("group", { name: "Swap request from Sam Waiter" });
  await expect(req).toContainText("Dentist in the morning");
  await req.getByRole("button", { name: "Accept" }).click();
  await expect(req).toContainText("Waiting for manager");

  await nav(olga).getByRole("link", { name: "Time off & swaps" }).click();
  const box = olga.getByTestId("to-approve");
  await box.getByRole("button", { name: "Approve swap" }).click();
  await dialog(olga).getByRole("button", { name: "Approve" }).click();
  await expect(box.getByRole("group", { name: /^Swap from/ })).toHaveCount(0);
  const timeOff = box.getByRole("group", { name: /Time off for Sam Waiter/ });
  await expect(timeOff).toContainText("Sister's wedding");
  await timeOff.getByRole("button", { name: "Reject" }).click();
  await dialog(olga).getByRole("button", { name: "Reject" }).click();
  await expect(olga.getByText("Say why, so they know")).toBeVisible();
  await dialog(olga).getByRole("button", { name: "Cancel" }).click();
  await timeOff.getByRole("button", { name: "Approve" }).click();
  await dialog(olga).getByLabel("Comment (optional)").fill("Enjoy!");
  await dialog(olga).getByRole("button", { name: "Approve" }).click();
  await expect(box).toContainText("Nothing waiting");

  await nav(olga).getByRole("link", { name: "Schedule" }).click();
  await olga.getByRole("button", { name: "Next week" }).click();
  await expect(olga.getByRole("button", { name: /^Lee Cook Mon.* 09:00–17:00 Bar/ })).toBeVisible();
  await max.reload();
  await expect(max.getByRole("group", { name: `My time off ${inDays(30)}` })).toContainText("Approved");
  await expect(max.getByRole("group", { name: `My time off ${inDays(30)}` })).toContainText("Enjoy!");
});

test("staff clock in and out; the dashboard shows who is working", async () => {
  await nav(max).getByRole("link", { name: "Time clock" }).click();
  await expect(max.getByTestId("clock-card")).toContainText("Not clocked in");
  await max.getByRole("button", { name: "Clock in" }).click();
  await expect(max.getByTestId("clock-card")).toContainText("Clocked in");
  await expect(max.getByRole("table", { name: "This week's time" })).toContainText("Working");

  await nav(olga).getByRole("link", { name: "Dashboard" }).click();
  await expect(olga.getByTestId("schedule-widget")).toContainText("Working now: Sam Waiter");

  await max.getByLabel("Note (optional)").fill("Closed the bar");
  await max.getByRole("button", { name: "Clock out" }).click();
  await expect(max.getByTestId("clock-card")).toContainText("Not clocked in");
  await expect(max.getByRole("table", { name: "This week's time" })).toContainText("Closed the bar");
});

test("manager fixes a missed clock-in and exports the hours", async () => {
  await nav(olga).getByRole("link", { name: "Hours" }).click();
  await expect(olga.getByTestId("hours-Sam Waiter")).toBeVisible();
  await olga.getByRole("tab", { name: "Date range" }).click();
  await olga.getByRole("button", { name: "Add entry" }).click();
  await dialog(olga).getByLabel("Person").selectOption({ label: "Lee Cook" });
  await dialog(olga).getByLabel(/^Day/).fill(inDays(-2));
  await dialog(olga).getByLabel(/^Clock in/).fill("22:00");
  await dialog(olga).getByLabel(/^Clock out/).fill("02:00");
  await expect(dialog(olga)).toContainText("Clock-out is on the next day");
  await dialog(olga).getByLabel("Note").fill("Forgot to clock in");
  await dialog(olga).getByRole("button", { name: "Add entry" }).click();
  await expect(olga.getByTestId("hours-Lee Cook")).toContainText("4h 00m");
  await expect(olga.getByRole("table", { name: "Entries for Lee Cook" })).toContainText("Added by manager");

  const [dl] = await Promise.all([olga.waitForEvent("download"), olga.getByRole("button", { name: "Export CSV" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^hours-.*\.csv$/);
  const csv = await readFile((await dl.path())!, "utf8");
  expect(csv).toContain("Employee,Date,Clock in,Clock out,Hours,Decimal hours,Note,Edited by manager");
  expect(csv).toContain("Lee Cook");
  expect(csv).toContain("02:00 (+1 day)");
});

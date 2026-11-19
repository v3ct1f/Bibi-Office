import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

// Runs after triage.spec.ts (alice owns "Acme Bakery"; bob is a member).
test.describe.configure({ mode: "serial" });
const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
/** Monday..Friday of the first full week of next month. */
const week = (() => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const mon = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 4);
  return { mon, fri: d.toISOString().slice(0, 10) };
})();

test("people: enable, add people and who manages whom", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable People" }).click();
  await expect(page.getByRole("switch", { name: "Disable People" })).toBeChecked();
  await nav(page).getByRole("link", { name: "People" }).click();
  await expect(page.getByText("No people yet")).toBeVisible();

  const add = async (f: Record<string, string>, account: string, manager?: string) => {
    await page.goto("/m/hr/people");
    await page.getByRole("button", { name: "Add person" }).click();
    const dlg = page.getByRole("dialog", { name: "Add person" });
    for (const [label, v] of Object.entries(f)) await dlg.getByLabel(label, { exact: true }).fill(v);
    await dlg.getByLabel("Sign-in account").selectOption({ label: account });
    if (manager) await dlg.getByLabel("Manager").selectOption({ label: manager });
    await dlg.getByRole("button", { name: "Add person" }).click();
    await expect(dlg).toBeHidden();
  };
  const jan1 = `${new Date().getFullYear()}-01-01`;
  await add({ "Start date": jan1, "First name": "Alice", "Last name": "Owner", "Job title": "Owner", Team: "Management" }, "alice (alice@example.com)");
  await expect(page.getByRole("heading", { name: "Alice Owner" })).toBeVisible();
  await add({ "Start date": jan1, "First name": "Bob", "Last name": "Baker", "Job title": "Baker", Team: "Kitchen", "Work email": "bob@acme.test", Phone: "+49 30 555" }, "bob (bob@example.com)", "Alice Owner");
  await expect(page.getByRole("heading", { name: "Bob Baker" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alice Owner" })).toBeVisible();

  // HR files a contract on Bob's profile
  await page.getByLabel("Upload document").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("list", { name: "Documents" }).getByRole("button", { name: "contract", exact: true })).toBeVisible();
});

test("member: sees the directory, requests a week off", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/m/hr/people");
  const people = page.getByRole("list", { name: "People" });
  await expect(people.getByRole("link")).toHaveCount(2);
  await people.getByRole("link", { name: /Alice Owner/ }).click();
  await expect(page.getByRole("heading", { name: "Alice Owner" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal" })).toHaveCount(0);   // not Bob's business
  await page.goto("/m/hr/people");
  await people.getByRole("link", { name: /Bob Baker/ }).click();
  await expect(page.getByText("+49 30 555")).toBeVisible();   // own details
  await expect(page.getByRole("list", { name: "Documents" })).toContainText("contract");

  await page.goto("/m/hr/people");
  await page.getByRole("tab", { name: "My time off" }).click();
  await expect(page.getByLabel(/^Time off \d{4}$/)).toContainText("25");
  await page.getByRole("button", { name: "Request time off" }).click();
  const dlg = page.getByRole("dialog", { name: "Request time off" });
  await dlg.getByLabel("First day").fill(week.mon);
  await dlg.getByLabel("Last day").fill(week.fri);
  await dlg.getByLabel("Note (optional)").fill("Family visit");
  await dlg.getByRole("button", { name: "Send request" }).click();
  await expect(dlg).toBeHidden();
  const reqs = page.getByRole("list", { name: "Time off requests" });
  await expect(reqs).toContainText("Vacation");
  await expect(reqs).toContainText("5 days");
  await expect(reqs).toContainText("Waiting for approval");
});

test("manager: approves; the week shows on Who's away", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/hr/people");
  await page.getByRole("tab", { name: /Approvals/ }).click();
  const reqs = page.getByRole("list", { name: "Time off requests" });
  await expect(reqs).toContainText("Bob Baker");
  await expect(reqs).toContainText("Family visit");
  await reqs.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing to approve")).toBeVisible();

  await page.getByRole("tab", { name: "Who's away" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  const away = page.getByRole("list", { name: "Away" });
  await expect(away).toContainText("Bob Baker");
  await expect(away).toContainText("Vacation");
});

test("hr setup: holidays and leave types", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/hr/people");
  await page.getByRole("tab", { name: "Setup" }).click();
  await expect(page.getByRole("list", { name: "Leave types" })).toContainText("Sick leave");
  const y = new Date().getFullYear();
  await page.getByLabel("Date").fill(`${y}-12-24`);
  await page.getByLabel("Holiday name").fill("Christmas Eve");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByRole("list", { name: "Holidays" })).toContainText("Christmas Eve");
});

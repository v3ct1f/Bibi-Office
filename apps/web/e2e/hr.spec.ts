import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";

async function signIn(page: Page, address: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function newUser(browser: Browser, address: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, address, name);
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

let olga: Page;   // owner
let max: Page;    // employee
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const dialog = (p: Page) => p.getByRole("dialog");
const inDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test.beforeAll(async ({ browser }) => {
  const m = await newUser(browser, "max.hr@example.com", "Max Baker");
  await expect(m.page.getByText("Set up your workspace")).toBeVisible();
  max = m.page;
  olga = (await newUser(browser, "olga.hr@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Bakery Sol");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});

async function openProfile(p: Page, name: string) {
  await nav(p).getByRole("link", { name: "People" }).click();
  await p.getByRole("list", { name: "People" }).getByRole("link", { name: new RegExp(`^${name}`) }).click();
  await expect(p.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
}

test("owner adds HR and fills in a profile", async ({ browser }) => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add HR" }).click();
  await expect(nav(olga).getByRole("link", { name: "People" })).toBeVisible();

  await olga.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(olga, browser, "max.hr@example.com", "Max Baker");
  await expect(olga.getByRole("cell", { name: /Max Baker/ })).toBeVisible();

  await openProfile(olga, "Max Baker");
  await olga.getByRole("button", { name: "Edit profile" }).click();
  const d = dialog(olga);
  await d.getByLabel("Job title").fill("Baker");
  await d.getByLabel("Department").fill("Kitchen");
  await d.getByLabel("Reports to").selectOption({ label: "Olga Owner" });
  await d.getByLabel("Employment").selectOption({ label: "Full-time" });
  await d.getByLabel("Start date").fill("2022-04-01");
  await d.getByLabel("Date of birth").fill("1996-08-20");
  await d.getByLabel("Personal email").fill("not-an-email");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d.getByText("Use a valid email address")).toBeVisible();
  await d.getByLabel("Personal email").fill("max@home.test");
  await d.getByLabel("Name", { exact: true }).fill("Lena Baker");
  await d.getByLabel("Relation").fill("Sister");
  await d.getByLabel("Phone", { exact: true }).fill("+34 600 111 222");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(olga.getByText("Profile saved")).toBeVisible();
  await expect(olga.getByText("Baker · Kitchen")).toBeVisible();
  await expect(olga.getByRole("link", { name: "Olga Owner" })).toBeVisible();
  await expect(olga.getByRole("group", { name: "Private details" })).toContainText("Lena Baker (Sister) · +34 600 111 222");

  await nav(olga).getByRole("link", { name: "People" }).click();
  await olga.getByRole("navigation", { name: "People sections" }).getByRole("link", { name: "Org chart" }).click();
  const olgaNode = olga.getByRole("treeitem", { name: "Olga Owner" });
  await expect(olgaNode).toContainText("1 report");
  await expect(olgaNode.getByRole("treeitem", { name: "Max Baker" })).toBeVisible();
});

test("pay, documents and leave on the profile", async () => {
  await openProfile(olga, "Max Baker");
  await olga.getByRole("tab", { name: "Pay" }).click();
  const add = olga.getByRole("group", { name: "Add pay change" });
  await add.getByLabel("From").fill("2024-01-01");
  await add.getByLabel(/Amount/).fill("14,50");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(olga.getByRole("group", { name: "Current pay" })).toContainText("14.50");
  await expect(olga.getByRole("group", { name: "Current pay" })).toContainText("per hour");

  await olga.getByRole("tab", { name: "Documents" }).click();
  await olga.getByRole("button", { name: "Upload document" }).click();
  await dialog(olga).getByLabel("File").setInputFiles({ name: "food-safety.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e\n") });
  await expect(dialog(olga).getByLabel("Name")).toHaveValue("food-safety");
  await dialog(olga).getByLabel("Type").selectOption({ label: "Certificate" });
  await dialog(olga).getByLabel("Expires on").fill(inDays(12));
  await dialog(olga).getByRole("button", { name: "Upload" }).click();
  const docs = olga.getByRole("table", { name: "Documents" });
  await expect(docs).toContainText("food-safety");
  await expect(docs).toContainText("Expires soon");

  await olga.getByRole("tab", { name: "Leave" }).click();
  await olga.getByRole("button", { name: "Add leave or adjustment" }).click();
  await dialog(olga).getByLabel("What").selectOption({ label: "Carried over" });
  await dialog(olga).getByLabel("Days").fill("2");
  await dialog(olga).getByLabel("Note").fill("From last year");
  await dialog(olga).getByRole("button", { name: "Save" }).click();
  const bal = olga.getByRole("group", { name: "Vacation balance" });
  await expect(bal).toContainText("Allowance27");
  await expect(bal).toContainText("Left27");
  await expect(olga.getByRole("table", { name: "Leave entries" })).toContainText("From last year");
});

test("an onboarding checklist assigns tasks to the person and HR", async () => {
  await nav(olga).getByRole("link", { name: "People" }).click();
  await olga.getByRole("navigation", { name: "People sections" }).getByRole("link", { name: "Checklists" }).click();
  await olga.getByRole("button", { name: "New template" }).click();
  const d = dialog(olga);
  await d.getByLabel("Name").fill("New baker");
  await d.getByLabel("Task 1", { exact: true }).fill("Read the hygiene handbook");
  await d.getByRole("button", { name: "Add task" }).click();
  await d.getByLabel("Task 2", { exact: true }).fill("Order uniform");
  await d.getByLabel("Task 2 owner").selectOption({ label: "HR (whoever assigns it)" });
  await d.getByLabel("Task 2 due days").fill("-2");
  await d.getByRole("button", { name: "Save template" }).click();
  await expect(olga.getByRole("group", { name: "Checklist templates" })).toContainText("New baker");

  await openProfile(olga, "Max Baker");
  await olga.getByRole("tab", { name: "Checklists" }).click();
  const assign = olga.getByRole("group", { name: "Assign a checklist" });
  await assign.getByLabel("Checklist").selectOption({ label: "New baker (Onboarding)" });
  await assign.getByLabel("Start day").fill(inDays(3));
  await assign.getByRole("button", { name: "Assign" }).click();
  const cl = olga.getByRole("group", { name: "New baker" });
  await expect(cl).toContainText("0 / 2");
  await cl.getByRole("checkbox", { name: "Order uniform" }).check();
  await expect(cl).toContainText("1 / 2");
});

test("the employee sees their own profile, pay and tasks, and can only edit contact details", async () => {
  await max.goto(`/t/${slug}`);
  await expect(max.getByTestId("people-widget")).toContainText("1 onboarding task for you");
  await openProfile(max, "Max Baker");
  await expect(max.getByText("(you)")).toBeVisible();
  await max.getByRole("tab", { name: "Pay" }).click();
  await expect(max.getByRole("group", { name: "Current pay" })).toContainText("14.50");
  await expect(max.getByRole("group", { name: "Add pay change" })).toHaveCount(0);

  await max.getByRole("tab", { name: "Checklists" }).click();
  const cl = max.getByRole("group", { name: "New baker" });
  await expect(cl.getByRole("checkbox", { name: "Order uniform" })).toBeDisabled();
  await cl.getByRole("checkbox", { name: "Read the hygiene handbook" }).check();
  await expect(cl).toContainText("Done");

  await max.getByRole("button", { name: "Edit my details" }).click();
  await expect(dialog(max).getByLabel("Job title")).toHaveCount(0);
  await dialog(max).getByLabel("Phone", { exact: true }).fill("+34 600 999 999");
  await dialog(max).getByRole("button", { name: "Save" }).click();
  await expect(max.getByText("Profile saved")).toBeVisible();
  await max.getByRole("tab", { name: "Profile" }).click();
  await expect(max.getByRole("group", { name: "Private details" })).toContainText("+34 600 999 999");

  // A colleague's profile shows only the public part.
  await openProfile(max, "Olga Owner");
  await expect(max.getByRole("group", { name: "Private details" })).toHaveCount(0);
  await expect(max.getByRole("tab", { name: "Pay" })).toHaveCount(0);
  await expect(max.getByRole("button", { name: /Edit/ })).toHaveCount(0);
});

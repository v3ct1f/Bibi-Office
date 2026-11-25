import { expect, test, type Page } from "@playwright/test";

/** Work email with the pretend provider: nothing real is bought. */
test.describe.configure({ mode: "serial" });

let page: Page;
const nav = () => page.getByRole("navigation", { name: "Main" });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("maya@example.com");
  await page.getByLabel("Name").fill("Maya Mail");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Company name").fill("Mail Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Maya" })).toBeVisible();
});

test("adding a colleague offers to turn on Work email, and says what is still missing", async () => {
  await nav().getByRole("link", { name: "Colleagues" }).click();
  await page.getByRole("button", { name: "Add colleague" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByText("Give them a work email?")).toBeVisible();
  await d.getByRole("button", { name: "Turn on Work email" }).click();
  // The price is said before anything is turned on (demo server: nothing is charged).
  await expect(d.getByText("Turning it on costs nothing by itself. Each work mailbox costs €3 per month (demo: nothing is charged).")).toBeVisible();
  await d.getByRole("button", { name: "Yes, turn it on" }).click();
  // On now, but no domain yet.
  await expect(d.getByText("you don't have a company domain yet")).toBeVisible();
  await expect(d.getByRole("checkbox", { name: "Give them a work email" })).toBeDisabled();
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(nav().getByRole("link", { name: "Work email" })).toBeVisible();
});

test("search for a domain, see what is taken, and get one", async () => {
  await nav().getByRole("link", { name: "Work email" }).click();
  await expect(page.getByRole("heading", { name: "Work email" })).toBeVisible();
  await expect(page.getByText("No domain yet.")).toBeVisible();
  await page.getByRole("button", { name: "Get a domain" }).click();
  const d = page.getByRole("dialog");

  await d.getByLabel("Domain name").fill("taken-shop.com");
  await d.getByRole("button", { name: "Search" }).click();
  await expect(d.getByRole("button", { name: "Choose taken-shop.com" })).toBeDisabled();

  await d.getByLabel("Domain name").fill("mailco");
  await d.getByRole("button", { name: "Search" }).click();
  await expect(d.getByRole("list", { name: "Search results" })).toContainText("mailco.com");
  await d.getByRole("button", { name: "Choose mailco.com" }).click();

  await expect(d.getByText("registered in your business's name", { exact: false })).toBeVisible();
  await d.getByLabel("Contact email").fill("maya@mailco.test");
  await d.getByLabel("Street address").fill("Calle Mayor 1");
  await d.getByLabel("City").fill("Madrid");
  await d.getByLabel("Postal code").fill("28001");
  await d.getByLabel("Country").fill("es");
  await d.getByRole("button", { name: /Pay .*mailco\.com/ }).click();

  const row = page.getByTestId("domain-mailco.com");
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("it's yours");
  await expect(row.getByRole("button", { name: "Take it with you" })).toBeVisible();
});

test("a brand-new domain can't be moved for 60 days, and says why", async () => {
  await page.getByTestId("domain-mailco.com").getByRole("button", { name: "Take it with you" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Show the transfer code" }).click();
  await expect(d.getByRole("alert")).toContainText("after 60 days");
  await d.getByText("Close", { exact: true }).click();
});

test("connect a domain you already own: records are shown and checked", async () => {
  await page.getByRole("button", { name: "Connect a domain I own" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Your domain").fill("mycafe.example");
  await d.getByRole("button", { name: "Continue" }).click();
  await expect(d.getByRole("table", { name: "DNS records to add" })).toContainText("mx.fake-mail.test");
  await d.getByRole("button", { name: "Check now" }).click();
  await expect(d.getByRole("status")).toContainText("Not found yet");
  await d.getByRole("button", { name: "I'll do it later" }).click();
  await expect(page.getByTestId("domain-mycafe.example")).toContainText("Waiting for DNS records");

  // One whose records are already in place becomes ready.
  await page.getByRole("button", { name: "Connect a domain I own" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Your domain").fill("dns-ok-mail.example");
  await d.getByRole("button", { name: "Continue" }).click();
  await d.getByRole("button", { name: "Check now" }).click();
  await expect(d.getByRole("heading", { name: "dns-ok-mail.example is connected" })).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("domain-dns-ok-mail.example")).toContainText("Ready");
});

test("add a colleague and give them a work email in one step", async () => {
  await nav().getByRole("link", { name: "Colleagues" }).click();
  await page.getByRole("button", { name: "Add colleague" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("textbox", { name: /^Name/ }).fill("Anna Ruiz");
  await d.getByRole("textbox", { name: /^Email/ }).fill("anna.private@example.com");
  await d.getByLabel("Starting password").fill("annas-start-01");
  await d.getByRole("checkbox", { name: "Give them a work email" }).click();
  await expect(d.getByLabel("Work email name")).toHaveValue("anna");
  await expect(d.getByLabel("Work email domain")).toContainText("mailco.com");
  // Ticking the box says what it costs, before the button, and the button says it too.
  await expect(d.getByTestId("mailbox-cost")).toContainText("Each work mailbox costs €3 per month (demo: nothing is charged).");
  await expect(d.getByTestId("mailbox-cost")).toContainText("0 of 10 mailboxes used");
  await d.getByRole("button", { name: "Create account and work email (+€3/month, demo)" }).click();

  await expect(d.getByRole("heading", { name: "Account ready" })).toBeVisible();
  await expect(d.getByText("anna@mailco.com")).toBeVisible();
  await expect(d.getByTestId("mailbox-cost-after")).toHaveText("On a real subscription this adds €3/month (demo: nothing was charged).");
  await d.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table", { name: "Colleagues" })).toContainText("Anna Ruiz");

  await nav().getByRole("link", { name: "Work email" }).click();
  const box = page.getByRole("table", { name: "Mailboxes" }).getByRole("row", { name: /anna@mailco\.com/ });
  await expect(box).toContainText("On");
});

test("removing the colleague switches their mailbox off", async () => {
  await nav().getByRole("link", { name: "Colleagues" }).click();
  await page.getByRole("button", { name: "Actions for Anna Ruiz" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("table", { name: "Colleagues" })).not.toContainText("Anna Ruiz");

  await nav().getByRole("link", { name: "Work email" }).click();
  const box = page.getByRole("table", { name: "Mailboxes" }).getByRole("row", { name: /anna@mailco\.com/ });
  // The worker picks the event up within a moment.
  await expect(async () => {
    await page.reload();
    await expect(box).toContainText("Off (colleague removed)");
  }).toPass({ timeout: 20_000 });
});

test("a mailbox can be made by hand, and its password is shown once", async () => {
  await page.getByRole("button", { name: "New mailbox" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("textbox", { name: /^Name/ }).fill("Info desk");
  await d.getByLabel("Address").fill("info");
  await expect(d.getByTestId("mailbox-cost")).toContainText("Each work mailbox costs €3 per month (demo: nothing is charged). (1 of 10 mailboxes used.)");
  await d.getByRole("button", { name: "Create mailbox (+€3/month, demo)" }).click();
  await expect(d.getByRole("heading", { name: "Mailbox ready" })).toBeVisible();
  await expect(d.getByTestId("mailbox-cost-after")).toContainText("€3/month");
  await expect(page.getByTestId("mailbox-usage")).toContainText("2 of 10 mailboxes used.");
  await expect(d.getByText("info@mailco.com").first()).toBeVisible();
  await expect(d.getByText("shown", { exact: false })).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table", { name: "Mailboxes" })).toContainText("info@mailco.com");
});

test("a domain can be removed: it says what happens, needs the name typed, and the price drops", async () => {
  await expect(page.getByTestId("domain-mailco.com")).toBeVisible();
  await page.getByRole("button", { name: "Remove mailco.com" }).click();
  const d = page.getByRole("dialog");
  const list = d.getByTestId("remove-consequences");
  await expect(list).toContainText("stays registered in your business's name");
  await expect(list).toContainText("won't be renewed");
  await expect(list).toContainText("isn't refunded");
  await expect(list).toContainText("mailboxes are switched off");
  await expect(list).toContainText("nothing is deleted");
  await expect(list).toContainText("(demo: nothing is charged or refunded)");
  // Can't be confirmed until the domain's name is typed.
  const go = d.getByRole("button", { name: "Remove domain" });
  await expect(go).toBeDisabled();
  await d.getByLabel("Type mailco.com to confirm").fill("mailco.co");
  await expect(go).toBeDisabled();
  await d.getByLabel("Type mailco.com to confirm").fill("mailco.com");
  await expect(go).toBeEnabled();
  // Keep it first: nothing changes.
  await d.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByTestId("domain-mailco.com")).toContainText("Ready");
  await page.getByRole("button", { name: "Remove mailco.com" }).click();
  await page.getByRole("dialog").getByLabel("Type mailco.com to confirm").fill("mailco.com");
  await page.getByRole("dialog").getByRole("button", { name: "Remove domain" }).click();
  // A bought domain stays listed as removed (still theirs until it expires); its mailboxes are off, mail kept.
  await expect(page.getByTestId("domain-mailco.com")).toContainText("Removed, not renewed");
  await expect(page.getByTestId("domain-mailco.com")).toContainText("Still registered in your business's name");
  await expect(page.getByRole("table", { name: "Mailboxes" })).toContainText("domain removed, mail kept");
  await expect(page.getByTestId("mailbox-usage")).toContainText("0 of 10 mailboxes used.");
});

test("Cancel Work email is on its page, needs 'cancel' typed, and keeps the data", async () => {
  await page.getByRole("button", { name: "Cancel Work email" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByTestId("remove-consequences")).toContainText("Nothing is deleted");
  await expect(d.getByTestId("remove-consequences")).toContainText("Adding Work email again brings everything back");
  const go = d.getByRole("button", { name: "Cancel Work email" });
  await expect(go).toBeDisabled();
  await d.getByLabel("Type cancel to confirm").fill("cancel");
  await go.click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("button", { name: "Add Work email" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "Work email" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Work email" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add Work email" }).click();
  await nav().getByRole("link", { name: "Work email" }).click();
  await expect(page.getByTestId("domain-mailco.com")).toContainText("Removed, not renewed");
});

test("the feature can be taken off from Add features (typed confirmation) and keeps its data", async () => {
  await nav().getByRole("link", { name: "Add features" }).click();
  await page.getByRole("button", { name: "Remove Work email" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Nothing is deleted");
  await dlg.getByLabel("Type cancel to confirm").fill("cancel");
  await dlg.getByRole("button", { name: "Cancel Work email" }).click();
  await expect(page.getByRole("button", { name: "Add Work email" })).toBeVisible();
  await expect(nav().getByRole("link", { name: "Work email" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Work email" }).click();
  // The price is said before it's turned back on.
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Each work mailbox costs €3 per month (demo: nothing is charged).");
  await confirm.getByRole("button", { name: "Add Work email" }).click();
  await nav().getByRole("link", { name: "Work email" }).click();
  await expect(page.getByTestId("domain-mailco.com")).toContainText("Removed, not renewed");
});

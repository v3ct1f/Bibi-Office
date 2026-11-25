import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";

async function newUser(browser: Browser, email: string, name: string): Promise<Page> {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

test.describe.configure({ mode: "serial" });

let mia: Page;   // owner
let sam: Page;   // colleague
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const rows = (p: Page) => p.getByTestId("thread-row");
const row = (p: Page, text: string) => rows(p).filter({ hasText: text });
const openMail = async (p: Page) => { await nav(p).getByRole("link", { name: /^Mail/ }).click(); await expect(p.getByTestId("mail-app")).toBeVisible(); };

test.beforeAll(async ({ browser }) => {
  mia = await newUser(browser, "mia.mail@example.com", "Mia Mail");
  await mia.getByLabel("Company name").fill("Mail Co");
  await mia.getByRole("button", { name: "Create workspace" }).click();
  await expect(mia.getByRole("heading", { name: "Welcome back, Mia" })).toBeVisible();
  slug = new URL(mia.url()).pathname.split("/")[2]!;
  await mia.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(mia, browser, "sam.mail@example.com", "Sam Staff");
  sam = await newUser(browser, "sam.mail@example.com", "Sam Staff");
  await expect(sam.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();
});

test("owner adds Mail and Leads; Mail shows in the menu with an unread number", async () => {
  await nav(mia).getByRole("link", { name: "Add features" }).click();
  await mia.getByRole("button", { name: "Add Leads" }).click();
  await expect(mia.getByRole("button", { name: "Remove Leads" })).toBeVisible();
  await mia.getByRole("button", { name: "Add Mail" }).click();
  await expect(mia.getByRole("button", { name: "Remove Mail" })).toBeVisible();
  await expect(nav(mia).getByRole("link", { name: /^Mail/ })).toBeVisible();
  await openMail(mia);
  await expect(mia.getByTestId("my-address")).toHaveText("mia.mail@example.com");
  await expect(rows(mia)).toHaveCount(3);               // Welcome, Quote (2 messages in one conversation), Big sale
  await expect(mia.getByTestId("count-inbox")).toHaveText("3");
  await expect(nav(mia).getByRole("link", { name: /^Mail/ })).toContainText("3");
});

test("read a conversation: it becomes read, attachments download, HTML mail is locked down", async () => {
  await row(mia, "Quote for the spring order").getByRole("button").nth(1).click();
  await expect(mia.getByTestId("thread-subject")).toHaveText("Quote for the spring order");
  await expect(mia.getByTestId("message-card")).toHaveCount(2);
  await expect(row(mia, "Quote for the spring order")).toHaveAttribute("data-unread", "false");
  await expect(mia.getByTestId("count-inbox")).toHaveText("2");
  const [dl] = await Promise.all([mia.waitForEvent("download"), mia.getByTestId("attachment").click()]);
  expect(dl.suggestedFilename()).toBe("specification.txt");

  await row(mia, "Big sale").getByRole("button").nth(1).click();
  await expect(mia.getByText("Pictures from the internet are hidden")).toBeVisible();
  const frame = mia.frameLocator("iframe[title='Message']");
  await expect(frame.getByRole("heading", { name: "Big sale!" })).toBeVisible();
  expect(await frame.locator("script").count()).toBe(0);
  expect(await frame.locator("img[src]").count()).toBe(0);
  const sandbox = await mia.locator("iframe[title='Message']").getAttribute("sandbox");
  expect(sandbox).not.toContain("allow-scripts");
  await mia.getByRole("button", { name: "Show pictures" }).click();
  await expect(frame.locator("img[src^='https://tracker.test']")).toHaveCount(1);
});

test("keyboard: c writes a message, j and k move, e archives, # deletes, / searches", async () => {
  await mia.getByRole("button", { name: "Back to list" }).click();
  await mia.keyboard.press("c");
  await expect(mia.getByTestId("compose")).toBeVisible();
  await mia.getByTestId("compose").getByRole("button", { name: "Close" }).click();      // untouched, so it is discarded
  await expect(mia.getByTestId("compose")).toHaveCount(0);

  await mia.keyboard.press("j");
  await mia.keyboard.press("Enter");
  await expect(mia.getByTestId("thread-view")).toBeVisible();
  const open = await mia.getByTestId("thread-subject").textContent();
  await mia.keyboard.press("e");
  await expect(row(mia, open!)).toHaveCount(0);
  await mia.getByTestId("folder-archive").click();
  await expect(row(mia, open!)).toHaveCount(1);
  await row(mia, open!).getByRole("button").nth(1).click();
  await mia.keyboard.press("#");
  await expect(row(mia, open!)).toHaveCount(0);
  await mia.getByTestId("folder-trash").click();
  await expect(row(mia, open!)).toHaveCount(1);
  await mia.getByLabel(`Select ${open!}`).check();
  await mia.getByTestId("more-menu").click();
  await mia.getByRole("menuitem", { name: "Inbox" }).click();
  await mia.getByTestId("folder-inbox").click();
  await expect(rows(mia)).toHaveCount(3);

  await mia.keyboard.press("/");
  await expect(mia.getByTestId("search-input")).toBeFocused();
});

test("search by sender, attachment and words; select several and act on them", async () => {
  const s = mia.getByTestId("search-input");
  await s.fill("from:carla has:attachment");
  await s.press("Enter");
  await expect(rows(mia)).toHaveCount(1);
  await expect(rows(mia).first()).toContainText("Quote for the spring order");
  await s.fill("nothing matches this");
  await s.press("Enter");
  await expect(mia.getByTestId("empty-list")).toContainText("No messages match");
  await mia.getByRole("button", { name: "Clear" }).click();
  await expect(rows(mia)).toHaveCount(3);

  await mia.getByTestId("select-all").click();
  await expect(mia.getByTestId("bulk-bar")).toContainText("3 selected");
  await mia.getByTestId("bulk-unread").click();
  await expect(mia.getByTestId("count-inbox")).toHaveText("3");
  await mia.getByTestId("bulk-read").click();
  await expect(mia.getByTestId("count-inbox")).toHaveCount(0);
  await mia.getByTestId("bulk-unread").click();
  await expect(mia.getByTestId("count-inbox")).toHaveText("3");
  await mia.getByTestId("select-all").click();               // untick everything again
  await expect(mia.getByTestId("bulk-bar")).toHaveCount(0);
});

test("labels and stars", async () => {
  await mia.getByRole("button", { name: "New label" }).click();
  await mia.getByTestId("label-name").fill("Clients");
  await mia.getByTestId("label-create").click();
  await expect(mia.getByTestId("label-item")).toContainText("Clients");
  await row(mia, "Quote for the spring order").getByLabel(/^Select/).check();
  await mia.getByTestId("more-menu").click();
  await mia.getByRole("menuitem", { name: "Clients" }).click();
  await expect(row(mia, "Quote for the spring order")).toContainText("Clients");
  await mia.getByTestId("label-item").click();
  await expect(rows(mia)).toHaveCount(1);
  await mia.getByTestId("folder-inbox").click();
  await row(mia, "Welcome").getByRole("button", { name: "Star" }).click();
  await mia.getByTestId("folder-starred").click();
  await expect(rows(mia)).toHaveCount(1);
  await expect(rows(mia).first()).toContainText("Welcome to your new mailbox");
  await mia.getByTestId("folder-inbox").click();
});

test("write to a colleague with an attachment and a signature; the draft saves by itself", async () => {
  await mia.getByRole("button", { name: "Mail settings" }).click();
  await mia.getByTestId("signature-input").fill("Mia\nMail Co");
  await mia.getByTestId("signature-save").click();
  await mia.getByTestId("compose-button").click();
  const c = mia.getByTestId("compose");
  await expect(c.getByLabel("Message")).toHaveValue(/Mia\nMail Co/);
  await c.getByLabel("To", { exact: true }).fill("sam.mail@example.com");
  await c.getByLabel("Subject").fill("Lunch on Friday?");
  await c.getByLabel("Message").fill("Hi Sam, fancy lunch on Friday?\n\n-- \nMia\nMail Co");
  await expect(c.getByTestId("draft-state")).toHaveText("Draft saved");
  await c.getByTestId("attach-input").setInputFiles({ name: "menu.txt", mimeType: "text/plain", buffer: Buffer.from("pasta") });
  await expect(c.getByTestId("draft-file")).toContainText("menu.txt");
  await c.getByTestId("attach-input").setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(mia.getByText(/Programs and scripts can't be attached/)).toBeVisible();

  // Close keeps it as a draft; open it again from Drafts.
  await c.getByRole("button", { name: "Close" }).click();
  await mia.getByTestId("folder-drafts").click();
  await expect(rows(mia)).toHaveCount(1);
  await rows(mia).first().getByRole("button").nth(1).click();
  await expect(mia.getByTestId("compose").getByLabel("Subject")).toHaveValue("Lunch on Friday?");
  await mia.getByTestId("compose").getByRole("button", { name: "Send" }).click();
  await expect(mia.getByText("Message sent.")).toBeVisible();
  await mia.getByTestId("folder-sent").click();
  await expect(row(mia, "Lunch on Friday?")).toHaveCount(1);
  await expect(mia.getByTestId("folder-drafts").getByTestId("count-drafts")).toHaveCount(0);
});

test("the colleague has their own private mailbox, gets the message and replies in the same conversation", async () => {
  await sam.reload();
  await openMail(sam);
  await expect(sam.getByTestId("my-address")).toHaveText("sam.mail@example.com");
  // Their own sample mail and Mia's message; none of Mia's labels, drafts or conversations.
  await expect(row(sam, "Lunch on Friday?")).toHaveCount(1);
  await expect(row(sam, "Quote for the spring order")).toHaveCount(1);   // Sam's own sample copy, not Mia's
  await expect(sam.getByTestId("label-item")).toHaveCount(0);
  await row(sam, "Lunch on Friday?").getByRole("button").nth(1).click();
  await expect(sam.frameLocator("iframe[title='Message']").getByText("fancy lunch on Friday")).toBeVisible();
  await expect(sam.getByTestId("attachment")).toContainText("menu.txt");
  await sam.keyboard.press("r");
  const c = sam.getByTestId("compose");
  await expect(c.getByLabel("Subject")).toHaveValue("Re: Lunch on Friday?");
  await expect(c.getByLabel("To", { exact: true })).toHaveValue(/mia\.mail@example\.com/);
  await c.getByLabel("Message").fill("Sounds great, noon?\n\n" + (await c.getByLabel("Message").inputValue()));
  await c.getByRole("button", { name: "Send" }).click();
  await expect(sam.getByText("Message sent.")).toBeVisible();
  await expect(sam.getByTestId("message-card")).toHaveCount(2);        // the reply joined the conversation

  // Mia's page picks the answer up (the refresh button asks the mail server).
  await mia.getByTestId("folder-inbox").click();
  await mia.getByTestId("refresh").click();
  await expect(row(mia, "Lunch on Friday?")).toContainText("2");
  await expect(row(mia, "Lunch on Friday?")).toHaveAttribute("data-unread", "true");
});

test("add the sender as a contact and as a lead (through Leads)", async () => {
  await row(mia, "Quote for the spring order").getByRole("button").nth(1).click();
  await mia.getByRole("button", { name: "Add as contact" }).first().click();
  await expect(mia.getByText("Carla Mendes was added to your contacts.")).toBeVisible();
  await expect(mia.getByTestId("message-card").first()).toContainText("Carla Mendes");
  await mia.getByRole("button", { name: "Add as lead" }).first().click();
  await expect(mia.getByText("Asked Leads to add Carla Mendes.")).toBeVisible();
  await nav(mia).getByRole("link", { name: "Leads" }).click();
  await expect(mia.getByText("Carla Mendes").first()).toBeVisible({ timeout: 20_000 });
});

test("a screenshot of the finished inbox", async () => {
  await openMail(mia);
  await row(mia, "Lunch on Friday?").getByRole("button").nth(1).click();
  await expect(mia.getByTestId("message-card")).toHaveCount(2);
  await mia.screenshot({ path: "test-results/mail-inbox.png" });
});

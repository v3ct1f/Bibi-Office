import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";
import { email, startMailServers } from "../../../modules/support/tests/mail-servers.ts";

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

let mail: Awaited<ReturnType<typeof startMailServers>>;
let olga: Page;   // owner
let tom: Page;    // support agent (member)
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const dialog = (p: Page) => p.getByRole("dialog");
const conversation = (p: Page) => p.getByRole("list", { name: "Conversation" });

/** "Check mail", until the ticket shows (the background job may have fetched it first). */
async function checkMailUntil(p: Page, text: string | RegExp) {
  await expect(async () => {
    await p.getByRole("button", { name: "Check mail" }).click();
    await expect(p.getByRole("list", { name: "Tickets" }).getByText(text).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

test.beforeAll(async ({ browser }) => {
  mail = await startMailServers({ user: "help@lamps.test", pass: "lamp-secret" });
  const t = await newUser(browser, "tom.support@example.com", "Tom Support");
  await expect(t.page.getByText("Set up your workspace")).toBeVisible();
  tom = t.page;
  olga = (await newUser(browser, "olga.lamps@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Lamp Shop");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});
test.afterAll(async () => { await mail?.stop(); });

test("owner adds the feature and connects the mailbox", async ({ browser }) => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Support inbox" }).click();
  await expect(nav(olga).getByRole("link", { name: "Support" })).toBeVisible();

  await olga.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(olga, browser, "tom.support@example.com", "Tom Support");
  await expect(olga.getByRole("cell", { name: /Tom Support/ })).toBeVisible();

  await nav(olga).getByRole("link", { name: "Support" }).click();
  await expect(olga.getByText("Connect your support mailbox")).toBeVisible();
  await olga.getByRole("button", { name: "Support settings" }).click();
  const box = olga.getByRole("group", { name: "Mailbox" });
  await box.getByRole("button", { name: "Save and test" }).click();
  await expect(box.getByText("Enter the support email address, e.g. help@yourshop.com")).toBeVisible();

  await box.getByLabel("Support email address").fill(mail.user);
  await box.getByLabel("Sender name").fill("Lamp Shop Support");
  await box.getByLabel("IMAP security").selectOption("none");
  await box.getByLabel("IMAP server").fill("127.0.0.1");
  await box.getByLabel("IMAP port").fill(String(mail.imapPort));
  await box.getByLabel("IMAP password").fill("wrong");
  await box.getByLabel("SMTP security").selectOption("none");
  await box.getByLabel("SMTP server").fill("127.0.0.1");
  await box.getByLabel("SMTP port").fill(String(mail.smtpPort));
  await box.getByLabel("SMTP password").fill(mail.pass);
  await box.getByRole("button", { name: "Save and test" }).click();
  const result = olga.getByRole("status", { name: "Connection test" });
  await expect(result).toContainText("Incoming (IMAP): The server refused the user name or password");
  await expect(result).toContainText("Outgoing (SMTP): works");

  await box.getByLabel("IMAP password").fill(mail.pass);
  await box.getByRole("button", { name: "Save and test" }).click();
  await expect(result).toContainText("Incoming (IMAP): works");
  await expect(box.getByText(`Connected to ${mail.user}`)).toBeVisible();
  await expect(box.getByLabel("IMAP password")).toHaveValue("");
  await expect(box.getByText("Saved — leave empty to keep it").first()).toBeVisible();
});

test("manager tools: a saved reply and response targets", async () => {
  const saved = olga.getByRole("group", { name: "Saved replies" });
  await saved.getByRole("button", { name: "Add saved reply" }).click();
  await dialog(olga).getByRole("button", { name: "Save" }).click();
  await expect(dialog(olga).getByText("Name the saved reply")).toBeVisible();
  await dialog(olga).getByLabel("Name").fill("Replacement");
  await dialog(olga).getByLabel("Reply").fill("Hi {{customer.firstName}}, we're sending a replacement for ticket #{{ticket.number}}.");
  await dialog(olga).getByRole("button", { name: "Save" }).click();
  await expect(saved.getByText("Replacement", { exact: true })).toBeVisible();

  const targets = olga.getByRole("group", { name: "Response targets" });
  await expect(targets.getByLabel("Normal first reply within")).toHaveValue("8");
  await targets.getByLabel("Normal first reply within").fill("4");
  await targets.getByRole("button", { name: "Save targets" }).click();
  await expect(olga.getByText("Targets saved. Open tickets follow them now.")).toBeVisible();
});

test("a customer email becomes a ticket linked to a contact", async () => {
  mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", to: mail.user, subject: "My lamp flickers", body: "It flickers since Monday.", messageId: "<ana-e2e-1@customer.test>", attachment: { name: "receipt.txt", type: "text/plain", content: "order 77" } }));
  await nav(olga).getByRole("link", { name: "Support" }).click();
  await checkMailUntil(olga, "My lamp flickers");
  const row = olga.getByRole("listitem").filter({ hasText: "My lamp flickers" });
  await expect(row).toContainText("Ana Ruiz");
  await expect(row).toContainText("Unassigned");
  await row.click();

  await expect(olga.getByRole("heading", { name: /#1\s*My lamp flickers/ })).toBeVisible();
  await expect(conversation(olga)).toContainText("It flickers since Monday.");
  await expect(olga.getByRole("button", { name: /receipt\.txt/ })).toBeVisible();
  const customer = olga.getByRole("group", { name: "Customer" });
  await expect(customer).toContainText("ana@customer.test");
  await expect(customer.getByRole("link", { name: "Open contact" })).toBeVisible();
  await expect(olga.getByRole("group", { name: "Response targets" })).toContainText(/Due in 4 hours/);

  // Assign it to Tom.
  await olga.getByLabel("Assigned to").selectOption({ label: "Tom Support" });
  await expect(olga.getByText("Assigned", { exact: true })).toBeVisible();
});

test("the agent replies by email with a saved reply and leaves an internal note", async () => {
  await tom.goto(`/t/${slug}`);
  await nav(tom).getByRole("link", { name: "Support" }).click();
  await tom.getByRole("tab", { name: /Mine/ }).click();
  await tom.getByRole("listitem").filter({ hasText: "My lamp flickers" }).click();

  const write = tom.getByRole("group", { name: "Write" });
  await write.getByRole("button", { name: "Send reply" }).click();
  await expect(write.getByText("Write a reply")).toBeVisible();
  await write.getByLabel("Insert saved reply").selectOption({ label: "Replacement" });
  await expect(write.getByLabel("Your reply")).toHaveValue("Hi Ana, we're sending a replacement for ticket #1.");
  await write.getByRole("button", { name: "Send reply" }).click();
  await expect(tom.getByText("Reply emailed to ana@customer.test")).toBeVisible();

  const [sent] = await mail.waitForSent(1);
  expect(sent!.to).toEqual(["ana@customer.test"]);
  expect(sent!.mail.subject).toBe("Re: My lamp flickers [#1]");
  expect(sent!.mail.inReplyTo).toBe("<ana-e2e-1@customer.test>");
  expect(sent!.mail.text).toContain("Hi Ana, we're sending a replacement for ticket #1.");
  expect(sent!.mail.text).toContain("Tom Support");
  await expect(tom.getByRole("heading", { name: /My lamp flickers/ }).locator("..")).toContainText("Pending");

  await write.getByRole("tab", { name: "Internal note" }).click();
  await write.getByLabel("Your note").fill("Replacement shipped from the back room.");
  await write.getByRole("button", { name: "Add note" }).click();
  await expect(conversation(tom).locator("[data-kind=note]")).toContainText("Replacement shipped from the back room.");
  expect(mail.sent).toHaveLength(1); // notes are never emailed
});

test("the customer's answer threads back and reopens the ticket", async () => {
  const ours = mail.sent[0]!.mail.messageId!;
  mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", to: mail.user, subject: "Re: My lamp flickers [#1]", body: "Great, thank you!\n\nOn Tue, Lamp Shop Support wrote:\n> Hi Ana", inReplyTo: ours, references: ["<ana-e2e-1@customer.test>", ours] }));
  await nav(tom).getByRole("link", { name: "Support" }).click();
  await tom.getByRole("tab", { name: /Open/ }).click();
  await checkMailUntil(tom, "My lamp flickers");
  await expect(tom.getByRole("listitem").filter({ hasText: "My lamp flickers" })).toContainText("Great, thank you!");
  await tom.getByRole("listitem").filter({ hasText: "My lamp flickers" }).click();
  await expect(conversation(tom).locator(":scope > li")).toHaveCount(4);
  await expect(conversation(tom)).not.toContainText("Lamp Shop Support wrote"); // quoted history is trimmed

  await tom.getByRole("button", { name: "Mark solved" }).click();
  await expect(tom.getByText("#1 solved")).toBeVisible();
});

test("phone tickets and the dashboard widget", async () => {
  await nav(tom).getByRole("link", { name: "Support" }).click();
  await tom.getByRole("button", { name: "New ticket" }).click();
  await tom.getByLabel(/Log a call or visit/).check();
  await tom.getByLabel("Customer name").fill("Ben Caller");
  await tom.getByLabel("Subject").fill("Opening hours on Sunday?");
  await tom.getByLabel("What did they ask?").fill("Asked if we open on Sunday.");
  await tom.getByRole("button", { name: "Create ticket" }).click();
  await expect(tom.getByRole("heading", { name: /#2\s*Opening hours on Sunday\?/ })).toBeVisible();
  await expect(tom.getByText("This ticket was logged by hand")).toBeVisible();
  expect(mail.sent).toHaveLength(1);

  await olga.goto(`/t/${slug}`);
  const w = olga.getByTestId("support-widget");
  await expect(w).toContainText("Open1");
  await expect(w).toContainText("Unassigned1");
});

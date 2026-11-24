import { expect, test, type Browser, type Page } from "@playwright/test";
import { inviteAndJoin } from "./invite.ts";

async function newUser(browser: Browser, email: string, name: string) {
  const page = await (await browser.newContext()).newPage();
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
const chats = (p: Page) => p.getByRole("list", { name: "Chats" });
const thread = (p: Page) => p.getByRole("list", { name: "Messages" });

test.beforeAll(async ({ browser }) => {
  mia = await newUser(browser, "mia.chat@example.com", "Mia Manager");
  await mia.getByLabel("Company name").fill("Chatty Co");
  await mia.getByRole("button", { name: "Create workspace" }).click();
  await expect(mia.getByRole("heading", { name: "Welcome back, Mia" })).toBeVisible();
  slug = new URL(mia.url()).pathname.split("/")[2]!;
  await mia.goto(`/t/${slug}/settings/members`);
  await inviteAndJoin(mia, browser, "sam.chat@example.com", "Sam Staff");
  sam = await newUser(browser, "sam.chat@example.com", "Sam Staff");
  await expect(sam.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();
});

test("owner adds Messages; it shows in the menu", async () => {
  await nav(mia).getByRole("link", { name: "Add features" }).click();
  await mia.getByRole("button", { name: "Add Messages" }).click();
  await expect(nav(mia).getByRole("link", { name: "Messages" })).toBeVisible();
  await nav(mia).getByRole("link", { name: "Messages" }).click();
  await expect(mia.getByText("Chat with your colleagues")).toBeVisible();
});

test("one-to-one chat: send, the other side sees it with an unread count", async () => {
  await mia.getByRole("button", { name: "New chat" }).first().click();
  await mia.getByRole("dialog").getByRole("button", { name: /Sam Staff/ }).click();
  await mia.getByLabel("Message", { exact: true }).fill("Hi Sam, can you open tomorrow?");
  await mia.getByLabel("Message", { exact: true }).press("Enter");
  await expect(thread(mia)).toContainText("Hi Sam, can you open tomorrow?");

  await sam.reload();
  await expect(nav(sam).getByRole("link", { name: /Messages/ })).toContainText("1");
  await nav(sam).getByRole("link", { name: /Messages/ }).click();
  await expect(chats(sam).getByRole("button", { name: /Mia Manager/ })).toContainText("Hi Sam, can you open tomorrow?");
  await chats(sam).getByRole("button", { name: /Mia Manager/ }).click();
  await expect(thread(sam)).toContainText("Hi Sam, can you open tomorrow?");
  await expect(nav(sam).getByRole("link", { name: /Messages/ })).not.toContainText("1");

  // Replies arrive without reloading.
  await sam.getByLabel("Message", { exact: true }).fill("Yes, no problem!");
  await sam.getByRole("button", { name: "Send" }).click();
  await expect(thread(mia)).toContainText("Yes, no problem!", { timeout: 10_000 });
});

test("edit and delete your own message", async () => {
  const mine = thread(mia).getByTestId("message").filter({ hasText: "Hi Sam, can you open tomorrow?" });
  await mine.hover();
  await mine.getByRole("button", { name: "Edit message" }).click();
  await mia.getByLabel("Edit message").fill("Hi Sam, can you open on Friday?");
  await mia.getByRole("button", { name: "Save" }).click();
  await expect(thread(mia)).toContainText("Hi Sam, can you open on Friday?");
  await expect(thread(sam)).toContainText("Hi Sam, can you open on Friday?", { timeout: 10_000 });

  const again = thread(mia).getByTestId("message").filter({ hasText: "on Friday" });
  await again.hover();
  await again.getByRole("button", { name: "Delete message" }).click();
  await mia.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(thread(mia)).toContainText("This message was deleted");
  await expect(thread(sam)).toContainText("This message was deleted", { timeout: 10_000 });
});

test("create a group, rename it, and see who's in it", async () => {
  await mia.getByRole("button", { name: "New chat" }).first().click();
  const d = mia.getByRole("dialog");
  await d.getByRole("tab", { name: "Group" }).click();
  await d.getByLabel("Group name").fill("Opening shift");
  await d.getByRole("checkbox", { name: "Sam Staff" }).click();
  await d.getByRole("button", { name: /Create group/ }).click();
  await expect(mia.getByRole("heading", { name: "Opening shift" })).toBeVisible();
  await expect(thread(mia)).toContainText("Mia Manager created the group “Opening shift” with Sam Staff");

  await mia.getByRole("button", { name: "Group options" }).click();
  await mia.getByRole("menuitem", { name: "Rename group" }).click();
  await mia.getByRole("dialog").getByLabel("Group name").fill("Morning team");
  await mia.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(mia.getByRole("heading", { name: "Morning team" })).toBeVisible();
  await expect(chats(sam).getByRole("button", { name: /Morning team/ })).toBeVisible({ timeout: 10_000 });

  await mia.getByRole("button", { name: "Group options" }).click();
  await mia.getByRole("menuitem", { name: "People" }).click();
  const people = mia.getByRole("dialog").getByRole("list", { name: "Group members" });
  await expect(people).toContainText("Mia Manager (you)");
  await expect(people).toContainText("Sam Staff");
});

test("emoji, stickers, files, polls and contacts in the group", async () => {
  test.setTimeout(90_000);
  await mia.keyboard.press("Escape");
  await chats(sam).getByRole("button", { name: /Morning team/ }).click();
  const box = mia.getByLabel("Message", { exact: true });
  // Emoji go into the text; a sticker is sent right away.
  await box.fill("Morning ");
  await mia.getByRole("button", { name: "Emoji, GIFs and stickers" }).click();
  const panel = mia.getByRole("dialog", { name: "Emoji, GIFs and stickers" });
  await panel.getByRole("button", { name: "😀" }).first().click();
  await expect(box).toHaveValue("Morning 😀");
  await panel.getByRole("tab", { name: "GIFs" }).click();
  await expect(panel).toContainText("GIF search is off");
  await panel.getByRole("tab", { name: "Stickers" }).click();
  await panel.getByRole("button", { name: "Send sticker 👍" }).click();
  await expect(thread(mia).getByRole("img", { name: "Sticker 👍" })).toBeVisible();
  await box.press("Enter");
  await expect(thread(mia)).toContainText("Morning 😀");

  // A document, sent in parts, downloads on the other side.
  await mia.getByRole("button", { name: "Attach" }).click();
  const chooser = mia.waitForEvent("filechooser");
  await mia.getByRole("menuitem", { name: "Document" }).click();
  await (await chooser).setFiles({ name: "rota.txt", mimeType: "text/plain", buffer: Buffer.from("Mon: Sam\nTue: Mia\n") });
  await box.fill("This week's rota");
  await box.press("Enter");
  await expect(thread(mia)).toContainText("rota.txt");
  await expect(thread(mia)).toContainText("This week's rota");

  // A poll others can vote on.
  await mia.getByRole("button", { name: "Attach" }).click();
  await mia.getByRole("menuitem", { name: "Poll" }).click();
  const poll = mia.getByRole("dialog");
  await poll.getByLabel("Question").fill("Team lunch?");
  await poll.getByLabel("Option 1").fill("Pizza");
  await poll.getByLabel("Option 2").fill("Sushi");
  await poll.getByRole("button", { name: "Send poll" }).click();
  const samPoll = thread(sam).getByRole("group", { name: "Poll: Team lunch?" });
  await expect(samPoll).toBeVisible({ timeout: 10_000 });
  await samPoll.getByRole("button", { name: /Sushi/ }).click();
  await expect(samPoll.getByRole("button", { name: /Sushi/ })).toHaveAttribute("aria-pressed", "true");
  await expect(thread(mia).getByRole("group", { name: "Poll: Team lunch?" }).getByRole("button", { name: /Sushi/ })).toContainText("1", { timeout: 10_000 });
  await expect(thread(sam)).toContainText("rota.txt");

  // A contact card typed in by hand.
  await sam.getByRole("button", { name: "Attach" }).click();
  await sam.getByRole("menuitem", { name: "Contact" }).click();
  const c = sam.getByRole("dialog");
  await c.getByRole("tab", { name: "Type it in" }).click();
  await c.getByLabel("Name").fill("Pat Plumber");
  await c.getByLabel("Phone").fill("+1 555 0100");
  await c.getByRole("button", { name: "Send contact" }).click();
  await expect(thread(mia).getByRole("group", { name: "Contact: Pat Plumber" })).toContainText("+1 555 0100", { timeout: 10_000 });
});

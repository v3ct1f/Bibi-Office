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

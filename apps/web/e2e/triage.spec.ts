import { expect, test } from "@playwright/test";
import { deliverMail, signIn } from "./helpers.ts";

// Runs after timetable.spec.ts (alice owns "Acme Bakery" at /p/acme-bakery).
test.describe.configure({ mode: "serial" });
let address = "";

test("support: enable and find the inbox address", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Support inbox" }).click();
  await expect(page.getByRole("switch", { name: "Disable Support inbox" })).toBeChecked();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Support" }).click();
  await expect(page.getByRole("heading", { name: "Support", level: 1 })).toBeVisible();
  await expect(page.getByText("No tickets here")).toBeVisible();
  await page.getByRole("button", { name: "Inbox address" }).click();
  const dlg = page.getByRole("dialog", { name: "Where customers reach you" });
  address = await dlg.getByLabel("Inbox email address").inputValue();
  expect(address).toMatch(/^[0-9a-f]{24}@in\.e2e\.test$/);
  await expect(dlg.getByLabel("Contact form link")).toHaveValue(/\/p\/acme-bakery\/support\/contact$/);
  await dlg.getByRole("button", { name: "Done" }).click();
});

test("customers write in by email and through the contact form", async ({ page }) => {
  expect(await deliverMail({ to: `Acme Help <${address}>`, from: "ada@example.com", name: "Ada Lovelace", subject: "Wedding cake order", text: "Can you do a 3-tier cake for June 12?", messageId: "<e2e-1@mail.example.com>" }))
    .toEqual({ accepted: true });
  await page.goto("/p/acme-bakery/support/contact");
  await expect(page.getByRole("heading", { name: "Contact Support" })).toBeVisible();
  await page.getByLabel("Your name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByLabel("Subject").fill("Gluten-free options?");
  await page.getByLabel("Message").fill("Do you bake gluten-free bread?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Thanks, we got your message" })).toBeVisible();
  await expect(page.getByText("[#2]")).toBeVisible();
});

test("team: reply, note, solve; the customer's answer reopens", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/support/inbox");
  const list = page.getByRole("list", { name: "Tickets" });
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /Unassigned\s*2/ })).toBeVisible();
  await list.getByRole("link", { name: /Wedding cake order/ }).click();
  await expect(page.getByRole("heading", { name: /\[#1\]\s*Wedding cake order/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("3-tier cake");

  await page.getByLabel("Reply to ada@example.com").fill("Yes, we can. Shall we book a tasting?");
  await page.getByRole("button", { name: "Send reply" }).click();
  const convo = page.getByRole("list", { name: "Conversation" });
  await expect(convo.getByRole("listitem")).toHaveCount(2);
  await expect(convo).toContainText("Shall we book a tasting?");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("pending");
  await expect(page.getByLabel("Assigned to")).toHaveValue(/[0-9a-f-]{36}/);   // the replier took it

  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByLabel(/Note for your team/).fill("Ada ordered last year too.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(convo.getByText("Internal note")).toBeVisible();

  await page.getByLabel("Status", { exact: true }).selectOption("solved");
  await expect(page.getByText("Solved", { exact: true }).first()).toBeVisible();

  await deliverMail({ to: address, from: "ada@example.com", subject: "Re: [#1] Wedding cake order", text: "Great, Friday works.\n\nOn Mon, Acme wrote:\n> Shall we", messageId: "<e2e-2@mail.example.com>" });
  await page.reload();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("open");
  await expect(convo.getByRole("listitem")).toHaveCount(4);
  await expect(convo.getByRole("listitem").last()).toHaveText(/Great, Friday works\.$/);
});

test("search finds tickets by number", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/support/inbox");
  await page.getByRole("searchbox", { name: "Search tickets" }).fill("#2");
  const list = page.getByRole("list", { name: "Tickets" });
  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(list).toContainText("Gluten-free options?");
});

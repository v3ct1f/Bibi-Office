import { expect, test, type Page } from "@playwright/test";

// The API runs against a fake Claude server (see playwright.config.ts), so no real key or credit is used.
test.describe.configure({ mode: "serial" });

let olga: Page;
let slug: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Olga Owner>Weekly bakery meeting.</v>

00:00:04.000 --> 00:00:08.000
<v Olga Owner>I'll order 50 kg of flour by 2026-11-27.</v>

00:00:08.000 --> 00:00:12.000
<v Ben Baker>We agreed to open on Sundays from January.</v>

00:00:12.000 --> 00:00:15.000
<v Ben Baker>Who works on Sundays?</v>
`;

test.beforeAll(async ({ browser }) => {
  olga = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
  await olga.goto("/");
  await olga.getByRole("button", { name: "Sign in" }).click();
  await olga.getByLabel("Email").fill("olga.ai@example.com");
  await olga.getByLabel("Name").fill("Olga Owner");
  await olga.getByRole("button", { name: "Sign in" }).click();
  await olga.getByLabel("Company name").fill("Pastry Sol");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
  slug = new URL(olga.url()).pathname.split("/")[2]!;
});

test("owner adds AI summaries and the API key", async () => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add AI summaries" }).click();
  await nav(olga).getByRole("link", { name: "Summaries" }).click();
  await expect(olga.getByText("AI summaries aren't set up yet")).toBeVisible();
  await expect(olga.getByText("No meeting summaries yet")).toBeVisible();

  await olga.getByRole("link", { name: "Open settings" }).click();
  await olga.getByRole("button", { name: "AI summaries settings" }).click();
  const d = olga.getByRole("dialog");
  await d.getByLabel("Anthropic API key").fill("sk-ant-e2e-key");
  await d.getByRole("button", { name: "Save settings" }).click();
  await expect(d).toBeHidden();
  await nav(olga).getByRole("link", { name: "Summaries" }).click();
  await expect(olga.getByText("AI summaries aren't set up yet")).toBeHidden();
});

test("a Teams transcript becomes a summary with action items, a task and a follow-up email", async () => {
  await olga.getByRole("button", { name: "New meeting summary" }).first().click();
  await olga.getByLabel("Transcript file").setInputFiles({ name: "weekly-meeting.vtt", mimeType: "text/vtt", buffer: Buffer.from(VTT) });
  await expect(olga.getByLabel("Notes or transcript")).toHaveValue(/Olga Owner: Weekly bakery meeting\. I'll order 50 kg of flour by 2026-11-27\.\nBen Baker: We agreed/);
  await expect(olga.getByLabel("Meeting name")).toHaveValue("weekly-meeting");
  await olga.getByLabel("Add a team member").selectOption({ label: "Olga Owner" });
  await olga.getByLabel("Add someone else").fill("Ben Baker");
  await olga.getByRole("button", { name: "Add", exact: true }).click();
  await expect(olga.getByRole("list", { name: "Attendees" })).toContainText("Ben Baker");
  await olga.getByRole("button", { name: "Summarise" }).click();

  await expect(olga.getByRole("heading", { name: "weekly-meeting" })).toBeVisible();
  await expect(olga.getByRole("group", { name: "Summary" })).toContainText("The discussion covered");
  await expect(olga.getByRole("group", { name: "Decisions" })).toContainText("We agreed to open on Sundays");
  await expect(olga.getByRole("group", { name: "Open questions" })).toContainText("Who works on Sundays?");
  const items = olga.getByRole("group", { name: "Action items" });
  await expect(items).toContainText("order 50 kg of flour by 2026-11-27");
  await expect(items).toContainText("Olga Owner");
  await items.getByRole("button", { name: "Create 1 task" }).click();
  await expect(items.getByRole("link", { name: "Task created" })).toBeVisible();

  const mail = olga.getByRole("group", { name: "Follow-up email" });
  await expect(mail).toContainText("Subject: Recap:");
  await expect(mail).toContainText("Here are the next steps");
  await expect(mail).toContainText("To: olga.ai@example.com");
  await mail.getByRole("button", { name: "Copy" }).click();
  await expect(mail.getByRole("button", { name: "Copied" })).toBeVisible();

  await nav(olga).getByRole("link", { name: "Tasks" }).click();
  await expect(olga.getByText(/order 50 kg of flour by 2026-11-27/).first()).toBeVisible();
});

test("the summary can be edited, and is listed with its action items", async () => {
  await nav(olga).getByRole("link", { name: "Summaries" }).click();
  const list = olga.getByRole("list", { name: "Summaries" });
  await expect(list).toContainText("1 action item");
  await list.getByRole("link", { name: "weekly-meeting" }).click();
  await olga.getByRole("button", { name: "Edit" }).click();
  const d = olga.getByRole("dialog");
  await d.getByLabel("Name").fill("Weekly meeting 20 Nov");
  await d.getByLabel("Key points").fill("Flour is low\nSunday openings from January");
  await d.getByRole("button", { name: "Add action item" }).click();
  await d.getByRole("group", { name: "Action item 2" }).getByLabel("What").fill("Write the Sunday rota");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(olga.getByRole("heading", { name: "Weekly meeting 20 Nov" })).toBeVisible();
  await expect(olga.getByText("· edited")).toBeVisible();
  await expect(olga.getByRole("group", { name: "Key points" })).toContainText("Sunday openings from January");
  await expect(olga.getByRole("group", { name: "Action items" }).getByRole("button", { name: "Create 1 task" })).toBeVisible();
});

test("a support ticket gets a recap and a suggested reply in its side panel", async () => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Support inbox" }).click();
  await nav(olga).getByRole("link", { name: "Support" }).click();
  await olga.getByRole("button", { name: "New ticket" }).first().click();
  await olga.getByLabel(/Log a call or visit/).check();
  await olga.getByLabel("Customer name").fill("Ana Client");
  await olga.getByLabel("Subject").fill("Cake arrived broken");
  await olga.getByLabel("What did they ask?").fill("Ana called: her birthday cake (order 1042) arrived broken. She will pick up a new one if we bake it by Saturday.");
  await olga.getByRole("button", { name: "Create ticket" }).click();
  await expect(olga.getByRole("heading", { name: /Cake arrived broken/ })).toBeVisible();

  const panel = olga.getByRole("group", { name: "AI summary" });
  await panel.getByRole("button", { name: "Summarise" }).click();
  await expect(panel).toContainText("The discussion covered");
  await expect(panel).toContainText("Suggested reply");
  await expect(panel).toContainText("We are looking into it");
  await panel.getByRole("link", { name: "Open full summary" }).click();
  await expect(olga.getByRole("group", { name: "Suggested reply" })).toBeVisible();
  await expect(olga.getByText("Support ticket", { exact: false }).first()).toBeVisible();

  await olga.goto(`/t/${slug}/m/ai/ai/tickets`);
  await expect(olga.getByRole("list", { name: "Summaries" })).toContainText("Cake arrived broken");
});

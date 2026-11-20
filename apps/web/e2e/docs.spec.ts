import { expect, test, type Browser, type Page } from "@playwright/test";
import { renderTemplate } from "../../../modules/docs/src/pdf.ts";

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

let olga: Page;
let signingLink: string;
const nav = (p: Page) => p.getByRole("navigation", { name: "Main" });
const dialog = (p: Page) => p.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  olga = (await newUser(browser, "olga.docs@example.com", "Olga Owner")).page;
  await olga.getByLabel("Company name").fill("Print Shop");
  await olga.getByRole("button", { name: "Create workspace" }).click();
  await expect(olga.getByRole("heading", { name: "Welcome back, Olga" })).toBeVisible();
});

test("owner adds Docs and files a document in a folder", async () => {
  await nav(olga).getByRole("link", { name: "Add features" }).click();
  await olga.getByRole("button", { name: "Add Docs & e-sign" }).click();
  await nav(olga).getByRole("link", { name: "Docs" }).click();
  await expect(olga.getByText("Signing emails are off")).toBeVisible();

  await olga.getByRole("button", { name: "Upload file" }).first().click();
  const d = dialog(olga);
  await d.getByLabel("File").setInputFiles({ name: "price_list.txt", mimeType: "text/plain", buffer: Buffer.from("Flyers: 20 EUR") });
  await expect(d.getByLabel("Name")).toHaveValue("price list");
  await d.getByLabel("Folder").fill("Shop / Prices");
  await d.getByRole("button", { name: "Upload" }).click();
  await expect(olga.getByRole("heading", { name: "price list" })).toBeVisible();
  await expect(olga.getByText("in Shop/Prices")).toBeVisible();

  await olga.getByRole("button", { name: "Docs" }).first().click();
  const folders = olga.getByRole("navigation", { name: "Folders" });
  await folders.getByRole("button", { name: "Prices" }).click();
  await expect(olga.getByRole("table", { name: "Documents" })).toContainText("price list");
});

test("a PDF is prepared and sent; without email the sender gets a link", async () => {
  await olga.getByRole("button", { name: "New signature request" }).click();
  const pdf = Buffer.from((await renderTemplate("Print order", "We print 500 flyers.\n\nPayment within 14 days.", [])).bytes);
  await olga.getByLabel("PDF").setInputFiles({ name: "print-order.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(olga.getByLabel("Name")).toHaveValue("print-order");
  await olga.getByLabel("Name").fill("Print order 500 flyers");
  await olga.getByRole("button", { name: "Continue" }).click();
  await expect(olga.getByRole("heading", { name: "Print order 500 flyers" })).toBeVisible();

  await olga.getByRole("button", { name: "Someone else" }).click();
  await olga.getByLabel("Signer 1 name").fill("Ana Client");
  await olga.getByLabel("Signer 1 email").fill("ana@client.test");
  await olga.getByRole("button", { name: "Send for signature" }).click();
  await expect(olga.getByText("Add a signature box for Ana Client")).toBeVisible();

  const page1 = olga.getByRole("group", { name: "Page 1" });
  await expect(page1.locator("canvas")).toBeVisible();
  // The failed send picked the signature tool for Ana already.
  await expect(olga.getByRole("toolbar", { name: "Boxes" }).getByRole("button", { name: "Signature", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page1.click({ position: { x: 150, y: 400 } });
  await expect(olga.getByRole("button", { name: "Signature for Ana Client" })).toBeVisible();
  await olga.getByRole("toolbar", { name: "Boxes" }).getByRole("button", { name: "Text", exact: true }).click();
  await page1.click({ position: { x: 150, y: 460 } });
  await olga.getByRole("group", { name: "Selected box" }).getByLabel("What to fill in").fill("Delivery address");
  await olga.getByRole("button", { name: "Send for signature" }).click();

  const sent = dialog(olga);
  await expect(sent.getByText("Send these private links")).toBeVisible();
  signingLink = (await sent.getByRole("list", { name: "Signing links" }).locator("code").textContent())!;
  expect(signingLink).toContain("/docs/sign/");
  await sent.getByRole("button", { name: "Done" }).click();
  await expect(olga.getByText("Out for signature").first()).toBeVisible();
  await expect(olga.getByRole("list", { name: "Signers" })).toContainText("Waiting");
});

test("the customer signs on the public page without an account", async ({ browser }) => {
  const ctx = await browser.newContext();
  const ana = await ctx.newPage();
  await ana.goto(signingLink);
  await expect(ana.getByText("Ana Client, please review and sign")).toBeVisible();
  await expect(ana.getByText("From Olga Owner, Print Shop")).toBeVisible();

  await ana.getByRole("button", { name: "Finish signing" }).click();
  await expect(ana.getByText("Add your signature on page 1")).toBeVisible();
  await ana.getByRole("button", { name: "Add your signature on page 1" }).click();
  await expect(dialog(ana).getByLabel("Your name")).toHaveValue("Ana Client");
  await dialog(ana).getByRole("radio", { name: "Draw" }).click();
  const pad = dialog(ana).getByLabel("Draw your signature here");
  const box = (await pad.boundingBox())!;
  await ana.mouse.move(box.x + 30, box.y + 80);
  await ana.mouse.down();
  await ana.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
  await ana.mouse.move(box.x + 220, box.y + 100, { steps: 8 });
  await ana.mouse.up();
  await dialog(ana).getByRole("button", { name: "Use this signature" }).click();
  await ana.getByLabel("Delivery address").fill("Calle Mayor 1, Madrid");
  await ana.getByRole("button", { name: "Finish signing" }).click();
  await expect(ana.getByText("Tick the box to agree")).toBeVisible();
  await ana.getByLabel(/I agree to sign this document electronically/).check();
  await ana.getByRole("button", { name: "Finish signing" }).click();
  await expect(ana.getByText("Everyone has signed")).toBeVisible();
  const download = ana.waitForEvent("download");
  await ana.getByRole("button", { name: "Download signed copy" }).click();
  expect((await download).suggestedFilename()).toBe("print-order (signed).pdf");
  await ctx.close();

  await olga.reload();
  await expect(olga.getByText("Signed", { exact: true }).first()).toBeVisible();
  await expect(olga.getByRole("button", { name: "Download signed copy" })).toBeVisible();
  await expect(olga.getByRole("list", { name: "History" })).toContainText("Signed by everyone");
  await expect(olga.getByRole("list", { name: "History" })).toContainText("Opened");
});

test("a template becomes a ready-to-send document with signature boxes", async () => {
  await nav(olga).getByRole("link", { name: "Docs" }).click();
  await olga.getByRole("navigation", { name: "Docs sections" }).getByRole("link", { name: "Templates" }).click();
  await olga.getByRole("button", { name: "New template" }).first().click();
  const d = dialog(olga);
  await d.getByLabel("Name").fill("Printing agreement");
  await d.getByLabel("Text").fill("# Printing agreement\n\nBetween {{workspace.name}} and {{customer}}.\n\n- Price: {{price}}");
  await d.getByRole("button", { name: "Save template" }).click();
  const card = olga.getByRole("group", { name: "Printing agreement" });
  await expect(card).toContainText("price");
  await card.getByRole("button", { name: "Use template" }).click();

  const fills = olga.getByRole("group", { name: "Fill-ins" });
  await expect(fills.getByLabel("Your company's name")).toHaveValue("Print Shop");
  await fills.getByLabel("Customer").fill("Café Luna");
  await fills.getByLabel("Price").fill("90 EUR");
  await olga.getByRole("button", { name: "Team member" }).click();
  await olga.getByLabel("Team member", { exact: true }).selectOption({ label: "Olga Owner (olga.docs@example.com)" });
  await olga.getByRole("button", { name: "Create document" }).click();
  await expect(olga.getByRole("heading", { name: "Printing agreement" })).toBeVisible();
  await expect(olga.getByRole("button", { name: "Signature for Olga Owner" })).toBeVisible();
  await expect(olga.getByRole("list", { name: "Boxes per signer" })).toContainText("Olga Owner: 3 boxes");

  // Olga signs it herself from the app
  await olga.getByRole("button", { name: "Send for signature" }).click();
  await dialog(olga).getByRole("button", { name: "Done" }).click();
  await olga.getByRole("button", { name: "Sign now" }).click();
  await expect(olga.getByText("Olga Owner, please review and sign")).toBeVisible();
  await olga.getByRole("button", { name: "Add your signature on page 1" }).click();
  await dialog(olga).getByRole("button", { name: "Use this signature" }).click();
  await olga.getByLabel(/I agree to sign this document electronically/).check();
  await olga.getByRole("button", { name: "Finish signing" }).click();
  await expect(olga.getByText("Everyone has signed")).toBeVisible();
});

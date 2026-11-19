import { expect, test, type Page } from "@playwright/test";
import { lastMailTo, signIn } from "./helpers.ts";

// Runs after yard.spec.ts (alice owns "Acme Bakery"; contact Grace <grace@example.org>).
test.describe.configure({ mode: "serial" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("e-sign: enable, draft from a template for a contact, send", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/modules");
  await page.getByRole("switch", { name: "Enable Docs & e-sign" }).click();
  await expect(page.getByRole("switch", { name: "Disable Docs & e-sign" })).toBeChecked();
  await nav(page).getByRole("link", { name: "E-sign" }).click();
  await expect(page.getByText("No documents yet")).toBeVisible();

  await page.getByRole("tab", { name: "Templates" }).click();
  await expect(page.getByRole("list", { name: "Templates" })).toContainText("Simple agreement");
  await page.getByRole("tab", { name: "Documents" }).click();

  await page.getByRole("button", { name: "New document" }).click();
  const dlg = page.getByRole("dialog", { name: "New document" });
  await dlg.getByLabel("Find a contact (optional)").fill("Grace");
  await dlg.getByLabel("Contact", { exact: true }).selectOption({ label: "Grace (grace@example.org)" });
  await dlg.getByLabel("Field: scope").fill("Weekly bread delivery to the café.");
  await dlg.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: "Agreement with Grace" })).toBeVisible();
  await expect(page.getByLabel("Document text")).toContainText("Weekly bread delivery");
  await expect(page.getByRole("list", { name: "Signers" })).toContainText("grace@example.org");

  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Waiting for signatures")).toBeVisible();
  await expect(page.getByRole("list", { name: "Signers" })).toContainText("Sent");
});

test("signer: opens the emailed link, draws and signs", async ({ page }) => {
  const mail = await lastMailTo("grace@example.org");
  expect(mail?.subject).toBe("Please sign: Agreement with Grace");
  const link = /https?:\/\/\S+\/p\/acme-bakery\/docs\/sign\/\S+/.exec(mail!.text)![0];
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Agreement with Grace" })).toBeVisible();
  await expect(page.getByLabel("Document text")).toContainText("Weekly bread delivery");
  const shots = process.env.SCREENSHOTS_DIR;
  if (shots) {   // docs: the signing page on a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${shots}/esign-signing-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
  }

  await page.getByLabel("Your full name").fill("Grace Hopper");
  const pad = page.getByLabel("Signature drawing area");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height * 0.7);
  await page.mouse.down();
  for (const [dx, dy] of [[60, -40], [110, 10], [170, -30], [240, 20]] as const) await page.mouse.move(box.x + 20 + dx, box.y + box.height * 0.7 + dy, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Sign document" })).toBeDisabled();
  await page.getByLabel(/agree to sign it electronically/).check();
  await page.getByRole("button", { name: "Sign document" }).click();
  await expect(page.getByText("Everyone has signed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download the signed PDF" })).toBeVisible();
  const pdf = await page.request.get((await page.getByRole("link", { name: "Download the signed PDF" }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("sender: sees it signed with the evidence trail", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/docs/documents");
  await page.getByRole("table", { name: "Documents" }).getByText("Agreement with Grace").click();
  await expect(page.getByText("Signed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Signers" })).toContainText("Signed as “Grace Hopper”");
  const trail = page.getByRole("list", { name: "Evidence trail" });
  for (const k of ["created", "sent", "viewed", "signed", "completed"]) await expect(trail).toContainText(k, { ignoreCase: true });
  await expect(page.getByRole("button", { name: "Download signed PDF" })).toBeVisible();
});

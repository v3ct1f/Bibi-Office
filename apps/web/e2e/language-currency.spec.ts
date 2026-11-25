import { expect, test, type Page } from "@playwright/test";

/**
 * Language and currency: visitors pick them on the public pages (and the choice sticks in the browser); signed-in people
 * keep them on their account; a business sets its display currency in Settings. Billing is always in euros.
 */
test.describe.configure({ mode: "serial" });

const openPrefs = async (page: Page) => {
  await page.getByTestId("preferences-button").click();
  return page.getByRole("dialog");
};

test("a visitor switches the language on the plans page; it sticks, and the other public pages follow", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Your whole back office, in one place" })).toBeVisible();

  const dialog = await openPrefs(page);
  await dialog.getByLabel("Language").selectOption({ label: "Español" });   // saves, then the page reloads in Spanish
  await expect(page.getByRole("heading", { name: "Toda tu oficina, en un solo lugar" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByTestId("plan-business")).toContainText("al mes");
  await expect(page.getByTestId("plan-starter")).toContainText("Hasta 15 personas");
  await expect(page.getByRole("button", { name: "Elegir Business" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mensual" })).toBeVisible();

  // Stays after a reload and on the other public pages
  await page.reload();
  await expect(page.getByRole("heading", { name: "Toda tu oficina, en un solo lugar" })).toBeVisible();
  await page.goto("/start?plan=business&interval=monthly");
  await expect(page.getByRole("button", { name: "Continuar al pago" })).toBeVisible();
  await expect(page.getByText("Plan Business")).toBeVisible();
  await page.goto("/start/email?plan=business&interval=monthly");
  await expect(page.getByRole("heading", { name: "Añadir correo de trabajo" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();

  // Dutch, then back to English (a language not translated yet would fall back to English text, key by key)
  const d2 = await openPrefs(page);
  await d2.getByLabel("Idioma").selectOption({ label: "Nederlands" });
  await expect(page.getByRole("button", { name: "Inloggen" })).toBeVisible();
  const d3 = await openPrefs(page);
  await d3.getByLabel("Taal").selectOption({ label: "English" });
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a visitor sees plan prices in their own currency, marked as approximate, and is told billing is in euros", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByTestId("price-starter")).toHaveText("€29");
  await expect(page.getByTestId("price-note")).toContainText("euros (EUR)");

  const dialog = await openPrefs(page);
  await dialog.getByLabel("Currency").selectOption("USD");
  await page.keyboard.press("Escape");
  // €29 at the built-in rate of 1.08 = 31.32 dollars, shown as an approximation
  await expect(page.getByTestId("price-starter")).toHaveText(/^≈\s?.*31[.,]32$/);
  await expect(page.getByTestId("price-business")).toHaveText(/^≈\s?.*85[.,]32$/);   // 79 * 1.08
  await expect(page.getByTestId("price-note")).toContainText("USD");
  await expect(page.getByTestId("price-note")).toContainText("always billed in euros");

  // A currency without decimals (yen) and one with three (Kuwaiti dinar) are written the way their people write them
  await page.getByTestId("preferences-button").click();
  await page.getByRole("dialog").getByLabel("Currency").selectOption("JPY");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("price-starter")).toHaveText(/^≈\s?.*4[,.\s]?640$/);   // 29 * 160, whole yen
  await page.getByTestId("preferences-button").click();
  await page.getByRole("dialog").getByLabel("Currency").selectOption("KWD");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("price-starter")).toHaveText(/^≈\s?.*9[.,]570$/);       // 29 * 0.33 = 9.570, three decimals

  // The choice sticks and follows into sign-up, where the real price in euros is spelled out
  await page.getByTestId("preferences-button").click();
  await page.getByRole("dialog").getByLabel("Currency").selectOption("USD");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("price-starter")).toHaveText(/^≈/);
  await page.getByRole("button", { name: "Choose Starter" }).click();
  await page.getByRole("button", { name: "Skip, no thanks" }).click();
  await expect(page.getByTestId("chosen-plan")).toContainText("≈");
  await expect(page.getByTestId("price-note")).toContainText("billed in euros");
  await page.getByLabel("Your email").fill("payer@example.com");
  await page.getByRole("checkbox", { name: /business or professional use/ }).click();
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  // The checkout is in the currency that is actually charged: euros, exact, never "≈"
  await expect(page.getByTestId("demo-order")).toContainText("€29 per month");
  await expect(page.getByTestId("demo-order")).not.toContainText("≈");

  // Back to euros
  await page.goto("/plans");
  await page.getByTestId("preferences-button").click();
  await page.getByRole("dialog").getByLabel("Currency").selectOption("EUR");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("price-starter")).toHaveText("€29");
});

test.describe("signed in", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill("nora@example.com");
    await page.getByLabel("Name").fill("Nora Tulip");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Company name").fill("Tulip Shop");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back, Nora" })).toBeVisible();
  });

  test("the language is picked from the account menu and follows the person to another browser", async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /Language · Currency/ }).click();
    await page.getByRole("dialog").getByLabel("Language").selectOption({ label: "Nederlands" });
    await expect(page.getByRole("heading", { name: "Welkom terug, Nora" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Hoofdmenu" });
    await expect(nav.getByRole("link", { name: "Instellingen" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Gegevens" }).or(nav.getByText("Gegevens"))).toBeVisible();
    await expect(page.getByText("Aan de slag")).toBeVisible();
    // Dates use the chosen language: the workspace was created today, e.g. "25 nov 2026"
    await expect(page.getByText(/\b(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\.? 20\d\d\b/).first()).toBeVisible();

    // A different browser (nothing saved locally) still gets Dutch, because it is saved on the account
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welkom terug, Nora" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  });

  test("a business sets its display currency in Settings; it shows on the dashboard and sticks", async () => {
    await page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("link", { name: "Instellingen" }).click();
    const card = page.getByTestId("display-currency-card");
    await expect(card).toContainText("Weergavevaluta");
    await card.getByLabel("Weergavevaluta").selectOption("GBP");
    await card.getByRole("button", { name: "Valuta opslaan" }).click();
    await expect(card.getByRole("status")).toContainText("Opgeslagen. De weergavevaluta is nu GBP.");
    await page.reload();
    await expect(page.getByTestId("display-currency-card").getByLabel("Weergavevaluta")).toHaveValue("GBP");
    await page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByTestId("display-currency")).toHaveText("GBP");
  });

  test("the account currency is kept too, and back to English is one pick away", async () => {
    await page.getByTestId("preferences-button").click();
    await page.getByRole("dialog").getByLabel("Valuta").selectOption("CHF");
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId("preferences-button")).toContainText("CHF");
    await page.getByTestId("preferences-button").click();
    await page.getByRole("dialog").getByLabel("Taal").selectOption({ label: "English" });
    await expect(page.getByRole("heading", { name: "Welcome back, Nora" })).toBeVisible();
  });
});

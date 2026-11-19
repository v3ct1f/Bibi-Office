import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const state = () => JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8")) as Record<string, string>;

/** Sign in as a test user (token injected; app built with --mode e2e). */
export async function signIn(page: Page, user = "alice") {
  const token = state()[user]!;
  await page.addInitScript(([t, e]) => {
    (window as unknown as Record<string, string>).__OFFICE_E2E_TOKEN__ = t!;
    (window as unknown as Record<string, string>).__OFFICE_E2E_EMAIL__ = e!;
  }, [token, `${user}@example.com`]);
}

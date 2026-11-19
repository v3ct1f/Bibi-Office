import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import postgres from "postgres";

export const state = () => JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8")) as Record<string, string>;

/** Sign in as a test user (token injected; app built with --mode e2e). */
export async function signIn(page: Page, user = "alice") {
  const token = state()[user]!;
  await page.addInitScript(([t, e]) => {
    (window as unknown as Record<string, string>).__OFFICE_E2E_TOKEN__ = t!;
    (window as unknown as Record<string, string>).__OFFICE_E2E_EMAIL__ = e!;
  }, [token, `${user}@example.com`]);
}

/** Deliver an email to the API's inbound webhook, as the mail provider would. */
export async function deliverMail(mail: { to: string; from: string; name?: string; subject: string; text: string; messageId: string; inReplyTo?: string }) {
  const s = state();
  const r = await fetch(`${s.api}/api/v1/inbound/mail`, {
    method: "POST", headers: { "content-type": "application/json", "x-inbound-secret": s.inboundSecret! },
    body: JSON.stringify({ to: [mail.to], from: { email: mail.from, ...(mail.name ? { name: mail.name } : {}) }, subject: mail.subject, text: mail.text, messageId: mail.messageId, ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`inbound mail failed: ${r.status}`);
  return r.json() as Promise<{ accepted: boolean }>;
}

/** Newest queued email to an address (E2E runs no mail worker, so mail waits in the outbox). */
export async function lastMailTo(to: string, tenantSlug = "acme-bakery") {
  const sql = postgres(state().ownerUrl!, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const [t] = await tx<{ id: string }[]>`select id from tenants where slug = ${tenantSlug}`;
      await tx`select set_config('app.tenant_id', ${t!.id}, true)`;
      const [m] = await tx<{ subject: string; text_body: string }[]>`select subject, text_body from mail_outbox where ${to} = any(to_addrs) order by created_at desc, id desc limit 1`;
      return m ? { subject: m.subject, text: m.text_body } : null;
    });
  } finally { await sql.end(); }
}

import { fakeMailProvider } from "./fake-provider.ts";
import { imapProviderFromEnv } from "./imap-provider.ts";
import { DEFAULT_QUOTA_BYTES, type MailProvider } from "./provider.ts";

/**
 * The mail server and limits from the server's environment, used the same way by the API and the worker.
 * MAIL_PROVIDER: "imap" (a real mail server, see imap-provider.ts), "fake" (pretend, default outside production) or "off" (default in production).
 * MAIL_QUOTA_MB: most mail one person keeps in Office (default 2048). MAIL_TRASH_DAYS: days before Trash and Spam are emptied (default 30).
 */
export function mailProviderFromEnv(env: Record<string, string | undefined>): { provider: MailProvider | null; quotaBytes: number; trashDays: number } {
  const kind = env.MAIL_PROVIDER?.trim() || (env.NODE_ENV === "production" ? "off" : "fake");
  if (!["imap", "fake", "off"].includes(kind)) throw new Error("MAIL_PROVIDER must be imap, fake or off");
  const quotaMb = Number(env.MAIL_QUOTA_MB ?? 0), trash = Number(env.MAIL_TRASH_DAYS ?? 30);
  return {
    provider: kind === "imap" ? imapProviderFromEnv(env) : kind === "fake" ? fakeMailProvider() : null,
    quotaBytes: quotaMb > 0 ? Math.round(quotaMb * 1024 * 1024) : DEFAULT_QUOTA_BYTES,
    trashDays: Number.isInteger(trash) && trash >= 1 && trash <= 3650 ? trash : 30,
  };
}

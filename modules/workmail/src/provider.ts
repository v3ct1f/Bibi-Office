/**
 * What Work email needs from a domain + mailbox company. A real provider (a registrar reseller and a mailbox host,
 * or one company that does both) implements this; the module never talks to one directly, so it can be swapped.
 * The built-in fake (fake-provider.ts) works with no account, for local use and tests.
 */
export interface Registrant { name: string; email: string; address: string; city: string; postalCode: string; country: string; phone?: string | undefined }

export interface DomainOffer {
  domain: string;
  available: boolean;
  /** Price for the first year (and each renewal), in the smallest unit of `currency`. Null when not for sale. */
  priceCents: number | null;
  currency: string;
}

/** One DNS record the business's domain needs so mail works. */
export interface DnsRecord { type: "MX" | "TXT" | "CNAME"; host: string; value: string; priority?: number }

export interface MailboxResult { ref: string }

export class ProviderError extends Error {
  constructor(message: string, readonly code = "provider_error") { super(message); }
}

export interface WorkmailProvider {
  /** Short name shown in logs, e.g. "fake" or "resellerclub". */
  readonly key: string;
  /** Is this name (or, with no dot, the name under common endings) for sale, and for how much? */
  searchDomains(query: string): Promise<DomainOffer[]>;
  /** Registers the domain in the business's own name (the registrant) and sets its mail DNS records automatically. */
  registerDomain(input: { domain: string; registrant: Registrant }): Promise<{ ref: string; expiresOn: string }>;
  /** The records a business that already owns a domain adds at its own registrar. */
  requiredRecords(domain: string): Promise<DnsRecord[]>;
  /** Are the required records in place yet? `missing` lists what still isn't. */
  checkDns(domain: string): Promise<{ ok: boolean; missing: DnsRecord[] }>;
  /** The code the owner gives a new registrar to move a domain we registered for them. */
  transferOutCode(ref: string): Promise<{ code: string }>;
  createMailbox(input: { domain: string; localPart: string; name: string; password: string }): Promise<MailboxResult>;
  /** Where the person opens their mail in a browser. */
  webmailUrl(address: string): string;
  /** Switch a mailbox off (mail stops, nothing is deleted) and back on. */
  setMailboxActive(ref: string, active: boolean): Promise<void>;
  deleteMailbox(ref: string): Promise<void>;
  setMailboxPassword(ref: string, password: string): Promise<void>;
}

/**
 * Charging for a domain. The platform (apps/api) provides this using the business's subscription/Stripe;
 * without payments set up, a domain is free and registered at once.
 */
export interface WorkmailPayments {
  chargeDomain(input: {
    tenantId: string; orderId: string; domain: string; amountCents: number; currency: string; description: string;
    /** Where to send the owner back to, as a path inside the app (starts with "/"). */
    returnPath: string;
  }): Promise<{ status: "paid" } | { status: "redirect"; url: string; ref: string }>;
  /** Has the payment started by a "redirect" result gone through? */
  isPaid(ref: string): Promise<boolean>;
}

interface Runtime { provider: WorkmailProvider | null; payments: WorkmailPayments | null }
let runtime: Runtime = { provider: null, payments: null };
/** Called once when the server starts (and by tests). `provider: null` = the feature is not set up on this server. */
export function configureWorkmail(r: Partial<Runtime>) { runtime = { ...runtime, ...r }; }
export const getProvider = () => runtime.provider;
export const getPayments = () => runtime.payments;

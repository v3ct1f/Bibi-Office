import { randomBytes } from "node:crypto";
import { ProviderError, type DnsRecord, type DomainOffer, type WorkmailPayments, type WorkmailProvider } from "./provider.ts";

/**
 * A pretend provider: nothing leaves this computer and nothing costs money. Used locally, in tests and in the browser tests.
 * Rules, so tests can predict it:
 *  - names containing "taken" and a few big brands are not available
 *  - prices (first year): .com 19.00, .net 22.00, .org 20.00, .eu 15.00, .io 55.00 (EUR)
 *  - a domain whose first label starts with "dns-ok" already has its records in place; others do until
 *    `fake.setDnsOk(domain)` is called (or it was registered through us, which sets its records automatically)
 */
const PRICES: Record<string, number> = { com: 1900, net: 2200, org: 2000, eu: 1500, io: 5500 };
const BIG = new Set(["google", "microsoft", "apple", "amazon", "example"]);
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export const isDomainName = (s: string) => DOMAIN_RE.test(s);

export interface FakeProvider extends WorkmailProvider {
  /** Everything it was asked to do, in order, for tests. */
  readonly calls: { op: string; args: unknown }[];
  readonly mailboxes: Map<string, { address: string; active: boolean; password: string; deleted: boolean }>;
  readonly domains: Map<string, { domain: string; code: string; dnsOk: boolean }>;
  setDnsOk(domain: string): void;
  /** Make the next call of `op` fail once (e.g. "registerDomain"). */
  failNext(op: string): void;
}

export function fakeProvider(): FakeProvider {
  const calls: FakeProvider["calls"] = [];
  const mailboxes: FakeProvider["mailboxes"] = new Map();
  const domains: FakeProvider["domains"] = new Map();
  const failures = new Set<string>();
  let n = 0;
  const log = (op: string, args: unknown) => {
    calls.push({ op, args });
    if (failures.delete(op)) throw new ProviderError(`The fake provider was told to fail ${op}`);
  };
  const records = (domain: string): DnsRecord[] => [
    { type: "MX", host: "@", value: "mx.fake-mail.test", priority: 10 },
    { type: "TXT", host: "@", value: "v=spf1 include:spf.fake-mail.test ~all" },
    { type: "CNAME", host: "fake._domainkey", value: `${domain.replace(/\./g, "-")}.dkim.fake-mail.test` },
  ];
  const dnsOk = (domain: string) => domain.startsWith("dns-ok") || domains.get(domain)?.dnsOk === true;

  return {
    key: "fake", calls, mailboxes, domains,
    setDnsOk(domain) { const d = domains.get(domain) ?? { domain, code: "", dnsOk: false }; d.dnsOk = true; domains.set(domain, d); },
    failNext(op) { failures.add(op); },
    async searchDomains(query) {
      log("searchDomains", { query });
      const q = query.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const label = q.split(".")[0] ?? "";
      if (!label || !/^[a-z0-9-]{1,63}$/.test(label)) return [];
      const tlds = q.includes(".") ? [q.slice(label.length + 1), ...Object.keys(PRICES).filter((t) => t !== q.slice(label.length + 1))] : Object.keys(PRICES);
      const offers: DomainOffer[] = [];
      for (const tld of tlds.slice(0, 5)) {
        const domain = `${label}.${tld}`;
        const price = PRICES[tld];
        if (!isDomainName(domain)) continue;
        const free = !label.includes("taken") && !BIG.has(label) && !domains.has(domain) && price !== undefined;
        offers.push({ domain, available: free, priceCents: free ? price : null, currency: "EUR" });
      }
      return offers;
    },
    async registerDomain({ domain, registrant }) {
      log("registerDomain", { domain, registrant });
      if (domains.get(domain)?.code) throw new ProviderError("That domain is already registered", "domain_unavailable");
      const ref = `fake-domain:${domain}`;
      domains.set(domain, { domain, code: `AUTH-${randomBytes(6).toString("hex").toUpperCase()}`, dnsOk: true });
      const exp = new Date(); exp.setUTCFullYear(exp.getUTCFullYear() + 1);
      return { ref, expiresOn: exp.toISOString().slice(0, 10) };
    },
    async requiredRecords(domain) { log("requiredRecords", { domain }); return records(domain); },
    async checkDns(domain) {
      log("checkDns", { domain });
      return dnsOk(domain) ? { ok: true, missing: [] } : { ok: false, missing: records(domain) };
    },
    async transferOutCode(ref) {
      log("transferOutCode", { ref });
      const code = domains.get(ref.replace("fake-domain:", ""))?.code;
      if (!code) throw new ProviderError("Unknown domain", "not_found");
      return { code };
    },
    webmailUrl: (address) => `https://webmail.fake-mail.test/?login=${encodeURIComponent(address)}`,
    async createMailbox({ domain, localPart, name, password }) {
      log("createMailbox", { domain, localPart, name });
      const address = `${localPart}@${domain}`;
      if ([...mailboxes.values()].some((m) => m.address === address && !m.deleted)) throw new ProviderError("That address already exists", "mailbox_exists");
      const ref = `fake-mbx-${++n}`;
      mailboxes.set(ref, { address, active: true, password, deleted: false });
      return { ref };
    },
    async setMailboxActive(ref, active) {
      log("setMailboxActive", { ref, active });
      const m = mailboxes.get(ref);
      if (!m) throw new ProviderError("Unknown mailbox", "not_found");
      m.active = active;
    },
    async deleteMailbox(ref) {
      log("deleteMailbox", { ref });
      const m = mailboxes.get(ref);
      if (m) m.deleted = true;
    },
    async setMailboxPassword(ref, password) {
      log("setMailboxPassword", { ref });
      const m = mailboxes.get(ref);
      if (!m) throw new ProviderError("Unknown mailbox", "not_found");
      m.password = password;
    },
  };
}

/** Payments for local use: every domain is paid for at once. (Real servers use the platform's Stripe-backed one.) */
export const freePayments: WorkmailPayments = {
  async chargeDomain() { return { status: "paid" }; },
  async isPaid() { return true; },
};

import { and, eq, isNull, ne, gt, sql } from "drizzle-orm";
import { invitations, memberships, tenants, type Tx } from "@office/db";
import { AppError } from "./errors.ts";

/**
 * The subscription plans, in one place: what each costs, how many people it includes and which features it turns on.
 * A business on a plan can only use those features (tenants.allowed_modules follows the plan) and has a people limit.
 * Businesses with any other plan value ("free", "paid": set up by hand or via Stripe before plans) have no limits.
 */
export type PlanKey = "starter" | "business" | "complete";
export type Capability = "api" | "workflows";
export type PlanInterval = "monthly" | "yearly";

export interface Plan {
  key: PlanKey;
  name: string;
  tagline: string;
  /** Euros per month when paying monthly, and per year when paying yearly (two months free). */
  monthly: number;
  yearly: number;
  /** People included (members plus open invitations). */
  people: number;
  /** Price of each extra person per month, once extra people can be bought. Not charged yet. */
  extraPerson: number;
  /** Module keys this plan turns on. */
  features: string[];
  /** Things that aren't modules: API keys and webhooks ("api"), custom workflows ("workflows"). */
  capabilities: Capability[];
}

const STARTER = ["invoicing", "leads", "crm"];
const BUSINESS = [...STARTER, "messages", "expenses", "scheduling", "hr", "inventory", "docs", "kpi"];
const COMPLETE = [...BUSINESS, "support", "ai"];

export const PLANS: readonly Plan[] = [
  {
    key: "starter", name: "Starter", tagline: "Invoices, leads and a sales pipeline for a small team",
    monthly: 29, yearly: 290, people: 15, extraPerson: 4, features: STARTER, capabilities: [],
  },
  {
    key: "business", name: "Business", tagline: "Everything to run a business with staff",
    monthly: 79, yearly: 790, people: 30, extraPerson: 3, features: BUSINESS, capabilities: [],
  },
  {
    key: "complete", name: "Complete", tagline: "Every feature, plus automation and integrations",
    monthly: 149, yearly: 1490, people: 60, extraPerson: 2, features: COMPLETE, capabilities: ["api", "workflows"],
  },
];

/**
 * Work email (an optional extra on any plan): the company's own domain and a work mailbox per person.
 * Our selling prices, in euros, with a small margin over what the provider charges us (a domain costs us about
 * $11-12.50 a year, a mailbox about $1-1.40 a month). The sign-up pages, the demo checkout and billing all read these.
 * A domain the provider charges more for (some endings like .io) costs the customer the provider's price instead.
 */
export const WORK_EMAIL = {
  /** Euros per year for the company domain (bought once the business exists, renews yearly). */
  domainPerYear: 19,
  /** Euros per month for each work mailbox. */
  mailboxPerMonth: 3,
  /** Mailboxes in the worked example on the sign-up page ("your domain + 5 people"). */
  exampleMailboxes: 5,
  /** Most mailboxes that can be chosen at sign-up. */
  maxMailboxes: 500,
} as const;

/** What Work email adds: per month for the mailboxes, per year for the domain (0 without one). */
export const workEmailCost = (mailboxes: number, withDomain: boolean) => ({
  perMonth: mailboxes * WORK_EMAIL.mailboxPerMonth,
  perYear: withDomain ? WORK_EMAIL.domainPerYear : 0,
});

export const planByKey = (key: string | null | undefined): Plan | undefined => PLANS.find((p) => p.key === key);
export const planPrice = (p: Plan, interval: PlanInterval) => (interval === "yearly" ? p.yearly : p.monthly);

/** What this business may use: null = no plan limits (older businesses). */
export async function tenantPlan(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ plan: tenants.plan, interval: tenants.planInterval, test: tenants.planTest, changedAt: tenants.planChangedAt, stripe: tenants.stripeSubscriptionId })
    .from(tenants).where(eq(tenants.id, tenantId));
  return { key: t?.plan ?? "free", plan: planByKey(t?.plan) ?? null, interval: (t?.interval ?? "monthly") as PlanInterval, test: t?.test ?? false, changedAt: t?.changedAt ?? null, stripe: t?.stripe ?? null };
}

/** People who count against the limit: members, and invitations still waiting (not accepted, withdrawn or expired). */
export async function peopleCount(tx: Tx, tenantId: string, exceptEmail?: string) {
  const [m] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.tenantId, tenantId));
  const [i] = await tx.select({ n: sql<number>`count(*)::int` }).from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()),
      ...(exceptEmail ? [ne(invitations.email, exceptEmail)] : [])));
  return (m?.n ?? 0) + (i?.n ?? 0);
}

/** Refuses to add another person when the plan's limit is reached. `exceptEmail`: an open invitation for that address is being replaced. */
export async function assertRoomForPerson(tx: Tx, tenantId: string, exceptEmail?: string) {
  const { plan } = await tenantPlan(tx, tenantId);
  if (!plan) return;
  const used = await peopleCount(tx, tenantId, exceptEmail);
  if (used >= plan.people) {
    throw new AppError(402, "plan_limit",
      `Your ${plan.name} plan includes ${plan.people} people and all of them are used (members and waiting invitations). Upgrade under Settings → Plan to add more.`);
  }
}

/** Refuses something the plan doesn't include (API keys, webhooks, workflows). */
export async function assertCapability(tx: Tx, tenantId: string, what: Capability) {
  const { plan } = await tenantPlan(tx, tenantId);
  if (!plan || plan.capabilities.includes(what)) return;
  const label = what === "api" ? "API keys and webhooks" : "Workflows";
  const need = PLANS.find((p) => p.capabilities.includes(what));
  throw new AppError(402, "plan_feature", `${label} aren't part of your ${plan.name} plan.${need ? ` They come with ${need.name}.` : ""} Upgrade under Settings → Plan.`);
}

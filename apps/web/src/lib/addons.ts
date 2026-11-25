import type { MailboxPrice } from "@office/module-workmail/ui";
import { useTQuery } from "../api/hooks.ts";
import { useTenant } from "./tenant.tsx";

/** What the API says about paid extras (see /billing/addons). */
export interface AddonInfo {
  /** The plan's price per month (yearly plans: the year / 12), for showing the new monthly total; null without a plan. */
  planPerMonth: number | null;
  workmail: {
    /** The feature exists and the server has an email provider. */
    available: boolean;
    /** "€3 per mailbox per month" when this business pays through Stripe; null otherwise. */
    price: string | null;
    /** What each work mailbox costs per month and how this business pays it: stripe | demo (nothing charged) | free. */
    mailbox: MailboxPrice;
    active: boolean;
    enabled: boolean;
  };
}

export function useAddons() {
  const { can } = useTenant();
  return useTQuery<AddonInfo>(["addons"], "/billing/addons", undefined, { enabled: can("core:modules.read") });
}

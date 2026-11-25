import { useQueryClient } from "@tanstack/react-query";
import type { MailboxPrice } from "@office/module-workmail/ui";
import { useTMutation, useTQuery } from "../api/hooks.ts";
import { useTenant } from "./tenant.tsx";

/** What the API says about paid extras (see /billing/addons). */
export interface AddonInfo {
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

/** Turns Work email on (adds its price to the subscription) or off, and refreshes menus and permissions. */
export function useWorkmailSwitch() {
  const { api, tenant } = useTenant();
  const qc = useQueryClient();
  return useTMutation((on: boolean) => (on ? api.post("/billing/addons/workmail") : api.del("/billing/addons/workmail")), {
    invalidate: [["addons"], ["modules"], ["roles"], ["workmail-domains"]],
    success: (_r, on) => (on ? "Work email added" : "Work email removed"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["access", tenant.id] }),
  });
}

import { useEffect } from "react";

/**
 * The app icon follows the business's plan: Starter, Business and Complete each have their own picture.
 * Pages that don't belong to a business, and businesses without a plan, use the default (Starter's) icon.
 */
const PLAN_ICONS = ["starter", "business", "complete"] as const;
export const DEFAULT_ICON = "/favicon.svg";

export const planIcon = (plan?: string | null): string =>
  (PLAN_ICONS as readonly string[]).includes(plan ?? "") ? `/favicon-${plan}.svg` : DEFAULT_ICON;

/** Sets the browser tab's icon while a business is open, and puts the default back when leaving it. */
export function useTabIcon(plan?: string | null) {
  const href = planIcon(plan);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    link.href = href;
    return () => { link.href = DEFAULT_ICON; };
  }, [href]);
}

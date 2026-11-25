import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { isCurrency } from "@office/core/currency";
import { request } from "../api/client.ts";
import type { Me } from "../api/types.ts";
import { useAuth } from "../auth/auth.tsx";
import { currentLocale, hasChosenLocale, isSupportedLocale, rememberLocale } from "../i18n/core.ts";
import { hasChosenCurrency, setCurrency, useCurrency } from "./currency.tsx";

const save = (body: { locale?: string; currency?: string }) => request("PATCH", "/me/preferences", { body }).catch(() => undefined);

/**
 * Language and currency choices. Visitors keep them in the browser; signed-in people also keep them on their account,
 * so they follow them to another computer. Changing language reloads the page so every date, number and text switches together.
 */
export function usePreferences() {
  const { user } = useAuth();
  const currency = useCurrency();
  return {
    locale: currentLocale(), currency,
    async chooseLocale(code: string) {
      if (!isSupportedLocale(code)) return;
      rememberLocale(code);
      if (user) await save({ locale: code });
      window.location.reload();
    },
    chooseCurrency(code: string) {
      if (!isCurrency(code)) return;
      setCurrency(code);
      if (user) void save({ currency: code });
    },
  };
}

/** Invisible: when someone signs in, their saved choices (if any) win over the browser's; first-time choices are saved to their account. */
export function PreferencesSync() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ["me"], queryFn: () => request<Me>("GET", "/me"), staleTime: 60_000, enabled: !!user });
  const d = me.data;
  useEffect(() => {
    if (!d || d.kind !== "user") return;
    if (isSupportedLocale(d.locale)) {
      if (d.locale !== currentLocale()) { rememberLocale(d.locale); window.location.reload(); return; }
    } else if (hasChosenLocale()) void save({ locale: currentLocale() });
    if (isCurrency(d.currency)) setCurrency(d.currency);
    else if (hasChosenCurrency()) void save({ currency: localStorage.getItem("office.currency") ?? undefined });
  }, [d]);
  return null;
}

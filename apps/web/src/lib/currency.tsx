import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { BASE_CURRENCY, convertMinor, isCurrency, minorDigits, toMinor, type RatesSnapshot } from "@office/core/currency";
import { request } from "../api/client.ts";

/**
 * The currency this person likes to see prices in. Saved in the browser (and on their account once signed in).
 * Only changes what is SHOWN: prices are set and billed in euros, and nothing stored is ever converted.
 */
const KEY = "office.currency";
const read = () => { try { const c = localStorage.getItem(KEY); return isCurrency(c) ? c : null; } catch { return null; } };
let chosen: string | null = read();
const listeners = new Set<() => void>();

export const hasChosenCurrency = () => chosen !== null;
export function setCurrency(code: string) {
  if (!isCurrency(code)) return;
  chosen = code;
  try { localStorage.setItem(KEY, code); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
export const useCurrency = (): string =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => chosen ?? BASE_CURRENCY);

export type RatesResponse = RatesSnapshot & { currencies: string[] };
/** Exchange rates (units per €1), from the API; cached for five minutes. */
export const useRates = () => useQuery({
  queryKey: ["rates"], staleTime: 300_000, retry: 1,
  queryFn: () => request<RatesResponse>("GET", "/rates", { anonymous: true }),
});

const euroFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const moneyFmt = (code: string, minor: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(minor / 10 ** minorDigits(code));

/**
 * Prices for pages that sell the product (plans, sign-up). Plan prices are euros; in another currency they are
 * converted for display and marked with "≈". `exact` is always the real euro price.
 */
export function useMoney() {
  const picked = useCurrency();
  const rates = useRates().data;
  const currency = rates?.rates[picked] ? picked : BASE_CURRENCY;
  const converted = currency !== BASE_CURRENCY && !!rates;
  return {
    currency, converted,
    /** €29 -> "≈ $31.32" when a currency is picked, else "€29". */
    eur: (euros: number): string => {
      if (!converted || !rates) return euroFmt.format(euros);
      const minor = convertMinor(toMinor(euros, BASE_CURRENCY), BASE_CURRENCY, currency, rates.rates);
      return minor === null ? euroFmt.format(euros) : `≈ ${moneyFmt(currency, minor)}`;
    },
    /** Always the real price in euros: what is billed. */
    exact: (euros: number): string => euroFmt.format(euros),
    /** What 1 euro is worth in the shown currency, and when the rates are from (for the small print). */
    rateText: converted && rates ? moneyFmt(currency, convertMinor(100, BASE_CURRENCY, currency, rates.rates) ?? 0) : null,
    asOf: rates?.asOf ?? "",
  };
}

/**
 * Makes every Intl formatter that doesn't name a language (new Intl.DateTimeFormat(undefined, ...)), including the ones
 * inside feature modules, use the language the person picked instead of the browser's. Must be imported before
 * anything else that builds formatters at load time (main.tsx imports it first).
 */
import { currentIntlLocale } from "./core.ts";

const NAMES = ["DateTimeFormat", "NumberFormat", "RelativeTimeFormat", "ListFormat", "PluralRules", "Collator"] as const;
const intl = Intl as unknown as Record<string, new (...a: unknown[]) => unknown>;
for (const name of NAMES) {
  const Original = intl[name];
  if (!Original) continue;
  intl[name] = new Proxy(Original, {
    construct: (t, args, nt) => Reflect.construct(t, args[0] === undefined ? [currentIntlLocale(), ...args.slice(1)] : args, nt),
    apply: (t, self, args) => Reflect.apply(t, self, args[0] === undefined ? [currentIntlLocale(), ...args.slice(1)] : args),
  });
}

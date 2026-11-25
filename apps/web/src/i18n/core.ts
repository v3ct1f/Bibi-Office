import { createElement, Fragment, type ReactNode } from "react";
import type { Dict, TKey } from "./types.ts";
import en from "./locales/en.ts";

/**
 * Languages. Every file in ./locales is a language: add xx.ts (copy en.ts, translate, keep the keys, export `meta`) and it
 * shows up in the language pickers by itself. Missing keys fall back to English.
 */
export interface LocaleInfo { code: string; name: string; intl: string; messages: Dict }
const files = import.meta.glob<{ default: Dict; meta: { name: string; intl: string } }>("./locales/*.ts", { eager: true });
export const LOCALES: LocaleInfo[] = Object.entries(files)
  .map(([path, m]) => ({ code: path.slice("./locales/".length, -3), name: m.meta.name, intl: m.meta.intl, messages: m.default }))
  .sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.name.localeCompare(b.name)));

const KEY = "office.locale";
const byCode = (code: string | null | undefined) => LOCALES.find((l) => l.code === code?.toLowerCase().split("-")[0]);

/** The saved choice, else the first browser language we have, else English. */
export function detectLocale(): string {
  try { const saved = byCode(localStorage.getItem(KEY)); if (saved) return saved.code; } catch { /* private mode */ }
  for (const tag of typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]) {
    const l = byCode(tag); if (l) return l.code;
  }
  return "en";
}
export const hasChosenLocale = () => { try { return !!byCode(localStorage.getItem(KEY)); } catch { return false; } };
export const isSupportedLocale = (code: string | null | undefined): code is string => !!byCode(code);
export function rememberLocale(code: string) { try { localStorage.setItem(KEY, code); } catch { /* ignore */ } }

/** The language in use. Changing language reloads the page, so this is fixed for the life of the page. */
const code = detectLocale();
const active = byCode(code)!;
if (typeof document !== "undefined") document.documentElement.lang = active.code;
export const currentLocale = () => active.code;
export const currentIntlLocale = () => active.intl;

const plural = () => new Intl.PluralRules(active.intl);
const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
const raw = (key: string): string | undefined => (active.messages as Record<string, string>)[key] ?? (en as Record<string, string>)[key];

/** Text for a key in the current language, with {placeholders} filled in. With { count }, picks key_one / key_other. */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  let s: string | undefined;
  if (vars && typeof vars.count === "number") s = raw(`${key}_${plural().select(vars.count)}`) ?? raw(`${key}_other`);
  s ??= raw(key);
  return fill(s ?? key, vars);
}

/** Like t(), but placeholders can be elements (links, bold text): tx("start.agree", { terms: <a>..</a> }). */
export function tx(key: TKey, parts: Record<string, ReactNode>): ReactNode {
  const pieces = (raw(key) ?? key).split(/(\{\w+\})/).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name !== undefined && name in parts ? parts[name] : piece;
  });
  return createElement(Fragment, null, ...pieces);
}

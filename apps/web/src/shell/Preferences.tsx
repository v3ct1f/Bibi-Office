import { useMemo } from "react";
import { Coins, Globe } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTrigger, Field, Select } from "@office/ui";
import { CURRENCY_CODES } from "@office/core/currency";
import { LOCALES } from "../i18n/core.ts";
import { t } from "../i18n/core.ts";
import { usePreferences } from "../lib/preferences.tsx";

/** "EUR · Euro" in the current language. */
function useCurrencyNames() {
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(undefined, { type: "currency" }); } catch { /* old browser */ }
    return (code: string) => { const n = names?.of(code); return n && n !== code ? `${code} · ${n}` : code; };
  }, []);
}

/** The two pickers: language (reloads the page in the new language) and currency (changes what prices are shown in). */
export function PreferencesFields() {
  const p = usePreferences();
  const name = useCurrencyNames();
  return (
    <div className="grid gap-4">
      <Field label={t("lang.label")} hint={t("lang.hint")}>
        {(a) => (
          <Select {...a} value={p.locale} onChange={(e) => void p.chooseLocale(e.target.value)}>
            {LOCALES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label={t("curr.label")} hint={t("curr.hint")}>
        {(a) => (
          <Select {...a} value={p.currency} onChange={(e) => p.chooseCurrency(e.target.value)}>
            {CURRENCY_CODES.map((c) => <option key={c} value={c}>{name(c)}</option>)}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function PreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${t("lang.label")} · ${t("curr.label")}`} className="max-w-sm"><PreferencesFields /></DialogContent>
    </Dialog>
  );
}

/** Compact button for the top bar and the public pages: the current language and currency, opens the pickers. */
export function PreferencesButton({ className }: { className?: string }) {
  const p = usePreferences();
  const lang = LOCALES.find((l) => l.code === p.locale);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={className} aria-label={`${t("lang.change")} / ${t("curr.change")}`} data-testid="preferences-button">
          <Globe /> <span>{lang?.name ?? p.locale}</span> <Coins className="ml-1" /> <span>{p.currency}</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={`${t("lang.label")} · ${t("curr.label")}`} className="max-w-sm"><PreferencesFields /></DialogContent>
    </Dialog>
  );
}

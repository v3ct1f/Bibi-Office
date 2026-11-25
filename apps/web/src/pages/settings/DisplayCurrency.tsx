import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Select } from "@office/ui";
import { CURRENCY_CODES } from "@office/core/currency";
import { request } from "../../api/client.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { t } from "../../i18n/core.ts";

/**
 * The business's display currency: what its numbers are shown in, and optionally what new invoices start with.
 * It only changes a setting. Amounts already saved, and every existing invoice, keep the currency they were made in.
 */
export function DisplayCurrencyCard() {
  const { tenant, can, access } = useTenant();
  const qc = useQueryClient();
  const [value, setValue] = useState(tenant.displayCurrency);
  const [invoices, setInvoices] = useState(false);
  const hasInvoicing = access.modules.some((m) => m.key === "invoicing");
  const canInvoices = hasInvoicing && can("core:modules.manage");
  const save = useMutation({
    mutationFn: async () => {
      await request("PATCH", "/tenant/display-currency", { body: { currency: value }, tenantId: tenant.id });
      if (invoices && canInvoices) await request("PATCH", "/modules/invoicing/settings", { body: { currency: value }, tenantId: tenant.id });
      return { invoices: invoices && canInvoices };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access", tenant.id] }),
  });
  const mayEdit = can("core:tenant.manage");
  return (
    <Card data-testid="display-currency-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("set.currencyTitle")}</CardTitle>
        <CardDescription>{t("set.currencyDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label={t("set.currencyLabel")}>
          {(a) => (
            <Select {...a} value={value} disabled={!mayEdit} className="max-w-48" onChange={(e) => { setValue(e.target.value); save.reset(); }}>
              {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
        </Field>
        {canInvoices && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={invoices} onCheckedChange={(v) => { setInvoices(v === true); save.reset(); }} className="mt-0.5" aria-label={t("set.currencyInvoices", { currency: value })} />
            <span>{t("set.currencyInvoices", { currency: value })}</span>
          </label>
        )}
        {save.isError && <ErrorState error={save.error} />}
        {save.isSuccess && (
          <p role="status" className="text-sm text-success">
            {t("set.currencySaved", { currency: value })}{save.data.invoices ? ` ${t("set.currencyInvoicesDone", { currency: value })}` : ""}
          </p>
        )}
        <div><Button variant="outline" loading={save.isPending} disabled={!mayEdit || (value === tenant.displayCurrency && !invoices)} onClick={() => save.mutate()}>{t("set.currencySave")}</Button></div>
      </CardContent>
    </Card>
  );
}

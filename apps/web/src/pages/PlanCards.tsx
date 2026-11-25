import type { ReactNode } from "react";
import { Check, Info, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@office/ui";
import { t } from "../i18n/core.ts";
import { fmtDate } from "../lib/format.ts";
import { useMoney } from "../lib/currency.tsx";

export type Interval = "monthly" | "yearly";
export interface PlanFeature { key: string; name: string; description: string }
export interface PlanInfo {
  key: "starter" | "business" | "complete"; name: string; tagline: string; monthly: number; yearly: number; people: number; extraPerson: number;
  capabilities: ("api" | "workflows")[]; features: PlanFeature[];
}

/** What people see first: always a monthly price. Yearly is the same plan paid monthly for a whole year at the lower price. */
export const perMonth = (p: PlanInfo, i: Interval) => (i === "yearly" ? Math.round((p.yearly / 12) * 100) / 100 : p.monthly);
/** "€79 per month" / "€65.83 per month for a year (€790 in total)", with prices written by `fmt` (pass useMoney().eur or .exact). */
export const priceText = (p: PlanInfo, i: Interval, fmt: (euros: number) => string) =>
  i === "yearly" ? t("plans.priceYearly", { price: fmt(perMonth(p, i)), total: fmt(p.yearly) }) : t("plans.priceMonthly", { price: fmt(p.monthly) });
export const capabilityLabel = (c: "api" | "workflows") => t(c === "api" ? "plans.cap.api" : "plans.cap.workflows");

/**
 * Small print under prices: says which currency they are shown in and that billing is in euros.
 * Shown whenever a currency other than the euro is picked (and a short line otherwise on request).
 */
export function PriceNote({ always, className }: { always?: boolean; className?: string }) {
  const m = useMoney();
  if (!m.converted && !always) return null;
  return (
    <p role="note" data-testid="price-note" className={cn("flex items-start gap-2 text-xs text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{m.converted && m.rateText
        ? t("price.note", { currency: m.currency, rate: m.rateText, date: fmtDate(m.asOf) })
        : t("price.noteEur")}</span>
    </p>
  );
}

/** Monthly / yearly switch. */
export function IntervalToggle({ value, onChange }: { value: Interval; onChange: (i: Interval) => void }) {
  return (
    <div role="group" aria-label={t("plans.billingPeriod")} className="inline-flex rounded-lg border bg-surface p-1">
      {(["monthly", "yearly"] as const).map((i) => (
        <Button key={i} size="sm" variant={value === i ? "default" : "ghost"} aria-pressed={value === i} onClick={() => onChange(i)}>
          {i === "monthly" ? t("plans.monthly") : t("plans.yearly")}{i === "yearly" && <span className="text-[0.7rem] font-normal opacity-90">{t("plans.twoFree")}</span>}
        </Button>
      ))}
    </div>
  );
}

/** The three plans side by side. Each card shows only what it adds to the plan before it. */
export function PlanCards({ plans, interval, highlight, action, exact }: {
  plans: PlanInfo[]; interval: Interval; highlight?: PlanInfo["key"];
  /** Always show real euro prices (inside the app, where billing happens), whatever display currency is picked. */
  exact?: boolean;
  action: (p: PlanInfo) => ReactNode;
}) {
  const m = useMoney();
  const eur = exact ? m.exact : m.eur;
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="plan-cards">
      {plans.map((p, idx) => {
        const before = plans[idx - 1];
        const had = new Set(before?.features.map((f) => f.key));
        const added = p.features.filter((f) => !had.has(f.key));
        const newCaps = p.capabilities.filter((c) => !before?.capabilities.includes(c));
        const featured = highlight === p.key;
        return (
          <Card key={p.key} data-testid={`plan-${p.key}`} className={cn("flex flex-col", featured && "border-primary shadow-md ring-1 ring-primary/30")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {p.name}{featured && <Badge>{t("plans.mostPopular")}</Badge>}
              </CardTitle>
              <CardDescription>{p.tagline}</CardDescription>
              <div className="pt-2">
                <span className="text-3xl font-semibold tabular-nums" data-testid={`price-${p.key}`}>{eur(perMonth(p, interval))}</span>
                <span className="text-sm text-muted-foreground"> {t("plans.perMonth")}</span>
                {interval === "yearly" && (
                  <p className="text-xs text-muted-foreground">
                    {t("plans.yearlyNote", { total: eur(p.yearly), saved: eur(p.monthly * 12 - p.yearly) })}
                  </p>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-sm font-medium"><Users className="size-4 text-primary" /> {t("plans.upTo", { count: p.people })}</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="grid gap-2 text-sm">
                {before && <p className="font-medium">{t("plans.everythingIn", { plan: before.name })}</p>}
                <ul className="grid gap-1.5">
                  {added.map((f) => <li key={f.key} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{f.name}</li>)}
                  {newCaps.map((c) => <li key={c} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{capabilityLabel(c)}</li>)}
                </ul>
              </div>
              <div className="mt-auto">{action(p)}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

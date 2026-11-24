import type { ReactNode } from "react";
import { Check, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@office/ui";

export type Interval = "monthly" | "yearly";
export interface PlanFeature { key: string; name: string; description: string }
export interface PlanInfo {
  key: "starter" | "business" | "complete"; name: string; tagline: string; monthly: number; yearly: number; people: number; extraPerson: number;
  capabilities: ("api" | "workflows")[]; features: PlanFeature[];
}

const euro = new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const eur = (n: number) => euro.format(n);
/** What people see first: always a monthly price. Yearly is the same plan paid monthly for a whole year at the lower price. */
export const perMonth = (p: PlanInfo, i: Interval) => (i === "yearly" ? Math.round((p.yearly / 12) * 100) / 100 : p.monthly);
export const priceText = (p: PlanInfo, i: Interval) =>
  i === "yearly" ? `${eur(perMonth(p, i))} per month for a year (${eur(p.yearly)} in total)` : `${eur(p.monthly)} per month`;
export const CAPABILITY_LABEL = { api: "API keys and webhooks", workflows: "Your own automations (workflows)" } as const;

/** Monthly / yearly switch. */
export function IntervalToggle({ value, onChange }: { value: Interval; onChange: (i: Interval) => void }) {
  return (
    <div role="group" aria-label="Billing period" className="inline-flex rounded-lg border bg-surface p-1">
      {(["monthly", "yearly"] as const).map((i) => (
        <Button key={i} size="sm" variant={value === i ? "default" : "ghost"} aria-pressed={value === i} onClick={() => onChange(i)}>
          {i === "monthly" ? "Monthly" : "Yearly"}{i === "yearly" && <span className="text-[0.7rem] font-normal opacity-90">2 months free</span>}
        </Button>
      ))}
    </div>
  );
}

/** The three plans side by side. Each card shows only what it adds to the plan before it. */
export function PlanCards({ plans, interval, highlight, action }: {
  plans: PlanInfo[]; interval: Interval; highlight?: PlanInfo["key"];
  action: (p: PlanInfo) => ReactNode;
}) {
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
                {p.name}{featured && <Badge>Most popular</Badge>}
              </CardTitle>
              <CardDescription>{p.tagline}</CardDescription>
              <div className="pt-2">
                <span className="text-3xl font-semibold tabular-nums">{eur(perMonth(p, interval))}</span>
                <span className="text-sm text-muted-foreground"> per month</span>
                {interval === "yearly" && (
                  <p className="text-xs text-muted-foreground">
                    Paid monthly for a whole year: {eur(p.yearly)} in total by the end of the year. You save {eur(p.monthly * 12 - p.yearly)}.
                  </p>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-sm font-medium"><Users className="size-4 text-primary" /> Up to {p.people} people</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="grid gap-2 text-sm">
                {before && <p className="font-medium">Everything in {before.name}, plus:</p>}
                <ul className="grid gap-1.5">
                  {added.map((f) => <li key={f.key} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{f.name}</li>)}
                  {newCaps.map((c) => <li key={c} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{CAPABILITY_LABEL[c]}</li>)}
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

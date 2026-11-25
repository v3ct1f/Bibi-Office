import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Users } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, ErrorState, PageHeader, Skeleton, toast,
} from "@office/ui";
import { request } from "../../api/client.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { useAddons } from "../../lib/addons.ts";
import { mailboxCostBefore, type MailboxPrice } from "@office/module-workmail/ui";
import { Link } from "@tanstack/react-router";
import { fmtDate } from "../../lib/format.ts";
import { COMPANY } from "../../legal/company.ts";
import { CAPABILITY_LABEL, IntervalToggle, PlanCards, eur, perMonth, priceText, type Interval, type PlanInfo } from "../PlanCards.tsx";

interface PlanResponse {
  testMode: boolean;
  current: { key: string; interval: Interval; test: boolean; changedAt: string | null; stripe: boolean; people: number; plan: PlanInfo | null };
  plans: PlanInfo[];
}

/** Settings → Plan: what the business pays for, how many people are used, and a button to upgrade or switch. */
export function PlanPage() {
  const { tenant, can } = useTenant();
  const qc = useQueryClient();
  const q = useTQuery<PlanResponse>(["billing-plan"], "/billing/plan");
  const [interval, setIntervalValue] = useState<Interval | null>(null);
  const [target, setTarget] = useState<PlanInfo | null>(null);
  const manage = can("core:tenant.manage");
  // Work email (a paid extra): what it adds each month, with a way to manage or cancel it.
  const addons = useAddons();
  const wmOn = !!addons.data?.workmail.enabled;
  const wm = useTQuery<{ mailboxesUsed: number; mailboxPrice: MailboxPrice | null }>(["workmail-config"], "/m/workmail/config", undefined, { enabled: wmOn });

  const change = useTMutation((v: { plan: string; interval: Interval }) => request<{ plan: string; turnedOff: string[] }>("POST", "/billing/plan", { body: v, tenantId: tenant.id }), {
    invalidate: [["billing-plan"], ["modules"]],
    success: (r, v) => `You're now on ${v.plan[0]!.toUpperCase()}${v.plan.slice(1)}${r.turnedOff.length ? `. ${r.turnedOff.length} feature(s) were turned off; their data is kept.` : ""}`,
    onSuccess: () => { setTarget(null); void qc.invalidateQueries({ queryKey: ["access", tenant.id] }); },
  });
  const portal = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/billing/portal", { body: {}, tenantId: tenant.id }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: () => toast.error("The billing page couldn't be opened. Please try again."),
  });

  if (q.isPending) return <><PageHeader title="Plan" /><Skeleton className="h-64" /></>;
  if (q.isError) return <><PageHeader title="Plan" /><Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card></>;

  const { current, plans, testMode } = q.data;
  const cur = current.plan;
  const shownInterval = interval ?? current.interval;
  const order = plans.map((p) => p.key);
  const rank = (k: string) => order.indexOf(k as PlanInfo["key"]);
  const used = current.people;
  const limit = cur?.people;

  return (
    <>
      <PageHeader title="Plan" description="What your business has, and what you can switch to. Changes take effect straight away." />
      <div className="grid gap-6">
        <Card data-testid="current-plan">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              {cur ? `${cur.name} plan` : "No plan chosen"}
              {cur && <Badge variant="neutral">{eur(perMonth(cur, current.interval))} per month{current.interval === "yearly" ? ", yearly plan" : ""}</Badge>}
              {current.test && <Badge variant="warning"><FlaskConical className="size-3" /> Test payment, nothing charged</Badge>}
            </CardTitle>
            {current.stripe && <Button variant="outline" size="sm" loading={portal.isPending} onClick={() => portal.mutate()}>Manage subscription</Button>}
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {cur ? (
              <>
                <div className="grid gap-1.5">
                  <p className="flex items-center gap-1.5"><Users className="size-4 text-primary" /> <strong>{used}</strong> of <strong>{limit}</strong> people used <span className="text-muted-foreground">(members and waiting invitations)</span></p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="People used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
                    <div className={used >= limit! ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${Math.min(100, (used / limit!) * 100)}%` }} />
                  </div>
                </div>
                <p><strong>Included:</strong> {[...cur.features.map((f) => f.name), ...cur.capabilities.map((c) => CAPABILITY_LABEL[c])].join(", ")}.</p>
                {current.changedAt && <p className="text-muted-foreground">Last changed {fmtDate(current.changedAt)}.</p>}
              </>
            ) : (
              <p>Your business was set up without a plan, so every feature is available and there is no people limit. Choosing a plan below limits it to what that plan includes.</p>
            )}
          </CardContent>
        </Card>

        {wmOn && wm.data && (() => {
          const price = wm.data.mailboxPrice;
          const extra = price && price.mode !== "free" ? wm.data.mailboxesUsed * price.perMonth : 0;
          return (
            <Card data-testid="workmail-extra">
              <CardContent className="grid gap-1.5 pt-6 text-sm">
                <p><strong>Work email:</strong> {wm.data.mailboxesUsed} {wm.data.mailboxesUsed === 1 ? "mailbox" : "mailboxes"}{extra ? ` = ${eur(extra)} per month` : ""}. <span className="text-muted-foreground">{mailboxCostBefore(price).replace("This adds", "Each one adds")}</span></p>
                {cur && extra > 0 && <p data-testid="monthly-total"><strong>Total per month:</strong> {eur(Math.round((perMonth(cur, current.interval) + extra) * 100) / 100)}{current.test ? " (demo: nothing is charged)" : ""}</p>}
                {can("core:modules.manage") && <p><Link className="underline" to={`/t/${tenant.slug}/m/workmail/email`}>Manage or cancel Work email</Link> (remove a domain, or switch Work email off and stop its charge).</p>}
              </CardContent>
            </Card>
          );
        })()}

        {current.stripe ? (
          <p className="text-sm text-muted-foreground">You pay through Stripe. Use <strong>Manage subscription</strong> above to change your card or cancel. For a different plan, write to {COMPANY.email}.</p>
        ) : !testMode ? (
          <p className="text-sm text-muted-foreground">To change your plan, write to {COMPANY.email}.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{cur ? "Change plan" : "Choose a plan"}</h2>
              <IntervalToggle value={shownInterval} onChange={setIntervalValue} />
            </div>
            <PlanCards
              plans={plans} interval={shownInterval} highlight={undefined}
              action={(p) => {
                const isCurrent = cur?.key === p.key && current.interval === shownInterval;
                const up = !cur || rank(p.key) > rank(cur.key);
                return (
                  <Button className="w-full" variant={up ? "default" : "outline"} disabled={isCurrent || !manage} data-testid={`choose-${p.key}`}
                    title={!manage ? "Only owners and admins can change the plan" : undefined} onClick={() => setTarget(p)}>
                    {isCurrent ? "Your plan" : cur?.key === p.key ? `Switch to ${shownInterval}` : up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                  </Button>
                );
              }}
            />
            {!manage && <p className="text-sm text-muted-foreground">Only owners and admins can change the plan.</p>}
          </>
        )}
      </div>

      {target && (
        <ConfirmPlan
          target={target} interval={shownInterval} current={current} busy={change.isPending}
          onCancel={() => setTarget(null)} onConfirm={() => change.mutate({ plan: target.key, interval: shownInterval })}
        />
      )}
    </>
  );
}

function ConfirmPlan({ target, interval, current, busy, onCancel, onConfirm }: {
  target: PlanInfo; interval: Interval; current: PlanResponse["current"]; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const cur = current.plan;
  const keep = new Set(target.features.map((f) => f.key));
  const gained = target.features.filter((f) => !cur || !cur.features.some((c) => c.key === f.key));
  const lost = cur ? cur.features.filter((f) => !keep.has(f.key)) : [];
  const lostCaps = cur ? cur.capabilities.filter((c) => !target.capabilities.includes(c)) : [];
  const gainedCaps = target.capabilities.filter((c) => !cur?.capabilities.includes(c));
  const tooMany = current.people > target.people;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent title={`Switch to ${target.name}`} description={`${priceText(target, interval)}, up to ${target.people} people.`}>
        <div className="grid gap-3 text-sm">
          {gained.length + gainedCaps.length > 0 && (
            <p><strong>You get:</strong> {[...gained.map((f) => f.name), ...gainedCaps.map((c) => CAPABILITY_LABEL[c])].join(", ")}.</p>
          )}
          {lost.length + lostCaps.length > 0 && (
            <p className="rounded-md bg-warning-soft px-3 py-2">
              <strong>These switch off:</strong> {[...lost.map((f) => f.name), ...lostCaps.map((c) => CAPABILITY_LABEL[c])].join(", ")}. Their data is kept and comes back if you upgrade again.
            </p>
          )}
          {tooMany && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
              You have {current.people} people (members and waiting invitations) and {target.name} includes {target.people}. Remove {current.people - target.people} first.
            </p>
          )}
          <p className="flex items-start gap-1.5 text-muted-foreground"><FlaskConical className="mt-0.5 size-4 shrink-0 text-primary" /> This is a test payment: nothing is charged ({priceText(target, interval)} would be the price).</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button loading={busy} disabled={tooMany} onClick={onConfirm}>Confirm switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

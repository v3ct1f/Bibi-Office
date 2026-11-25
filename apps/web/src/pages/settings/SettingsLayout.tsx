import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Building, KeyRound, LifeBuoy, ScrollText, Shield, Sparkles, Users, Webhook } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, PageHeader, cn } from "@office/ui";
import { request } from "../../api/client.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDate } from "../../lib/format.ts";
import { t } from "../../i18n/core.ts";
import { DisplayCurrencyCard } from "./DisplayCurrency.tsx";

export const SETTINGS_NAV = [
  { path: "", label: t("set.general"), icon: Building, perm: undefined },
  { path: "/plan", label: t("set.plan"), icon: Sparkles, perm: undefined },
  { path: "/members", label: t("set.members"), icon: Users, perm: "core:members.read" },
  { path: "/roles", label: t("set.roles"), icon: Shield, perm: "core:roles.read" },
  { path: "/api-keys", label: t("set.apiKeys"), icon: KeyRound, perm: "core:apikeys.manage" },
  { path: "/webhooks", label: t("set.webhooks"), icon: Webhook, perm: "core:webhooks.manage" },
  { path: "/audit", label: t("set.audit"), icon: ScrollText, perm: "core:audit.read" },
  { path: "/support", label: t("set.support"), icon: LifeBuoy, perm: "core:members.manage" },
];

export function SettingsLayout() {
  const { tenant, can } = useTenant();
  const path = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") });
  const base = `/t/${tenant.slug}/settings`;
  return (
    <div className="grid gap-6 lg:grid-cols-[12rem_1fr]">
      <nav aria-label={t("set.nav")} className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
        {SETTINGS_NAV.filter((n) => can(n.perm)).map((n) => {
          const to = base + n.path;
          const active = path === to;
          return (
            <Link key={n.path} to={to} aria-current={active ? "page" : undefined}
              className={cn("flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              <n.icon className="size-4" />{n.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0"><Outlet /></div>
    </div>
  );
}

export function GeneralSettings() {
  const { tenant, access, can } = useTenant();
  const portal = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/billing/portal", { body: {}, tenantId: tenant.id }),
    onSuccess: (r) => { window.location.href = r.url; },
  });
  const rows: [string, React.ReactNode][] = [
    [t("set.name"), tenant.name], [t("set.url"), <code key="s" className="font-mono text-xs">/t/{tenant.slug}</code>],
    [t("set.id"), <code key="i" className="font-mono text-xs break-all">{tenant.id}</code>],
    [t("set.region"), tenant.region.toUpperCase()], [t("set.planRow"), <Badge key="p" variant="neutral">{tenant.plan}</Badge>], [t("set.created"), fmtDate(tenant.createdAt)],
  ];
  return (
    <>
      <PageHeader title={t("set.general")} description={t("set.generalDesc")} />
      <div className="grid gap-6">
        <Card>
          <dl className="divide-y">
            {rows.map(([k, v]) => <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_1fr]"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-sm">{v}</dd></div>)}
          </dl>
        </Card>
        {tenant.plan === "paid" && can("core:tenant.manage") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("set.subscription")}</CardTitle>
              <CardDescription>{t("set.subscriptionDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {portal.isError && <ErrorState error={portal.error} />}
              <Button variant="outline" loading={portal.isPending || portal.isSuccess} onClick={() => portal.mutate()}>{t("set.manageSubscription")}</Button>
            </CardContent>
          </Card>
        )}
        <DisplayCurrencyCard />
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("set.access")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {access.permissions.map((p) => <Badge key={p} variant="outline" className="font-mono">{p === "*" ? "* (owner: everything)" : p}</Badge>)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

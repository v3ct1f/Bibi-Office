import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Building, KeyRound, ScrollText, Shield, Users, Webhook } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, PageHeader, cn } from "@office/ui";
import { request } from "../../api/client.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDate } from "../../lib/format.ts";

export const SETTINGS_NAV = [
  { path: "", label: "General", icon: Building, perm: undefined },
  { path: "/members", label: "Members", icon: Users, perm: "core:members.read" },
  { path: "/roles", label: "Roles", icon: Shield, perm: "core:roles.read" },
  { path: "/api-keys", label: "API keys", icon: KeyRound, perm: "core:apikeys.manage" },
  { path: "/webhooks", label: "Webhooks", icon: Webhook, perm: "core:webhooks.manage" },
  { path: "/audit", label: "Audit log", icon: ScrollText, perm: "core:audit.read" },
];

export function SettingsLayout() {
  const { tenant, can } = useTenant();
  const path = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") });
  const base = `/t/${tenant.slug}/settings`;
  return (
    <div className="grid gap-6 lg:grid-cols-[12rem_1fr]">
      <nav aria-label="Settings" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
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
    ["Name", tenant.name], ["URL", <code key="s" className="font-mono text-xs">/t/{tenant.slug}</code>],
    ["Workspace ID", <code key="i" className="font-mono text-xs break-all">{tenant.id}</code>],
    ["Data region", tenant.region.toUpperCase()], ["Plan", <Badge key="p" variant="neutral">{tenant.plan}</Badge>], ["Created", fmtDate(tenant.createdAt)],
  ];
  return (
    <>
      <PageHeader title="General" description="Workspace details. Use the Workspace ID with API keys and integrations." />
      <div className="grid gap-6">
        <Card>
          <dl className="divide-y">
            {rows.map(([k, v]) => <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_1fr]"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-sm">{v}</dd></div>)}
          </dl>
        </Card>
        {tenant.plan === "paid" && can("core:tenant.manage") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Subscription</CardTitle>
              <CardDescription>Change your card, see invoices or cancel. If you cancel, everything keeps working until the end of the month you've paid for.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {portal.isError && <ErrorState error={portal.error} />}
              <Button variant="outline" loading={portal.isPending || portal.isSuccess} onClick={() => portal.mutate()}>Manage subscription</Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-sm">Your access</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {access.permissions.map((p) => <Badge key={p} variant="outline" className="font-mono">{p === "*" ? "* (owner: everything)" : p}</Badge>)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

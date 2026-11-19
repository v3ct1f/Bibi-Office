import { useEffect } from "react";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { Button, Card, EmptyState, ErrorState } from "@office/ui";
import { request } from "../api/client.ts";
import type { Access } from "../api/types.ts";
import { TenantProvider } from "../lib/tenant.tsx";
import { AppShell, useMe } from "../shell/AppShell.tsx";
import { FullPage, Loading, rememberTenant } from "./auth.tsx";

export function TenantLayout() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const me = useMe();
  const tenant = me.data?.tenants.find((t) => t.slug === slug);
  const access = useQuery({
    queryKey: ["access", tenant?.id],
    queryFn: () => request<Access>("GET", "/me/access", { tenantId: tenant!.id }),
    enabled: !!tenant,
    staleTime: 30_000,
  });
  useEffect(() => { if (tenant) rememberTenant(tenant.slug); }, [tenant]);

  if (me.isPending || (tenant && access.isPending)) return <Loading />;
  const err = me.error ?? access.error;
  if (err) return <FullPage><Card className="w-full max-w-md"><ErrorState error={err} onRetry={() => { void me.refetch(); void access.refetch(); }} /></Card></FullPage>;
  if (!tenant || !access.data) {
    return (
      <FullPage>
        <Card className="w-full max-w-md">
          <EmptyState icon={<SearchX />} title="Workspace not found" description="It doesn’t exist or you’re not a member."
            action={<Button asChild variant="outline"><Link to="/">Go to my workspaces</Link></Button>} />
        </Card>
      </FullPage>
    );
  }
  return <TenantProvider access={access.data}><AppShell><Outlet /></AppShell></TenantProvider>;
}

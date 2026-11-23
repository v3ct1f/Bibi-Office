import { useEffect } from "react";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, PauseCircle, SearchX } from "lucide-react";
import { Button, Card, EmptyState, ErrorState } from "@office/ui";
import { request } from "../api/client.ts";
import type { Access, TenantRef } from "../api/types.ts";
import { TenantProvider } from "../lib/tenant.tsx";
import { AppShell, useMe } from "../shell/AppShell.tsx";
import { FullPage, Loading, rememberTenant } from "./auth.tsx";

export function TenantLayout() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const me = useMe();
  const member = me.data?.tenants.find((t) => t.slug === slug);
  // Not a member: a program owner may still look in (read-only), found through the business list.
  const businesses = useQuery({
    queryKey: ["platform", "businesses"], enabled: !!me.data && !member && me.data.platformAdmin,
    queryFn: () => request<{ items: { id: string; slug: string; name: string; status: "active" | "suspended" }[] }>("GET", "/platform/businesses"),
  });
  const viewed = !member ? businesses.data?.items.find((b) => b.slug === slug) : undefined;
  const tenant: TenantRef | undefined = member ?? (viewed && { id: viewed.id, slug: viewed.slug, name: viewed.name, status: "active", tenantStatus: viewed.status });
  const viewing = !member && !!viewed;
  const access = useQuery({
    queryKey: ["access", tenant?.id],
    queryFn: () => request<Access>("GET", "/me/access", { tenantId: tenant!.id }),
    enabled: !!tenant && (viewing || tenant.tenantStatus === "active"),
    staleTime: 30_000,
  });
  useEffect(() => { if (member) rememberTenant(member.slug); }, [member]);

  if (!viewing && tenant?.tenantStatus === "suspended") {
    const others = (me.data?.tenants ?? []).some((t) => t.id !== tenant.id);
    return (
      <FullPage>
        <Card className="w-full max-w-md">
          <EmptyState icon={<PauseCircle />} title={`${tenant.name} is paused`}
            description="This business account is paused, so nobody can use it right now. Nothing has been deleted. Contact the program owner to reactivate it."
            action={others ? <Button asChild variant="outline"><Link to="/">Go to my other workspaces</Link></Button> : undefined} />
        </Card>
      </FullPage>
    );
  }
  if (me.isPending || (!member && businesses.isLoading) || (tenant && access.isPending)) return <Loading />;
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
  return (
    <TenantProvider access={access.data}>
      {access.data.viewing && (
        <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm">
          <Eye className="size-4 shrink-0" />
          <span>
            You're viewing <strong>{tenant.name}</strong> as the program owner{tenant.tenantStatus === "suspended" ? " (paused)" : ""}: read-only.
            {" "}This visit is recorded in its history.
          </span>
          <Link to="/admin" className="font-medium underline">Back to Program admin</Link>
        </div>
      )}
      <AppShell><Outlet /></AppShell>
    </TenantProvider>
  );
}

import { Navigate, Outlet, createRootRouteWithContext, createRoute, createRouter, useParams } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { Button, Card, EmptyState } from "@office/ui";
import { AuthCallback, Authed, FullPage, HomeRedirect, Onboarding } from "./pages/auth.tsx";
import { TenantLayout } from "./pages/TenantLayout.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { EntityDetail, EntityList } from "./pages/data/EntityPages.tsx";
import { companiesConfig, contactsConfig, tasksConfig, type EntityConfig } from "./pages/data/entities.tsx";
import { GeneralSettings, SettingsLayout } from "./pages/settings/SettingsLayout.tsx";
import { MembersPage } from "./pages/settings/Members.tsx";
import { ColleaguesPage } from "./pages/Colleagues.tsx";
import { RolesPage } from "./pages/settings/Roles.tsx";
import { FeaturesPage } from "./pages/Features.tsx";
import { ApiKeysPage } from "./pages/settings/ApiKeys.tsx";
import { WebhooksPage } from "./pages/settings/Webhooks.tsx";
import { AuditPage } from "./pages/settings/Audit.tsx";
import { WorkflowsPage } from "./pages/workflows/Workflows.tsx";
import { WorkflowEditor } from "./pages/workflows/WorkflowEditor.tsx";
import { ModulePage, PublicModulePage } from "./modules/SlotHost.tsx";
import { useTenant } from "./lib/tenant.tsx";
import { InvitePage } from "./pages/Invite.tsx";
import { AdminPage } from "./pages/Admin.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPassword.tsx";

type AnyCfg = EntityConfig<{ id: string } & Record<string, unknown>>;
const cfg = (c: unknown) => c as AnyCfg;
const recipeSearch = (s: Record<string, unknown>): { recipe?: string } => (typeof s.recipe === "string" ? { recipe: s.recipe } : {});
const newSearch = (s: Record<string, unknown>): { new?: boolean } => (s.new === true || s.new === "true" ? { new: true } : {});

function NotFound() {
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <EmptyState icon={<SearchX />} title="Page not found" action={<Button asChild variant="outline"><Link to="/">Go home</Link></Button>} />
      </Card>
    </FullPage>
  );
}

/** Pages behind a permission show a friendly message instead of a 403 storm. */
function Gate({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useTenant();
  return can(perm) ? <>{children}</> : <Card><EmptyState title="No access" description={`You need the ${perm} permission to view this page.`} /></Card>;
}

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet, notFoundComponent: NotFound });
const index = createRoute({ getParentRoute: () => root, path: "/", component: () => <Authed><HomeRedirect /></Authed> });
const callback = createRoute({ getParentRoute: () => root, path: "/auth/callback", component: AuthCallback });
const onboarding = createRoute({ getParentRoute: () => root, path: "/onboarding", component: () => <Authed><Onboarding /></Authed> });
/** Module pages without sign-in, e.g. signing links for people outside the company. */
function PublicRoute() {
  const p = useParams({ strict: false }) as { tenantId: string; module: string; _splat?: string };
  return <PublicModulePage tenantId={p.tenantId} module={p.module} path={p._splat ?? ""} />;
}
const admin = createRoute({ getParentRoute: () => root, path: "/admin", component: () => <Authed><AdminPage /></Authed> });
const invite = createRoute({ getParentRoute: () => root, path: "/invite/$tenantId/$token", component: () => <Authed><InvitePage /></Authed> });
const forgot = createRoute({ getParentRoute: () => root, path: "/forgot-password", component: ForgotPasswordPage });
const publicPage = createRoute({ getParentRoute: () => root, path: "/p/$tenantId/$module/$", component: PublicRoute });
const tenant = createRoute({ getParentRoute: () => root, path: "/t/$slug", component: () => <Authed><TenantLayout /></Authed> });

const t = (path: string, component: () => React.ReactNode, validateSearch?: (s: Record<string, unknown>) => object) =>
  createRoute({ getParentRoute: () => tenant, path, component, ...(validateSearch ? { validateSearch } : {}) });

const settings = createRoute({ getParentRoute: () => tenant, path: "/settings", component: SettingsLayout });
const s = (path: string, perm: string | null, C: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => settings, path, component: () => (perm ? <Gate perm={perm}><C /></Gate> : <C />) });

/** The old "Apps & modules" settings page moved to "Add features". */
function OldModulesRedirect() {
  const { tenant } = useTenant();
  return <Navigate to={`/t/${tenant.slug}/features`} replace />;
}

function ModuleRoute() {
  const p = useParams({ strict: false }) as { module: string; _splat?: string };
  return <ModulePage module={p.module} path={p._splat ?? ""} />;
}

const tree = root.addChildren([
  index, callback, onboarding, admin, invite, forgot, publicPage,
  tenant.addChildren([
    t("/", Dashboard),
    t("/contacts", () => <Gate perm="core:contacts.read"><EntityList key="contacts" cfg={cfg(contactsConfig)} /></Gate>, newSearch),
    t("/contacts/$id", () => <EntityDetail cfg={cfg(contactsConfig)} />),
    t("/companies", () => <Gate perm="core:companies.read"><EntityList key="companies" cfg={cfg(companiesConfig)} /></Gate>, newSearch),
    t("/companies/$id", () => <EntityDetail cfg={cfg(companiesConfig)} />),
    t("/colleagues", () => <Gate perm="core:members.read"><ColleaguesPage /></Gate>),
    t("/tasks", () => <Gate perm="core:tasks.read"><EntityList key="tasks" cfg={cfg(tasksConfig)} /></Gate>, newSearch),
    t("/workflows", () => <Gate perm="core:workflows.read"><WorkflowsPage /></Gate>),
    t("/workflows/new", () => <Gate perm="core:workflows.manage"><WorkflowEditor key="new" /></Gate>, recipeSearch),
    t("/workflows/$id", () => <Gate perm="core:workflows.read"><WorkflowEditor /></Gate>),
    t("/features", () => <Gate perm="core:modules.read"><FeaturesPage /></Gate>),
    t("/m/$module/$", ModuleRoute),
    settings.addChildren([
      s("/", null, GeneralSettings),
      s("/members", "core:members.read", MembersPage),
      s("/roles", "core:roles.read", RolesPage),
      s("/modules", null, OldModulesRedirect),
      s("/api-keys", "core:apikeys.manage", ApiKeysPage),
      s("/webhooks", "core:webhooks.manage", WebhooksPage),
      s("/audit", "core:audit.read", AuditPage),
    ]),
  ]),
]);

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({ routeTree: tree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });

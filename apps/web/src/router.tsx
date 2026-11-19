import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Alert, Button, Spinner } from "@office/ui";
import { ApiError, errorMessage } from "./lib/api.ts";
import { auth } from "./lib/auth.ts";
import { SessionProvider, useSession } from "./lib/session.tsx";
import { Shell } from "./components/shell.tsx";
import { AuthCallbackPage, CreateTenantPage, HomePage } from "./pages/home.tsx";
import { ContactDetailPage, ContactsPage } from "./pages/contacts.tsx";
import { CompaniesPage, CompanyDetailPage } from "./pages/companies.tsx";
import { ModulesPage } from "./pages/modules.tsx";
import { MembersPage, RolesPage } from "./pages/members.tsx";
import { ApiKeysPage } from "./pages/api-keys.tsx";
import { WorkflowEditorPage, WorkflowsPage } from "./pages/workflows.tsx";
import { WebhooksPage } from "./pages/webhooks.tsx";
import { AuditPage } from "./pages/audit.tsx";
import { ModulePage, PublicModulePage } from "./pages/module-page.tsx";

const Loading = () => <div className="grid min-h-dvh place-items-center"><Spinner /></div>;

/** Authenticated area: needs a session and an organization. */
function App() {
  return (
    <SessionProvider fallback={<Loading />}>
      <Gate />
    </SessionProvider>
  );
}
function Gate() {
  const s = useSession();
  if (!s.tenant) return <CreateTenantPage first />;
  return <Shell><Outlet /></Shell>;
}

function ErrorView({ error }: { error: unknown }) {
  const unauth = error instanceof ApiError && error.status === 401;
  return (
    <div className="mx-auto grid max-w-md gap-4 p-8">
      <Alert>{unauth ? "Your session has ended." : errorMessage(error)}</Alert>
      <Button onClick={() => (unauth ? auth.login() : window.location.reload())}>{unauth ? "Sign in" : "Retry"}</Button>
    </div>
  );
}

const root = createRootRoute({ component: Outlet, errorComponent: ErrorView, notFoundComponent: () => <div className="p-8">Page not found.</div> });
const callback = createRoute({ getParentRoute: () => root, path: "/auth/callback", component: AuthCallbackPage });
const newOrg = createRoute({
  getParentRoute: () => root, path: "/new-organization",
  component: () => <SessionProvider fallback={<Loading />}><CreateTenantPage /></SessionProvider>,
});
const app = createRoute({ getParentRoute: () => root, id: "app", component: App });
// Signed-out module pages (e.g. booking). Outside "app": no sign-in, no shell.
const publicPage = createRoute({ getParentRoute: () => root, path: "/p/$tenant/$key/$", component: PublicModulePage });
const home = createRoute({ getParentRoute: () => app, path: "/", component: HomePage });
const contacts = createRoute({ getParentRoute: () => app, path: "/contacts", component: ContactsPage });
const contact = createRoute({ getParentRoute: () => app, path: "/contacts/$id", component: ContactDetailPage });
const companies = createRoute({ getParentRoute: () => app, path: "/companies", component: CompaniesPage });
const company = createRoute({ getParentRoute: () => app, path: "/companies/$id", component: CompanyDetailPage });
const modules = createRoute({ getParentRoute: () => app, path: "/admin/modules", component: ModulesPage });
const members = createRoute({ getParentRoute: () => app, path: "/admin/members", component: MembersPage });
const roles = createRoute({ getParentRoute: () => app, path: "/admin/roles", component: RolesPage });
const apiKeys = createRoute({ getParentRoute: () => app, path: "/admin/api-keys", component: ApiKeysPage });
const workflows = createRoute({ getParentRoute: () => app, path: "/admin/workflows", component: WorkflowsPage });
const workflow = createRoute({ getParentRoute: () => app, path: "/admin/workflows/$id", component: WorkflowEditorPage });
const webhooks = createRoute({ getParentRoute: () => app, path: "/admin/webhooks", component: WebhooksPage });
const audit = createRoute({ getParentRoute: () => app, path: "/admin/audit", component: AuditPage });
const modulePage = createRoute({ getParentRoute: () => app, path: "/m/$key/$", component: ModulePage });

const routeTree = root.addChildren([callback, newOrg, publicPage, app.addChildren([home, contacts, contact, companies, company, modules, members, roles, apiKeys, workflows, workflow, webhooks, audit, modulePage])]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

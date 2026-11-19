import { Suspense, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { EmptyState, Spinner } from "@office/ui";
import { errorMessage, publicApi } from "../lib/api.ts";
import { SlotBoundary } from "../modules/slot.tsx";
import { useSession } from "../lib/session.tsx";
import { useModuleUi } from "../modules/registry.ts";
import { Hosted } from "../modules/host.tsx";

/** Longest registered page route that is the path itself or a parent of it. */
export function matchPage(pages: Record<string, unknown>, path: string): { route: string; subPath: string } | null {
  const routes = Object.keys(pages).sort((a, b) => b.length - a.length);
  const route = routes.find((r) => path === r || path.startsWith(`${r}/`));
  return route ? { route, subPath: path.slice(route.length) } : null;
}

/** /m/<key>/<route>[/<sub>]: renders the module's registered page for that route. */
export function ModulePage() {
  return <SlotBoundary module="page"><Suspense fallback={<Spinner />}><ModulePageInner /></Suspense></SlotBoundary>;
}
function ModulePageInner() {
  const { key, _splat } = useParams({ strict: false }) as { key: string; _splat?: string };
  const s = useSession();
  const mod = s.modules.find((m) => m.key === key && m.enabled);
  const pages = useModuleUi(key)?.pages ?? {};
  const m = matchPage(pages, `/${(_splat ?? "").replace(/\/+$/, "")}`);
  const Page = m ? pages[m.route] : undefined;
  if (!mod || !Page || !m) return <EmptyState title="Page not found">This module is off or has no page here.</EmptyState>;
  return <Hosted key={`${key}${m.route}`} module={key} Component={Page} subPath={m.subPath} />;
}

/** /p/<tenantSlug>/<key>/<route>[/<sub>]: a module's signed-out page (no shell, no session). */
export function PublicModulePage() {
  return <Suspense fallback={<main className="mx-auto max-w-xl p-6"><Spinner /></main>}><PublicModulePageInner /></Suspense>;
}
function PublicModulePageInner() {
  const { tenant, key, _splat } = useParams({ strict: false }) as { tenant: string; key: string; _splat?: string };
  const nav = useNavigate();
  const pages = useModuleUi(key)?.publicPages ?? {};
  const m = matchPage(pages, `/${(_splat ?? "").replace(/\/+$/, "")}`);
  const api = useMemo(() => publicApi(tenant, key), [tenant, key]);
  const Page = m ? pages[m.route] : undefined;
  if (!Page || !m) return <main className="mx-auto max-w-xl p-6"><EmptyState title="Page not found" /></main>;
  return (
    <SlotBoundary module={key}>
      <Page tenantSlug={tenant} api={api} subPath={m.subPath} errorMessage={errorMessage}
        navigate={(to) => { void nav({ to: `/p/${tenant}/${key}${to}` as never }); }} />
    </SlotBoundary>
  );
}

import { useParams } from "@tanstack/react-router";
import { EmptyState } from "@office/ui";
import { useSession } from "../lib/session.tsx";
import { MODULE_UI } from "../modules/registry.ts";
import { Hosted } from "../modules/host.tsx";

/** Longest registered page route that is the path itself or a parent of it. */
export function matchPage(pages: Record<string, unknown>, path: string): { route: string; subPath: string } | null {
  const routes = Object.keys(pages).sort((a, b) => b.length - a.length);
  const route = routes.find((r) => path === r || path.startsWith(`${r}/`));
  return route ? { route, subPath: path.slice(route.length) } : null;
}

/** /m/<key>/<route>[/<sub>]: renders the module's registered page for that route. */
export function ModulePage() {
  const { key, _splat } = useParams({ strict: false }) as { key: string; _splat?: string };
  const s = useSession();
  const mod = s.modules.find((m) => m.key === key && m.enabled);
  const pages = MODULE_UI[key]?.pages ?? {};
  const m = matchPage(pages, `/${(_splat ?? "").replace(/\/+$/, "")}`);
  const Page = m ? pages[m.route] : undefined;
  if (!mod || !Page || !m) return <EmptyState title="Page not found">This module is off or has no page here.</EmptyState>;
  return <Hosted key={`${key}${m.route}`} module={key} Component={Page} subPath={m.subPath} />;
}

/**
 * Contract between the web shell (slot host) and module UI packages (`modules/<key>/ui`).
 * v1: first-party modules, bundled at build time. Modules only use what's here + @office/ui.
 *
 *   export default defineModuleUi({
 *     key: "invoicing",
 *     pages: { "/invoices": InvoiceList, "/invoices/:id": InvoiceDetail },   // nav.main / page routes
 *     components: { CompanyInvoicesTab, OutstandingWidget },                  // manifest ui.slots[].component
 *   });
 */
import { createContext, createElement, useContext, type ComponentType, type ReactNode } from "react";

export interface HttpClient {
  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
}

export interface ModuleHost {
  moduleKey: string;
  tenant: { id: string; slug: string; name: string };
  /** Effective permission check for the signed-in user in this tenant. */
  can(permission: string): boolean;
  /** Calls /api/v1/m/<moduleKey><path>. */
  api: HttpClient;
  /** Calls core /api/v1<path> (subject to the user's permissions). */
  core: HttpClient;
  /** Navigate within the module: "/invoices/123" -> /t/<slug>/m/<key>/invoices/123. */
  navigate(path: string): void;
  /** Href for a module-relative path (for <a>). */
  href(path: string): string;
  /**
   * Shows other modules' components for an entity slot inside this module's page, e.g. a panel on a ticket:
   * <host.Slot name="entity.sidebar:ticket" entityType="ticket" entityId={id} entity={{...}} />. Renders nothing when no module fills it.
   */
  Slot?: ComponentType<EntitySlotOutletProps>;
}
export interface EntitySlotOutletProps { name: string; entityType: string; entityId: string; entity?: Record<string, unknown> }

export interface PageProps { params: Record<string, string>; path: string }
export interface EntitySlotProps { entityType: string; entityId: string; entity: Record<string, unknown> }
export type SlotProps = Partial<EntitySlotProps>;

/**
 * Page without sign-in (e.g. a signing link), shown at /p/<tenantId>/<moduleKey><path> outside the app shell.
 * `api` calls the module's public routes (/api/v1/public/t/<tenantId>/m/<key><path>) without credentials.
 */
export interface PublicPageProps { params: Record<string, string>; path: string; tenantId: string; api: HttpClient }

export interface ModuleUi {
  key: string;
  pages?: Record<string, ComponentType<PageProps>>;
  publicPages?: Record<string, ComponentType<PublicPageProps>>;
  components?: Record<string, ComponentType<SlotProps>>;
}

export const defineModuleUi = (m: ModuleUi): ModuleUi => {
  for (const p of [...Object.keys(m.pages ?? {}), ...Object.keys(m.publicPages ?? {})]) {
    if (!p.startsWith("/")) throw new Error(`module ${m.key}: page route "${p}" must start with "/"`);
  }
  return m;
};

const Ctx = createContext<ModuleHost | null>(null);

export function ModuleHostProvider({ host, children }: { host: ModuleHost; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: host }, children);
}

export function useModuleHost(): ModuleHost {
  const h = useContext(Ctx);
  if (!h) throw new Error("useModuleHost must be used inside a module slot");
  return h;
}

/** "/invoices/:id" vs "/invoices/42" -> { id: "42" }; null if no match. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i]!);
    else if (seg !== b[i]) return null;
  }
  return params;
}

/** Most specific match wins (static segments beat params). */
export function findPage(m: ModuleUi, path: string): { Component: ComponentType<PageProps>; params: Record<string, string> } | null {
  return bestMatch(m.pages ?? {}, path);
}
export function findPublicPage(m: ModuleUi, path: string): { Component: ComponentType<PublicPageProps>; params: Record<string, string> } | null {
  return bestMatch(m.publicPages ?? {}, path);
}
function bestMatch<C>(pages: Record<string, C>, path: string): { Component: C; params: Record<string, string> } | null {
  const ranked = Object.entries(pages)
    .map(([pat, C]) => ({ pat, C, params: matchRoute(pat, path || "/") }))
    .filter((x) => x.params)
    .sort((x, y) => (x.pat.match(/:/g)?.length ?? 0) - (y.pat.match(/:/g)?.length ?? 0));
  const best = ranked[0];
  return best ? { Component: best.C, params: best.params! } : null;
}

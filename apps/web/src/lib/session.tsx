import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, tenantStore } from "./api.ts";
import type { Me, ModuleInfo } from "./types.ts";

interface Session {
  me: Me;
  tenantId: string | null;
  tenant: Me["tenants"][number] | null;
  permissions: Set<string>;
  modules: ModuleInfo[];
  can(p: string): boolean;
  switchTenant(id: string | null): void;
}
const Ctx = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** Same rule as the API: "*", "<module>:*", or exact. */
export function can(perms: Set<string>, p: string) {
  return perms.has("*") || perms.has(p) || perms.has(`${p.split(":")[0]}:*`);
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/me") });
  const stored = tenantStore.get();
  const tenant = me.data?.tenants.find((t) => t.id === stored) ?? me.data?.tenants[0] ?? null;
  useEffect(() => { if (me.data && tenant?.id !== stored) tenantStore.set(tenant?.id ?? null); }, [me.data, tenant?.id, stored]);

  const perms = useQuery({
    queryKey: ["tenant", tenant?.id, "permissions"], enabled: !!tenant,
    queryFn: () => get<{ permissions: string[] }>("/me/permissions"),
  });
  const mods = useQuery({
    queryKey: ["tenant", tenant?.id, "modules"], enabled: !!tenant && !!perms.data && can(new Set(perms.data.permissions), "core:modules.read"),
    queryFn: () => get<ModuleInfo[]>("/modules"),
  });

  const value = useMemo<Session | null>(() => {
    if (!me.data) return null;
    const p = new Set(perms.data?.permissions ?? []);
    return {
      me: me.data, tenant, tenantId: tenant?.id ?? null, permissions: p, modules: mods.data ?? [],
      can: (x) => can(p, x),
      switchTenant: (id) => { tenantStore.set(id); qc.invalidateQueries(); },
    };
  }, [me.data, tenant, perms.data, mods.data, qc]);

  if (me.error) throw me.error;
  if (!value || (tenant && !perms.data)) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { HttpClient } from "@office/ui/module-ui";
import { httpClient } from "../api/client.ts";
import type { Access } from "../api/types.ts";
import { hasPermission } from "./permissions.ts";

export interface TenantCtx {
  tenant: Access["tenant"];
  access: Access;
  api: HttpClient;
  can(permission: string | undefined): boolean;
  /** Slots of enabled modules (already filtered by permission server-side). */
  slots(slot: string): { module: string; moduleName: string; slot: Access["modules"][number]["slots"][number] }[];
}

const Ctx = createContext<TenantCtx | null>(null);

export function TenantProvider({ access, children }: { access: Access; children: ReactNode }) {
  const value = useMemo<TenantCtx>(() => {
    const perms = new Set(access.permissions);
    return {
      tenant: access.tenant, access,
      api: httpClient("", access.tenant.id),
      can: (p) => hasPermission(perms, p),
      slots: (slot) => access.modules.flatMap((m) => m.slots.filter((s) => s.slot === slot).map((s) => ({ module: m.key, moduleName: m.name, slot: s }))),
    };
  }, [access]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenant(): TenantCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTenant outside TenantProvider");
  return c;
}

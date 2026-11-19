import { useMemo, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ModuleApi, SlotProps } from "@office/sdk/ui";
import { api, errorMessage, getBlob, uploadFile } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import { SlotBoundary } from "./slot.tsx";

const moduleApi = (key: string): ModuleApi => {
  const base = `/m/${key}`;
  return {
    get: (p) => api(`${base}${p}`),
    post: (p, body = {}) => api(`${base}${p}`, { method: "POST", body }),
    put: (p, body) => api(`${base}${p}`, { method: "PUT", body }),
    patch: (p, body) => api(`${base}${p}`, { method: "PATCH", body }),
    del: (p) => api(`${base}${p}`, { method: "DELETE" }),
    blob: (p) => getBlob(`${base}${p}`),
    upload: (p, file, name) => uploadFile(`${base}${p}`, file, name),
    core: (p) => api(p),
  };
};

/** Renders a module component with the host props (API client, permissions, navigation) inside an error boundary. */
export function Hosted({ module, Component, entity, subPath }: {
  module: string; Component: ComponentType<SlotProps>; entity?: SlotProps["entity"]; subPath?: string;
}) {
  const s = useSession();
  const nav = useNavigate();
  const base = useMemo(() => ({
    api: moduleApi(module), can: s.can, errorMessage,
    navigate: (to: string) => { void nav({ to: to as never }); },
  }), [module, s.can, nav]);
  return (
    <SlotBoundary module={module}>
      <Component tenantId={s.tenantId!} tenantSlug={s.tenant?.slug ?? ""} {...base} {...(entity ? { entity } : {})} {...(subPath !== undefined ? { subPath } : {})} />
    </SlotBoundary>
  );
}

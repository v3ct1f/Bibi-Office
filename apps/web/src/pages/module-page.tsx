import { useParams } from "@tanstack/react-router";
import { EmptyState } from "@office/ui";
import { useSession } from "../lib/session.tsx";
import { MODULE_UI } from "../modules/registry.ts";
import { SlotBoundary } from "../modules/slot.tsx";

/** /m/<key>/<route>: renders the module's registered page for that route. */
export function ModulePage() {
  const { key, _splat } = useParams({ strict: false }) as { key: string; _splat?: string };
  const s = useSession();
  const mod = s.modules.find((m) => m.key === key && m.enabled);
  const Page = MODULE_UI[key]?.pages?.[`/${_splat ?? ""}`];
  if (!mod || !Page) return <EmptyState title="Page not found">This module is off or has no page here.</EmptyState>;
  return <SlotBoundary module={key}><Page tenantId={s.tenantId!} /></SlotBoundary>;
}

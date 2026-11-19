import { Component, type ReactNode } from "react";
import type { ModuleInfo, UiSlot } from "../lib/types.ts";
import { can } from "../lib/session.tsx";
import { lazySlotComponent, MODULE_UI_LOADERS, type ModuleUi } from "./registry.ts";

/**
 * Slots for enabled modules the user may see. With the default (lazy) registry, components load with their module's chunk;
 * tests can pass a ready registry object.
 */
export function resolveSlots(
  name: string, modules: ModuleInfo[], perms: Set<string>, registry?: Record<string, ModuleUi>,
): { module: string; slot: UiSlot; Component: NonNullable<ModuleUi["components"]>[string] }[] {
  return modules.filter((m) => m.enabled).flatMap((m) => m.ui.slots
    .filter((s) => s.slot === name && (!s.permission || can(perms, s.permission)))
    .flatMap((s) => {
      const C = !s.component ? undefined
        : registry ? registry[m.key]?.components?.[s.component]
        : m.key in MODULE_UI_LOADERS ? lazySlotComponent(m.key, s.component) : undefined;
      return C ? [{ module: m.key, slot: s, Component: C }] : [];
    }));
}

/** Nav entries contributed by modules (nav.main slots with a route). */
export function moduleNav(modules: ModuleInfo[], perms: Set<string>) {
  return modules.filter((m) => m.enabled).flatMap((m) => m.ui.slots
    .filter((s) => s.slot === "nav.main" && s.route && (!s.permission || can(perms, s.permission)))
    .map((s) => ({ module: m.key, label: s.label ?? m.name, icon: s.icon, to: `/m/${m.key}${s.route}` })));
}

/** Isolates a crashing module component so it can't take the shell down. */
export class SlotBoundary extends Component<{ module: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return <div role="alert" className="rounded-md border border-danger/40 p-3 text-sm text-danger">Module “{this.props.module}” failed to render.</div>;
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import type { ModuleInfo, UiSlot } from "../lib/types.ts";
import { can } from "../lib/session.tsx";
import { MODULE_UI, type ModuleUi } from "./registry.ts";

/** Slots for enabled modules the user may see, whose component exists in the UI registry. */
export function resolveSlots(
  name: string, modules: ModuleInfo[], perms: Set<string>, registry: Record<string, ModuleUi> = MODULE_UI,
): { module: string; slot: UiSlot; Component: NonNullable<ModuleUi["components"]>[string] }[] {
  return modules.filter((m) => m.enabled).flatMap((m) => m.ui.slots
    .filter((s) => s.slot === name && (!s.permission || can(perms, s.permission)))
    .flatMap((s) => {
      const C = s.component ? registry[m.key]?.components?.[s.component] : undefined;
      return C ? [{ module: m.key, slot: s, Component: C }] : [];
    }));
}

/** Nav entries contributed by modules (nav.main slots with a route). */
export function moduleNav(modules: ModuleInfo[], perms: Set<string>) {
  return modules.filter((m) => m.enabled).flatMap((m) => m.ui.slots
    .filter((s) => s.slot === "nav.main" && s.route && (!s.permission || can(perms, s.permission)))
    .map((s) => ({ module: m.key, label: s.label ?? m.name, to: `/m/${m.key}${s.route}` })));
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

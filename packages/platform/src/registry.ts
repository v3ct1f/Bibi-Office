import type { ActionSpec, ModuleDefinition } from "@office/sdk";

/** In-process registry of installed (built-in) modules. Built once at startup. */
export class ModuleRegistry {
  private byKey = new Map<string, ModuleDefinition>();
  private actionIndex = new Map<string, { module: ModuleDefinition; spec: ActionSpec }>();

  constructor(defs: ModuleDefinition[]) {
    for (const d of defs) {
      if (this.byKey.has(d.manifest.key)) throw new Error(`Duplicate module ${d.manifest.key}`);
      this.byKey.set(d.manifest.key, d);
      for (const [k, spec] of Object.entries(d.actions ?? {})) this.actionIndex.set(k, { module: d, spec });
    }
    for (const d of defs) {
      for (const dep of d.manifest.dependsOn) {
        if (!this.byKey.has(dep)) throw new Error(`Module ${d.manifest.key} depends on missing ${dep}`);
      }
    }
    this.order(); // throws on cycles
  }

  get(key: string) { return this.byKey.get(key); }
  all() { return [...this.byKey.values()]; }
  action(key: string) { return this.actionIndex.get(key); }
  subscribers(type: string) { return this.all().filter((d) => d.manifest.events.subscribes.includes(type)); }
  dependents(key: string) { return this.all().filter((d) => d.manifest.dependsOn.includes(key)); }
  knownEvents() { return this.all().flatMap((d) => d.manifest.events.emits.map((e) => e.type)); }

  /** Dependency order (deps first), for migrations. */
  order(): ModuleDefinition[] {
    const out: ModuleDefinition[] = [], state = new Map<string, 1 | 2>();
    const visit = (d: ModuleDefinition, path: string[]) => {
      const s = state.get(d.manifest.key);
      if (s === 2) return;
      if (s === 1) throw new Error(`Module dependency cycle: ${[...path, d.manifest.key].join(" -> ")}`);
      state.set(d.manifest.key, 1);
      for (const dep of d.manifest.dependsOn) visit(this.byKey.get(dep)!, [...path, d.manifest.key]);
      state.set(d.manifest.key, 2);
      out.push(d);
    };
    for (const d of this.byKey.values()) visit(d, []);
    return out;
  }
}

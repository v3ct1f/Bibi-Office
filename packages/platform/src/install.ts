import postgres from "postgres";
import { access } from "node:fs/promises";
import { migrate } from "@office/db";
import { tablePrefix } from "@office/sdk";
import type { ModuleRegistry } from "./registry.ts";

/**
 * Run as owner role at deploy time: apply each module's migrations (dependency order),
 * refuse modules whose tables lack tenant_id + forced RLS, and upsert the global registry.
 */
export async function installModules(ownerUrl: string, registry: ModuleRegistry, log: (m: string) => void = console.log) {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    for (const m of registry.order()) {
      const key = m.manifest.key;
      if (m.migrationsDir) {
        const exists = await access(m.migrationsDir).then(() => true, () => false);
        if (exists) await migrate(ownerUrl, m.migrationsDir, log, `module:${key}`);
      }
      const bad = await sql<{ t: string }[]>`select module_tables_missing_rls(${tablePrefix(key)}) as t`;
      if (bad.length) {
        throw new Error(`Module ${key}: tables without tenant_id/forced RLS/policy: ${bad.map((b) => b.t).join(", ")}`);
      }
      await sql`
        insert into modules (key, version, manifest) values (${key}, ${m.manifest.version}, ${sql.json(m.manifest as never)})
        on conflict (key) do update set version = excluded.version, manifest = excluded.manifest, updated_at = now()`;
      log(`module ${key}@${m.manifest.version} installed`);
    }
  } finally {
    await sql.end();
  }
}

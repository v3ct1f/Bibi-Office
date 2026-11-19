import postgres from "postgres";
import { access } from "node:fs/promises";
import { migrate } from "@office/db";
import { tablePrefix } from "@office/sdk";
import type { ModuleRegistry } from "./registry.ts";
import { moduleRoleName } from "./module-role.ts";

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
      await grantModuleRole(sql, key);
      await sql`
        insert into modules (key, version, manifest) values (${key}, ${m.manifest.version}, ${sql.json(m.manifest as never)})
        on conflict (key) do update set version = excluded.version, manifest = excluded.manifest, updated_at = now()`;
      log(`module ${key}@${m.manifest.version} installed`);
    }
  } finally {
    await sql.end();
  }
}

/**
 * The module's own DB role (see module-role.ts): NOLOGIN, no BYPASSRLS, member-of granted to office_app so the app can SET ROLE.
 * It gets exactly the privileges office_app has on the module's tables ("<prefix>_*") and nothing on core tables.
 */
async function grantModuleRole(sql: postgres.Sql, key: string) {
  const role = moduleRoleName(key), prefix = `${tablePrefix(key)}_`;
  await sql.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN NOBYPASSRLS; END IF;
  END $$`);
  await sql.unsafe(`GRANT ${role} TO office_app`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  const tables = await sql<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }[]>`
    select tablename as t,
      has_table_privilege('office_app', format('%I', tablename), 'SELECT') as s, has_table_privilege('office_app', format('%I', tablename), 'INSERT') as i,
      has_table_privilege('office_app', format('%I', tablename), 'UPDATE') as u, has_table_privilege('office_app', format('%I', tablename), 'DELETE') as d
    from pg_tables where schemaname = 'public' and left(tablename, ${prefix.length}) = ${prefix}`;
  for (const t of tables) {
    const privs = [t.s && "SELECT", t.i && "INSERT", t.u && "UPDATE", t.d && "DELETE"].filter(Boolean);
    await sql.unsafe(`REVOKE ALL ON "${t.t}" FROM ${role}`);
    if (privs.length) await sql.unsafe(`GRANT ${privs.join(", ")} ON "${t.t}" TO ${role}`);
  }
}

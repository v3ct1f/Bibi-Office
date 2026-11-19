import type postgres from "postgres";
import { withTenant, type Db } from "@office/db";
import { createModuleContext, systemContext } from "./context.ts";
import { inModuleRole } from "./module-role.ts";
import { loadEnabledModule, type ModuleDeps } from "./tenant-modules.ts";

export interface JobDeps extends ModuleDeps { db: Db }

/** Run one module job for one tenant now (no-op if the module is not enabled). Returns the job's count. */
export async function runModuleJob(d: JobDeps, tenantId: string, moduleKey: string, job: string): Promise<number> {
  const spec = d.registry.get(moduleKey)?.jobs?.[job];
  if (!spec) throw new Error(`Unknown job ${moduleKey}/${job}`);
  return withTenant(d.db, tenantId, async (tx) => {
    const loaded = await loadEnabledModule(tx, d, tenantId, moduleKey);
    if (!loaded) return 0;
    const base = systemContext(tenantId, `job:${moduleKey}/${job}:${Date.now()}`, `module:${moduleKey}`);
    base.actor = { type: "module", id: moduleKey, permissions: new Set(["*"]) };
    return (await inModuleRole(tx, moduleKey, () => spec.run(createModuleContext(tx, base, loaded.def, loaded.state)))) ?? 0;
  });
}

/**
 * Worker loop body: seed schedule rows for tenants with the module enabled, lease-claim due rows
 * (SKIP LOCKED, safe with many workers), run each in its tenant, reschedule. Returns jobs run.
 */
export async function runDueJobs(relay: postgres.Sql, d: JobDeps, limit = 20): Promise<number> {
  for (const m of d.registry.all()) {
    for (const job of Object.keys(m.jobs ?? {})) {
      await relay`
        insert into module_jobs (tenant_id, module_key, job)
        select tenant_id, module_key, ${job} from tenant_modules where module_key = ${m.manifest.key} and enabled
        on conflict do nothing`;
    }
  }
  const due = await relay<{ tenant_id: string; module_key: string; job: string }[]>`
    update module_jobs j set running_until = now() + interval '10 minutes'
    from (select tenant_id, module_key, job from module_jobs
          where next_run_at <= now() and (running_until is null or running_until < now())
          order by next_run_at limit ${limit} for update skip locked) c
    where j.tenant_id = c.tenant_id and j.module_key = c.module_key and j.job = c.job
    returning j.tenant_id, j.module_key, j.job`;
  for (const r of due) {
    const spec = d.registry.get(r.module_key)?.jobs?.[r.job];
    if (!spec) {
      // Job removed from code: park it for a day.
      await relay`update module_jobs set running_until = null, next_run_at = now() + interval '1 day'
                  where tenant_id = ${r.tenant_id} and module_key = ${r.module_key} and job = ${r.job}`;
      continue;
    }
    let error: string | null = null;
    try { await runModuleJob(d, r.tenant_id, r.module_key, r.job); }
    catch (e) { error = e instanceof Error ? e.message.slice(0, 1000) : String(e); }
    const next = error ? Math.min(spec.everySeconds, 300) : spec.everySeconds;
    await relay`update module_jobs set running_until = null, last_run_at = now(), last_error = ${error},
                next_run_at = now() + make_interval(secs => ${next})
                where tenant_id = ${r.tenant_id} and module_key = ${r.module_key} and job = ${r.job}`;
  }
  return due.length;
}

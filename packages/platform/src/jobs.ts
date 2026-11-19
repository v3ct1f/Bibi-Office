import type postgres from "postgres";
import { withTenant, type Db } from "@office/db";
import { createModuleContext, systemContext } from "./context.ts";
import { loadEnabledModule, type ModuleDeps } from "./tenant-modules.ts";

export interface JobDeps extends ModuleDeps { db: Db }

interface Due { tenant_id: string; module_key: string; job_key: string }

/**
 * One pass of the module job scheduler (worker loop). `relay` is the office_relay connection.
 * 1. Seed a state row for every (enabled tenant module, job). 2. Claim due rows (SKIP LOCKED) and push
 * their next_run_at forward before running, so parallel workers never run the same job twice in a window.
 * 3. Run each job in its own tenant tx; a module disabled since seeding is skipped. Returns jobs run.
 */
export async function runDueJobs(relay: postgres.Sql, d: JobDeps, limit = 20): Promise<number> {
  const withJobs = d.registry.all().filter((m) => Object.keys(m.jobs ?? {}).length);
  if (!withJobs.length) return 0;

  for (const m of withJobs) {
    for (const job of Object.keys(m.jobs!)) {
      await relay`
        insert into module_job_state (tenant_id, module_key, job_key)
        select tenant_id, module_key, ${job} from tenant_modules where module_key = ${m.manifest.key} and enabled
        on conflict do nothing`;
    }
  }

  const keys = withJobs.map((m) => m.manifest.key);
  const claimed = await relay.begin(async (tx) => {
    const rows = await tx<Due[]>`
      select tenant_id, module_key, job_key from module_job_state
      where next_run_at <= now() and module_key in ${tx(keys)}
      order by next_run_at limit ${limit} for update skip locked`;
    const out: Due[] = [];
    for (const r of rows) {
      const spec = d.registry.get(r.module_key)?.jobs?.[r.job_key];
      if (!spec) continue;
      await tx`
        update module_job_state set next_run_at = now() + make_interval(mins => ${spec.everyMinutes}), last_started_at = now()
        where tenant_id = ${r.tenant_id} and module_key = ${r.module_key} and job_key = ${r.job_key}`;
      out.push(r);
    }
    return out;
  });

  let ran = 0;
  for (const r of claimed) {
    let error: string | null = null;
    try {
      const did = await withTenant(d.db, r.tenant_id, async (tx) => {
        const loaded = await loadEnabledModule(tx, d, r.tenant_id, r.module_key);
        if (!loaded) return false;
        const base = systemContext(r.tenant_id, `job:${r.module_key}.${r.job_key}:${Date.now()}`, `module:${r.module_key}`);
        base.actor = { type: "module", id: r.module_key, permissions: new Set(["*"]) };
        await loaded.def.jobs![r.job_key]!.run(createModuleContext(tx, base, loaded.def, loaded.state));
        return true;
      });
      if (did) ran++;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 500);
    }
    await relay`
      update module_job_state set last_finished_at = now(), last_error = ${error}
      where tenant_id = ${r.tenant_id} and module_key = ${r.module_key} and job_key = ${r.job_key}`;
  }
  return ran;
}

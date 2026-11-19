import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import postgres from "postgres";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Apply pending *.sql migrations in order, each in its own tx, under an advisory lock. */
export async function migrate(
  url: string, dir = MIGRATIONS_DIR, log = console.log, namespace = "",
): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`select pg_advisory_lock(7238001)`;
    await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const name = namespace ? `${namespace}/${f}` : f;
      if (done.has(name)) continue;
      const body = await readFile(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into _migrations (name) values (${name})`;
      });
      applied.push(name);
      log(`migrated ${name}`);
    }
  } finally {
    await sql`select pg_advisory_unlock(7238001)`.catch(() => {});
    await sql.end();
  }
  return applied;
}

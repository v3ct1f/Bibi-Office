// Smoke test: every built-in module's metrics compute on an empty tenant (catches SQL typos in any module).
import { afterAll, beforeAll, expect, it } from "vitest";
import { MODULES } from "../../../packages/modules/src/index.ts";
import { setup } from "../../../apps/api/test/harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, tA: string;
beforeAll(async () => {
  h = await setup(MODULES);
  alice = await h.token("alice");
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  for (const m of MODULES) expect((await h.client(alice, tA).post(`/modules/${m.manifest.key}/enable`, {})).status).toBe(200);
});
afterAll(() => h?.teardown());

it("computes every published metric for weeks and months", async () => {
  const catalog = (await h.client(alice, tA).get("/metrics")).body.data as { key: string }[];
  const all = MODULES.flatMap((m) => Object.keys(m.metrics ?? {}));
  expect(catalog.map((m) => m.key).sort()).toEqual(all.sort());
  expect(all.length).toBeGreaterThanOrEqual(20);
  for (const q of ["from=2026-01-01&to=2026-03-31", "from=2025-11-01&to=2026-10-31", "from=2026-10-01&to=2026-10-31"]) {
    const r = await h.client(alice, tA).get(`/metrics/values?keys=${all.join(",")}&${q}`);
    expect(r.status).toBe(200);
    const failed = r.body.data.filter((x: { ok: boolean }) => !x.ok);
    expect(failed).toEqual([]);
  }
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLANS, syncPlanFeatures } from "@office/core";
import { setup } from "./harness.ts";

/** A feature added to a plan later reaches the businesses that are already on it. */
let h: Awaited<ReturnType<typeof setup>>;
let ids: string[];
beforeAll(async () => {
  h = await setup([]);
  const o = await h.token("pat");
  ids = await Promise.all(["old-biz", "old-complete", "no-plan", "given-extra"].map(async (slug) =>
    (await h.client(o).post("/tenants", { slug, name: slug })).body.id as string));
  await h.ownerSql`update tenants set plan = 'business', allowed_modules = '{invoicing,leads,crm,messages}' where id = ${ids[0]!}`;
  await h.ownerSql`update tenants set plan = 'complete', allowed_modules = '{invoicing}' where id = ${ids[1]!}`;
  await h.ownerSql`update tenants set plan = 'free', allowed_modules = null where id = ${ids[2]!}`;
  await h.ownerSql`update tenants set plan = 'starter', allowed_modules = '{invoicing,workmail}' where id = ${ids[3]!}`;
});
afterAll(async () => { await h.teardown(); });

const allowed = async (id: string) => ((await h.ownerSql`select allowed_modules as a from tenants where id = ${id}`)[0]!.a as string[] | null);

describe("plan features follow the plan", () => {
  it("adds what a plan now includes, and only that", async () => {
    expect(await syncPlanFeatures(h.db)).toBe(3);
    const business = PLANS.find((p) => p.key === "business")!.features;
    const complete = PLANS.find((p) => p.key === "complete")!.features;
    expect((await allowed(ids[0]!))!.sort()).toEqual([...business].sort());
    expect((await allowed(ids[0]!))).toContain("mail");
    expect((await allowed(ids[1]!))!.sort()).toEqual([...complete].sort());
    // Businesses without a plan keep having no limit.
    expect(await allowed(ids[2]!)).toBeNull();
    // A paid extra on top of the plan stays.
    expect((await allowed(ids[3]!))).toEqual(expect.arrayContaining(["invoicing", "leads", "crm", "workmail"]));
    expect((await allowed(ids[3]!))).not.toContain("mail");
  });

  it("does nothing the second time", async () => {
    expect(await syncPlanFeatures(h.db)).toBe(0);
  });
});

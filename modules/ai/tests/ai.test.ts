import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModuleContext, loadEnabledModule, systemContext, type ExecDeps } from "@office/platform";
import { withTenant } from "@office/db";
import { MAIL, setup } from "../../../apps/api/test/harness.ts";
import ai from "../src/index.ts";
import { SAMPLE, startFakeClaude } from "./fake-claude.ts";

let h: Awaited<ReturnType<typeof setup>>;
let fake: Awaited<ReturnType<typeof startFakeClaude>>;
let alice: string, dave: string, vera: string, bob: string, tA: string, tB: string, exec: ExecDeps;
const base = "/m/ai";
const c = (t: string) => h.client(t, tA);
const NOTES = "Ops sync. Flour costs rose 12%. We agreed to switch to Mill & Co. from March 1. Grace signs the contract by Feb 20. Someone posts the weekend baker ad.";

beforeAll(async () => {
  fake = await startFakeClaude();
  process.env.ANTHROPIC_BASE_URL = fake.url;
  h = await setup([ai]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, mail: MAIL, http: { allowPrivate: true, requireHttps: false } };
  [alice, dave, vera, bob] = await Promise.all(["alice", "dave", "vera", "bob"].map((u) => h.token(u))) as [string, string, string, string];
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const t of [dave, vera]) await h.client(t).get("/me");
  await c(alice).post("/members", { email: "dave@example.com", roles: ["member"] });
  await c(alice).post("/members", { email: "vera@example.com", roles: ["viewer"] });
  expect((await c(alice).post("/modules/ai/enable", {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/ai/enable", {});
});
afterAll(async () => { await h?.teardown(); await fake?.close(); });

describe("ai module", () => {
  it("sends nothing until an API key is set", async () => {
    expect((await c(dave).get(`${base}/status`)).body).toMatchObject({ configured: false, model: "claude-opus-5-5", usage: { used: 0, limit: 2_000_000 } });
    const r = await c(dave).post(`${base}/summaries`, { kind: "meeting", text: NOTES });
    expect(r.status).toBe(422);
        expect(r.body.title).toMatch(/API key/);
    expect(fake.calls).toHaveLength(0);
  });

  it("stores the key as a sealed secret", async () => {
    const s = await c(alice).patch("/modules/ai/settings", { apiKey: "sk-ant-test-0123456789" });
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toContain("sk-ant-test");
    expect(s.body.secretsSet).toEqual(["apiKey"]);
    expect((await c(dave).patch("/modules/ai/settings", { apiKey: "sk-ant-x-0123456789" })).status).toBe(403);
  });

  it("summarizes with structured output and records usage", async () => {
    const r = await c(dave).post(`${base}/summaries`, { kind: "meeting", text: NOTES });
        expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "done", title: "Weekly ops sync", kind: "meeting", model: "claude-opus-5-5", sourceText: NOTES, mine: true, result: SAMPLE });
    const call = fake.calls.at(-1)!;
    expect(call.apiKey).toBe("sk-ant-test-0123456789");
    expect(call.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, fallbacks: "default", output_config: { effort: "medium" } });
    expect(call.beta).toContain("server-side-fallback-2026-07-01");
    expect(call.body.system).toMatch(/untrusted/);
    expect(call.body.messages[0]!.content).toContain(`<document>\n${NOTES}\n</document>`);
    const st = (await c(dave).get(`${base}/status`)).body;
    expect(st.usage).toMatchObject({ requests: 1, outputTokens: 250 });
    expect(st.usage.used).toBe(r.body.inputTokens + r.body.outputTokens);
    expect(await h.events(tA, "ai.summary.created")).toHaveLength(1);
  });

  it("keeps the title the person gave, and lists without the source text", async () => {
    await c(dave).post(`${base}/summaries`, { kind: "email", title: "Supplier thread", text: NOTES });
    expect((await c(vera).get(`${base}/summaries`)).status).toBe(403);
    const l = (await c(dave).get(`${base}/summaries`)).body.data;
    expect(l.map((s: { title: string }) => s.title)).toEqual(["Supplier thread", "Weekly ops sync"]);
    expect(l[0].sourceText).toBeUndefined();
    expect(l[0].createdByName).toBeTruthy();
  });

  it("validates input and permissions", async () => {
    expect((await c(dave).post(`${base}/summaries`, { kind: "meeting", text: "too short" })).status).toBe(400);
    expect((await c(dave).post(`${base}/summaries`, { kind: "poem", text: NOTES })).status).toBe(400);
    expect((await c(vera).post(`${base}/summaries`, { kind: "meeting", text: NOTES })).status).toBe(403);
  });

  it("records a refusal without a result and without an event", async () => {
    const n = (await h.events(tA, "ai.summary.created")).length;
    const r = await c(dave).post(`${base}/summaries`, { kind: "notes", title: "Odd", text: `${NOTES} REFUSE` });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "refused", result: null, title: "Odd" });
    expect(await h.events(tA, "ai.summary.created")).toHaveLength(n);
    expect((await c(dave).post(`${base}/summaries/${r.body.id}/tasks`, { items: [0] })).status).toBe(422);
  });

  it("accepts transcript uploads and strips WebVTT timings", async () => {
    const vtt = `WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nGrace: Flour went up again.\n\n2\n00:00:05.000 --> 00:00:09.000\nSam: Then we switch to Mill & Co. in March.\n`;
    const r = await h.app.inject({
      method: "POST", url: `/api/v1/m/ai/summaries/upload?filename=standup.vtt&kind=meeting`,
      headers: { authorization: `Bearer ${dave}`, "x-tenant-id": tA, "content-type": "application/octet-stream" }, payload: Buffer.from(vtt),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ title: "standup", sourceText: "Grace: Flour went up again.\nSam: Then we switch to Mill & Co. in March." });
    const bad = await h.app.inject({
      method: "POST", url: `/api/v1/m/ai/summaries/upload?filename=x.pdf`,
      headers: { authorization: `Bearer ${dave}`, "x-tenant-id": tA, "content-type": "application/octet-stream" }, payload: Buffer.from("%PDF-1.7"),
    });
    expect(bad.statusCode).toBe(400);
  });

  it("turns chosen action items into tasks", async () => {
    const id = (await c(dave).get(`${base}/summaries`)).body.data.find((s: { title: string }) => s.title === "Weekly ops sync").id;
    const r = await c(dave).post(`${base}/summaries/${id}/tasks`, { items: [0, 1] });
    expect(r.status).toBe(201);
    expect(r.body.created.map((t: { title: string }) => t.title)).toEqual(SAMPLE.actionItems.map((a) => a.task));
    const tasks = (await c(dave).get("/tasks")).body.data as { title: string; dueAt: string | null; description: string }[];
    const signed = tasks.find((t) => t.title === "Sign the Mill & Co. supply contract")!;
    expect(signed.dueAt).toMatch(/^2027-02-20/);
    expect(signed.description).toContain("Owner: Grace");
    expect((await c(dave).get(`${base}/summaries/${id}`)).body.tasksCreated).toBe(2);
    expect((await c(dave).post(`${base}/summaries/${id}/tasks`, { items: [7] })).status).toBe(400);
    expect((await c(vera).post(`${base}/summaries/${id}/tasks`, { items: [0] })).status).toBe(403);
  });

  it("lets only the author or an admin delete", async () => {
    const id = (await c(dave).post(`${base}/summaries`, { kind: "notes", text: NOTES })).body.id;
    expect((await c(vera).del(`${base}/summaries/${id}`)).status).toBe(403);
    const mine = (await c(alice).post(`${base}/summaries`, { kind: "notes", text: NOTES })).body.id;
    expect((await c(dave).del(`${base}/summaries/${mine}`)).status).toBe(403);
    expect((await c(dave).del(`${base}/summaries/${id}`)).status).toBe(204);
    expect((await c(alice).del(`${base}/summaries/${mine}`)).status).toBe(204);
    expect((await c(dave).get(`${base}/summaries/${id}`)).status).toBe(404);
  });

  it("enforces the monthly token limit before calling the API", async () => {
    await c(alice).patch("/modules/ai/settings", { monthlyTokenLimit: 10_000 });
    await h.asOwner(tA, (tx) => tx`update ai_usage set input_tokens = 9900, output_tokens = 200`);
    const before = fake.calls.length;
    const r = await c(dave).post(`${base}/summaries`, { kind: "meeting", text: NOTES });
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/limit/);
    expect(fake.calls).toHaveLength(before);
    await c(alice).patch("/modules/ai/settings", { monthlyTokenLimit: 2_000_000 });
  });

  it("uses the chosen model, without fallbacks for Haiku", async () => {
    await c(alice).patch("/modules/ai/settings", { model: "claude-haiku-5-5", keepSource: false });
    const r = await c(dave).post(`${base}/summaries`, { kind: "notes", text: NOTES });
    expect(r.body).toMatchObject({ model: "claude-haiku-5-5", sourceText: null, sourceChars: NOTES.length });
    expect(fake.calls.at(-1)!.body.fallbacks).toBeUndefined();
    expect((await c(alice).patch("/modules/ai/settings", { model: "gpt-4" })).status).toBe(400);
    await c(alice).patch("/modules/ai/settings", { model: "claude-opus-5-5", keepSource: true });
  });

  it("explains a rejected key", async () => {
    await c(alice).patch("/modules/ai/settings", { apiKey: "sk-ant-bad-0123456789" });
    const r = await c(dave).post(`${base}/summaries`, { kind: "notes", text: NOTES });
    expect(r.status).toBe(422);
    expect(r.body.title).toMatch(/rejected the API key/);
    await c(alice).patch("/modules/ai/settings", { apiKey: "sk-ant-test-0123456789" });
  });

  it("isolates tenants (RLS)", async () => {
    const id = (await c(dave).get(`${base}/summaries`)).body.data[0].id;
    expect((await h.client(bob, tB).get(`${base}/summaries/${id}`)).status).toBe(404);
    expect((await h.client(bob, tB).get(`${base}/summaries`)).body.data).toEqual([]);
    expect((await h.client(bob, tB).get(`${base}/status`)).body).toMatchObject({ configured: false, usage: { used: 0 } });
  });

  it("runs the ai.summarize workflow action", async () => {
    const out = await withTenant(h.db, tA, async (tx) => {
      const l = (await loadEnabledModule(tx, exec, tA, "ai"))!;
      const ctx = createModuleContext(tx, systemContext(tA, "t", "workflow"), l.def, l.state);
      return h.registry.action("ai.summarize")!.spec.run(ctx, { text: NOTES, kind: "email" });
    });
    expect(out).toMatchObject({ status: "done", title: "Weekly ops sync", tldr: SAMPLE.tldr, actionItems: SAMPLE.actionItems });
    const row = (await c(dave).get(`${base}/summaries/${(out as { summaryId: string }).summaryId}`)).body;
    expect(row).toMatchObject({ kind: "email", createdByName: null, mine: false });
  });
});

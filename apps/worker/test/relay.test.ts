import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { createTestDatabase } from "@office/testing";
import { relayBatch, type Publisher } from "../src/relay.ts";

let tdb: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: postgres.Sql, relay: postgres.Sql;
const T = "0190f000-0000-7000-8000-000000000001";

beforeAll(async () => {
  tdb = await createTestDatabase();
  owner = postgres(tdb.ownerUrl, { onnotice: () => {} });
  relay = postgres(tdb.relayUrl, { onnotice: () => {} });
  await owner`insert into tenants (id, slug, name) values (${T}, 'acme', 'Acme')`;
  await owner.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${T}, true)`;
    for (let i = 0; i < 3; i++) await tx`insert into outbox (id, tenant_id, type, payload)
      values (${`0190f000-0000-7000-8000-00000000010${i}`}, ${T}, 'core.contact.created', ${tx.json({ i })})`;
  });
});
afterAll(async () => { await relay.end(); await owner.end(); await tdb.drop(); });

it("retries failures, then publishes in order with msgId = event id", async () => {
  const failing: Publisher = { publish: async () => { throw new Error("nats down"); } };
  expect(await relayBatch(relay, failing)).toBe(3);
  const [f] = await relay`select attempts, last_error from outbox order by id limit 1`;
  expect(f!.attempts).toBe(1);
  expect(f!.last_error).toContain("nats down");

  const sent: { subject: string; id: string; body: { type: string; tenantId: string } }[] = [];
  const ok: Publisher = { publish: async (subject, data, id) => { sent.push({ subject, id, body: JSON.parse(new TextDecoder().decode(data)) }); } };
  expect(await relayBatch(relay, ok)).toBe(3);
  expect(sent.map((s) => s.id)).toEqual(sent.map((s) => s.id).sort());
  expect(sent[0]!.subject).toBe(`office.${T}.core.contact.created`);
  expect(sent[0]!.body.tenantId).toBe(T);
  expect(await relayBatch(relay, ok)).toBe(0);
});

it("relay role cannot read business tables", async () => {
  await expect(relay`select * from contacts`).rejects.toThrow(/permission denied/);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "./harness.ts";
import type { Identity } from "../src/identity.ts";

/** The owner creates a colleague's sign-in account with a starting password; the colleague is a member straight away. */
const accounts = new Map<string, { name: string; password: string }>();
let down = false;
const identity: Identity = {
  async passwordLink() { return null; },
  async createAccount(a) {
    if (down) throw new Error("sign-in service is down");
    if (accounts.has(a.email)) return "exists";
    accounts.set(a.email, { name: a.name, password: a.password });
    return { sub: `acct-${a.email.split("@")[0]}` };
  },
};

let h: Awaited<ReturnType<typeof setup>>;
let olga: string, mia: string, tA: string;
const M = "/members/accounts";

beforeAll(async () => {
  h = await setup([], { identity });
  olga = await h.token("olga");
  tA = (await h.client(olga).post("/tenants", { slug: "bakery", name: "Bakery" })).body.id;
  mia = await h.token("mia");
  await h.client(mia).get("/me");
  await h.join(tA, olga, mia, ["member"]);
});
afterAll(async () => { await h.teardown(); });

describe("colleagues: the owner creates accounts", () => {
  it("creates the account and adds them with the chosen role", async () => {
    const r = await h.client(olga, tA).post(M, { name: "Walter Worker", email: "Walter@Example.com", password: "start-pass-123", roles: ["member"] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: "walter@example.com", name: "Walter Worker", roles: ["member"] });
    expect(JSON.stringify(r.body)).not.toContain("start-pass-123");
    expect(accounts.get("walter@example.com")).toEqual({ name: "Walter Worker", password: "start-pass-123" });

    const list = (await h.client(olga, tA).get("/members")).body;
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ email: "walter@example.com", name: "Walter Worker", roles: ["member"] })]));

    // When Walter signs in (same account subject), he's already in the business.
    const walter = await h.token("acct-walter", "walter@example.com");
    expect((await h.client(walter).get("/me")).body.tenants.map((t: { id: string }) => t.id)).toEqual([tA]);
    expect((await h.client(walter, tA).get("/me/access")).status).toBe(200);

    const rows = await h.asOwner(tA, (tx) => tx`select diff from audit_log where action = 'member.added' order by seq desc limit 1`);
    expect(rows[0]!.diff).toMatchObject({ roles: ["member"], accountCreated: true });
    expect(JSON.stringify(rows[0]!.diff)).not.toContain("start-pass-123");
  });

  it("an email that already has an account is refused, with a hint to invite instead", async () => {
    accounts.set("known@example.com", { name: "Known", password: "x".repeat(12) });
    const r = await h.client(olga, tA).post(M, { name: "Known", email: "known@example.com", password: "another-pass-1", roles: ["member"] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("account_exists");
    expect(accounts.get("known@example.com")!.password).toBe("x".repeat(12)); // not overwritten
  });

  it("checks the request before making any account", async () => {
    const before = accounts.size;
    // Too short a password, unknown role, already a member, owner role by a non-owner, no permission.
    expect((await h.client(olga, tA).post(M, { name: "A", email: "a@example.com", password: "short", roles: ["member"] })).status).toBe(400);
    expect((await h.client(olga, tA).post(M, { name: "A", email: "a@example.com", password: "long-enough-1", roles: ["nope"] })).status).toBe(400);
    expect((await h.client(olga, tA).post(M, { name: "Walter", email: "walter@example.com", password: "long-enough-1", roles: ["member"] })).status).toBe(409);
    expect((await h.client(mia, tA).post(M, { name: "B", email: "b@example.com", password: "long-enough-1", roles: ["member"] })).status).toBe(403);
    expect(accounts.size).toBe(before);
  });

  it("only owners can create another owner", async () => {
    const r = await h.client(olga, tA).post(M, { name: "Co Owner", email: "co@example.com", password: "long-enough-1", roles: ["owner"] });
    expect(r.status).toBe(201);
  });

  it("says so when the sign-in service can't be reached", async () => {
    down = true;
    const r = await h.client(olga, tA).post(M, { name: "C", email: "c@example.com", password: "long-enough-1", roles: ["member"] });
    down = false;
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect((await h.client(olga, tA).get("/members")).body.some((m: { email: string }) => m.email === "c@example.com")).toBe(false);
  });
});

describe("colleagues without a sign-in service", () => {
  it("is refused with a clear message", async () => {
    const h2 = await setup([]);
    try {
      const o = await h2.token("oscar");
      const t = (await h2.client(o).post("/tenants", { slug: "shop", name: "Shop" })).body.id;
      const r = await h2.client(o, t).post(M, { name: "D", email: "d@example.com", password: "long-enough-1", roles: ["member"] });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("accounts_unavailable");
    } finally { await h2.teardown(); }
  });
});

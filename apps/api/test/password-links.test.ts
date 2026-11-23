import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "./harness.ts";
import type { Identity } from "../src/identity.ts";

/** Emails to people without a password include a one-time "set your password" link from the sign-in service. */
const sent: { to: string; subject: string; text: string }[] = [];
const withPassword = new Set(["boss@example.com"]);
const asked: { email: string; next?: string }[] = [];
const identity: Identity = {
  async passwordLink(email, next) {
    asked.push({ email, next });
    return { link: `http://idp.test/set-password?token=t-${email}`, hasPassword: withPassword.has(email) };
  },
};
let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
const last = (to: string) => sent.filter((m) => m.to === to).at(-1)!;

beforeAll(async () => {
  h = await setup([], { mailer: { send: async (m) => { sent.push(m); } }, identity });
  boss = await h.token("boss");
});
afterAll(async () => { await h.teardown(); });

describe("set-your-password links in emails", () => {
  it("a new co-owner gets the link; it leads to Program admin afterwards", async () => {
    expect((await h.client(boss).post("/platform/owners", { email: "cora@example.com" })).body.emailed).toBe(true);
    const m = last("cora@example.com");
    expect(m.subject).toBe("You're now an owner of Office");
    expect(m.text).toContain("set your password");
    expect(m.text).toContain("http://idp.test/set-password?token=t-cora@example.com");
    expect(asked.at(-1)).toEqual({ email: "cora@example.com", next: expect.stringMatching(/\/admin$/) });
  });

  it("someone who already has a password gets no link", async () => {
    withPassword.add("dora@example.com");
    await h.client(boss).post("/platform/owners", { email: "dora@example.com" });
    expect(last("dora@example.com").text).not.toContain("set-password");
  });

  it("the new owner is emailed on transfer, with the link", async () => {
    const olivia = await h.token("olivia");
    await h.client(olivia).get("/me"); // has an account
    const r = await h.client(boss).post("/platform/owners/transfer", { email: "olivia@example.com" });
    expect(r.body).toEqual({ to: "olivia@example.com", emailed: true });
    const m = last("olivia@example.com");
    expect(m.subject).toBe("You're now the owner of Office");
    expect(m.text).toContain("boss@example.com transferred ownership");
    expect(m.text).toContain("set-password?token=t-olivia@example.com");
    await h.client(olivia).post("/platform/owners/transfer", { email: "boss@example.com" });
  });

  it("business invitations include the link, then the invitation", async () => {
    const r = await h.client(boss).post("/platform/businesses", { name: "Bakery", slug: "bakery-pw", ownerEmail: "pat@example.com" });
    const m = last("pat@example.com");
    expect(m.text).toContain("set-password?token=t-pat@example.com");
    expect(m.text).toContain(r.body.invitation.link);
    expect(m.text.indexOf("set-password")).toBeLessThan(m.text.indexOf(r.body.invitation.link));
    expect(asked.at(-1)).toEqual({ email: "pat@example.com", next: r.body.invitation.link });
  });

  it("forgot password answers the same for everyone and emails the link", async () => {
    const a = await h.client().post("/auth/forgot-password", { email: "Boss@Example.com" });
    const b = await h.client().post("/auth/forgot-password", { email: "zed@example.com" });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect(last("boss@example.com").subject).toBe("Reset your Office password");
    expect(last("zed@example.com").subject).toBe("Set your Office password");
    expect((await h.client().post("/auth/forgot-password", { email: "not-an-email" })).status).toBe(400);
  });
});

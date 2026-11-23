import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/** Contact support: only the business owner and admins (people who may manage members) can write to the operator. */
const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
const mailer: Mailer = { send: async (m) => { sent.push(m); } };
let h: Awaited<ReturnType<typeof setup>>;
let boss: string, olivia: string, ada: string, wanda: string;
let biz: string;

beforeAll(async () => {
  h = await setup([], { mailer, contactEmail: "support@example.com" });
  [boss, olivia, ada, wanda] = await Promise.all([h.token("boss"), h.token("olivia"), h.token("ada"), h.token("wanda")]);
  const r = await h.client(boss).post("/platform/businesses", { name: "Bakery Ltd", slug: "bakery-ltd", ownerEmail: "olivia@example.com" });
  biz = r.body.business.id;
  await h.client(olivia).post("/invitations/accept", { tenantId: biz, token: r.body.invitation.link.split("/").pop() });
  await h.join(biz, olivia, ada, ["admin"]);
  await h.join(biz, olivia, wanda, ["member"]);
});
afterAll(async () => { await h.teardown(); });

describe("contact support", () => {
  it("the owner can write to support; the message says who and which business", async () => {
    expect((await h.client().get("/contact/config")).body).toEqual({ open: true });
    const r = await h.client(olivia, biz).post("/contact", { subject: "Billing\r\nBcc: evil@example.com", message: "How do I change my plan?" });
    expect(r.status).toBe(202);
    const m = sent.at(-1)!;
    expect(m).toMatchObject({ to: "support@example.com", replyTo: "olivia@example.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain("Bakery Ltd");
    expect(m.text).toContain("How do I change my plan?");
    expect(m.text).toContain(`Business: Bakery Ltd (bakery-ltd, ${biz})`);
  });

  it("a worker the owner made an admin can write too", async () => {
    expect((await h.client(ada, biz).post("/contact", { message: "Admin question here" })).status).toBe(202);
    expect(sent.at(-1)!.replyTo).toBe("ada@example.com");
  });

  it("an ordinary worker can't: they have to ask their owner", async () => {
    const n = sent.length;
    const r = await h.client(wanda, biz).post("/contact", { message: "Worker question here" });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/ask your business owner/i);
    expect(sent.length).toBe(n);
  });

  it("an owner can turn a worker into an admin, who can then write", async () => {
    const mem = (await h.client(olivia, biz).get("/members")).body.find((m: { email: string }) => m.email === "wanda@example.com");
    expect((await h.client(olivia, biz).put(`/members/${mem.id}/roles`, { roles: ["admin"] })).status).toBe(204);
    expect((await h.client(wanda, biz).post("/contact", { message: "Now I am an admin" })).status).toBe(202);
  });

  it("needs sign-in, a real business and a real message", async () => {
    expect((await h.client().post("/contact", { message: "anonymous question" })).status).toBe(401);
    expect((await h.client(await h.token("stranger3"), biz).post("/contact", { message: "not a member here" })).status).toBeGreaterThanOrEqual(403);
    expect((await h.client(olivia, biz).post("/contact", { message: "hi" })).status).toBe(400);
  });

  it("is closed when mail or the contact address isn't set up", async () => {
    const closed = await setup([], {});
    try {
      expect((await closed.client().get("/contact/config")).body).toEqual({ open: false });
      const t = await closed.token("boss");
      const o = await closed.token("olivia");
      const r = await closed.client(t).post("/platform/businesses", { name: "Shop", slug: "shop-co", ownerEmail: "olivia@example.com" });
      await closed.client(o).post("/invitations/accept", { tenantId: r.body.business.id, token: r.body.invitation.link.split("/").pop() });
      expect((await closed.client(o, r.body.business.id).post("/contact", { message: "long enough message" })).status).toBe(503);
    } finally { await closed.teardown(); }
  });
});

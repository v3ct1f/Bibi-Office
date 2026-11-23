import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
const mailer: Mailer = { send: async (m) => { sent.push(m); } };
let h: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { h = await setup([], { mailer, contactEmail: "support@example.com" }); });
afterAll(async () => { await h.teardown(); });

describe("contact form", () => {
  it("emails the message to the operator with the sender as reply-to", async () => {
    expect((await h.client().get("/contact/config")).body).toEqual({ open: true });
    const r = await h.client().post("/contact", { name: "Ana\r\nBcc: evil@example.com", email: "Ana@Example.com", message: "Hello, I have a question." });
    expect(r.status).toBe(202);
    expect(sent.at(-1)).toMatchObject({ to: "support@example.com", replyTo: "ana@example.com" });
    expect(sent.at(-1)!.subject).not.toMatch(/[\r\n]/);
    expect(sent.at(-1)!.text).toContain("Hello, I have a question.");
  });

  it("quietly drops messages where the hidden field is filled in (bots)", async () => {
    const n = sent.length;
    expect((await h.client().post("/contact", { name: "Bot", email: "b@example.com", message: "buy now", website: "http://spam" })).status).toBe(202);
    expect(sent.length).toBe(n);
  });

  it("rejects empty or too-short messages", async () => {
    expect((await h.client().post("/contact", { name: "A", email: "a@example.com", message: "hi" })).status).toBe(400);
    expect((await h.client().post("/contact", { name: "A", email: "not-an-email", message: "long enough message" })).status).toBe(400);
  });

  it("is closed when mail or the contact address isn't set up", async () => {
    const closed = await setup([], {});
    try {
      expect((await closed.client().get("/contact/config")).body).toEqual({ open: false });
      expect((await closed.client().post("/contact", { name: "A", email: "a@example.com", message: "long enough message" })).status).toBe(503);
    } finally { await closed.teardown(); }
  });
});

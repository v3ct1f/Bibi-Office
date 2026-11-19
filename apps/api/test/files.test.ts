import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sniffType, safeFilename } from "@office/platform";
import { setup } from "./harness.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, viewer: string, tA: string, tB: string;

beforeAll(async () => {
  h = await setup();
  [alice, bob, viewer] = await Promise.all([h.token("alice"), h.token("bob"), h.token("vera")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  await h.client(viewer).get("/me");
  await h.client(alice, tA).post("/members", { email: "vera@example.com", roles: ["viewer"] });
});
afterAll(() => h?.teardown());

describe("type detection", () => {
  it("detects by magic bytes, ignores the declared type", () => {
    expect(sniffType(PNG, "application/pdf")).toBe("image/png");
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(new TextEncoder().encode("a,b\n1,2"), undefined, "x.csv")).toBe("text/csv");
    expect(sniffType(new TextEncoder().encode("hello"))).toBe("text/plain");
  });
  it("rejects markup, binaries and unknown formats", () => {
    expect(sniffType(new TextEncoder().encode("  <svg onload=alert(1)>"), "image/svg+xml")).toBeNull();
    expect(sniffType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffType(Uint8Array.from([0x4d, 0x5a, 0x90, 0]))).toBeNull(); // PE/EXE
    expect(sniffType(Uint8Array.from([0xc3, 0x28]))).toBeNull(); // invalid UTF-8
  });
  it("sanitizes filenames", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\x\\..receipt <1>.pdf")).toBe("receipt _1_.pdf");
  });
});

describe("core document uploads", () => {
  let docId: string;
  it("uploads, lists as a document, emits an event", async () => {
    const r = await h.client(alice, tA).upload("/documents/upload?filename=" + encodeURIComponent("Scan 1.png") + "&title=Lease%20scan", PNG, "application/pdf");
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "Lease scan", filename: "Scan 1.png", mime: "image/png", size: PNG.length, module: null });
    expect(r.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    docId = r.body.id;
    const list = (await h.client(alice, tA).get("/documents")).body.data;
    expect(list.map((d: { id: string }) => d.id)).toContain(docId);
    expect(list[0]).not.toHaveProperty("storageKey");
    expect((await h.events(tA, "core.document.created")).length).toBe(1);
  });
  it("downloads with safe headers; images inline, ?download=1 attachment", async () => {
    const r = await h.client(viewer, tA).get(`/documents/${docId}/content`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["content-disposition"]).toMatch(/^inline; filename="Scan 1.png"/);
    expect(Buffer.compare(r.raw, Buffer.from(PNG))).toBe(0);
    const d = await h.client(alice, tA).get(`/documents/${docId}/content?download=true`);
    expect(d.headers["content-disposition"]).toMatch(/^attachment/);
  });
  it("text is never served inline", async () => {
    const t = await h.client(alice, tA).upload("/documents/upload?filename=notes.txt", new TextEncoder().encode("hello"), "text/html");
    expect(t.body.mime).toBe("text/plain");
    const r = await h.client(alice, tA).get(`/documents/${t.body.id}/content`);
    expect(r.headers["content-disposition"]).toMatch(/^attachment/);
  });
  it("rejects bad uploads", async () => {
    const c = h.client(alice, tA);
    expect((await c.upload("/documents/upload?filename=x.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml")).status).toBe(400);
    expect((await c.upload("/documents/upload?filename=e.bin", new Uint8Array(0))).status).toBe(400);
    expect((await c.upload("/documents/upload", PNG)).status).toBe(400); // filename required
    const big = new Uint8Array(3 * 1_048_576); big.set(PDF);
    expect((await c.upload("/documents/upload?filename=big.pdf", big, "application/pdf")).status).toBe(413);
  });
  it("enforces permissions and tenant isolation", async () => {
    expect((await h.client(viewer, tA).upload("/documents/upload?filename=a.png", PNG)).status).toBe(403);
    expect((await h.client(bob, tB).get(`/documents/${docId}/content`)).status).toBe(404);
    expect((await h.client(bob, tA).get(`/documents/${docId}/content`)).status).toBe(404); // non-member: tenant not revealed
  });
  it("deleted documents are not downloadable", async () => {
    expect((await h.client(alice, tA).del(`/documents/${docId}`)).status).toBe(204);
    expect((await h.client(alice, tA).get(`/documents/${docId}/content`)).status).toBe(404);
  });
});

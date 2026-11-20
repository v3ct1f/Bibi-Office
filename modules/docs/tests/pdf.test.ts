import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildSignedPdf, fillIn, inspectPdf, PdfError, placeholders, renderTemplate } from "../src/pdf.ts";
import { normFolder } from "../src/service.ts";

describe("templates", () => {
  it("finds fill-ins once each, in order", () => {
    expect(placeholders("Hi {{contact.name}}, {{ price }} for {{contact.name}} on {{today}}")).toEqual(["contact.name", "price", "today"]);
  });
  it("fills in values and leaves a blank line for missing ones", () => {
    expect(fillIn("To {{name}}: {{price}} €", { name: " Ana " })).toBe("To Ana: __________ €");
  });
  it("lays out text with headings and a signature block per signer", async () => {
    const body = ["# Contract", "", "## Terms", ...Array.from({ length: 80 }, (_, i) => `- Point ${i + 1}: ${"lorem ipsum ".repeat(8)}`), "Zażółć ✓ emoji 🙂"].join("\n");
    const r = await renderTemplate("Service agreement", body, ["Ana López", "Bakery Sol"]);
    expect(r.pageCount).toBeGreaterThan(1);
    expect(r.fields).toHaveLength(6);
    for (const f of r.fields) {
      expect(f.page).toBeLessThanOrEqual(r.pageCount);
      expect(f.x + f.w).toBeLessThanOrEqual(1);
      expect(f.y + f.h).toBeLessThanOrEqual(1);
      expect(f.y).toBeGreaterThanOrEqual(0);
    }
    expect(r.fields.filter((f) => f.kind === "signature").map((f) => f.signerIndex)).toEqual([0, 1]);
    expect((await inspectPdf(r.bytes)).pageCount).toBe(r.pageCount);
  });
});

describe("pdf files", () => {
  it("refuses files that aren't PDFs", async () => {
    await expect(inspectPdf(Buffer.from("%PDF-1.4\nnot really"))).rejects.toBeInstanceOf(PdfError);
  });
  it("stamps values and adds a certificate page", async () => {
    const r = await renderTemplate("NDA", "Short text.", ["Ana"]);
    const signer = { name: "Ana", email: "ana@x.test", status: "signed", signedAt: new Date("2026-11-20T10:00:00Z"), ip: "203.0.113.5", userAgent: "Test", signatureText: "Ana", signatureImage: null, initialsText: null, initialsImage: null };
    const out = await buildSignedPdf(Buffer.from(r.bytes), r.fields.map((f) => ({ ...f, value: null, signer })), {
      documentId: "d1", title: "NDA", companyName: "Bakery", senderName: "Olga", originalSha256: "abc", completedAt: new Date(), signers: [signer],
      activity: [{ at: new Date(), text: "Signed by Ana" }],
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(r.pageCount + 1);
  });
});

describe("folders", () => {
  it("normalises folder paths", () => {
    expect(normFolder("  Contracts / 2026 /")).toBe("Contracts/2026");
    expect(normFolder("///")).toBe("");
  });
});

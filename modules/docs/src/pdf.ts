/**
 * PDF work with pdf-lib: read uploaded PDFs, turn a filled-in template into a PDF (with signature boxes at
 * the end), and build the signed copy (values stamped onto the pages plus a signing certificate page).
 *
 * The standard PDF fonts only cover Western European characters (WinAnsi); anything else is drawn as "?".
 */
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { FieldKind } from "./schema.ts";

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export class PdfError extends Error {}

/** Page count of an uploaded PDF; throws PdfError for broken or password-protected files. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  let pageCount: number;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = doc.getPageCount();
    doc.getPages().forEach((p) => p.getCropBox());
  } catch (e) {
    if (/encrypt/i.test(String((e as Error).message))) throw new PdfError("This PDF is password-protected. Remove the password and upload it again.");
    throw new PdfError("This file can't be read as a PDF");
  }
  if (!pageCount) throw new PdfError("This PDF has no pages");
  if (pageCount > 200) throw new PdfError("PDFs for signing can have at most 200 pages");
  return { pageCount };
}

/** Keep what the font can draw; replace the rest. */
function clean(font: PDFFont, s: string): string {
  const t = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\t/g, "    ");
  let out = "";
  for (const ch of t) {
    try { font.encodeText(ch); out += ch; } catch { out += "?"; }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = text.split(/ +/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) lines.push(line);
    // A single word longer than the line: hard-break it.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let i = rest.length;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    line = rest;
  }
  lines.push(line);
  return lines;
}

// ───────── Templates ─────────
const PH = /\{\{\s*([a-zA-Z][\w.]{0,60})\s*\}\}/g;

/** Fill-in names used in a template body, in order of first use. */
export function placeholders(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PH)) seen.add(m[1]!);
  return [...seen];
}

/** Replaces {{name}} with its value; empty or unknown fill-ins become a blank line to write on. */
export const fillIn = (body: string, values: Record<string, string>) =>
  body.replace(PH, (_, k: string) => (values[k]?.trim() ? values[k]!.trim() : "__________"));

export interface PlacedField { signerIndex: number; kind: FieldKind; page: number; x: number; y: number; w: number; h: number }

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margin

/**
 * Lays out a filled-in template: a title, the text (lines starting "# " or "## " are headings,
 * "- " are bullet points) and one signature block per signer. Returns the PDF and the boxes for each signer.
 */
export async function renderTemplate(title: string, text: string, signerNames: string[]): Promise<{ bytes: Uint8Array; pageCount: number; fields: PlacedField[] }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Office Docs");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = A4;
  const width = W - 2 * M;
  let page = doc.addPage(A4);
  let y = H - M;
  const ensure = (need: number) => { if (y - need < M) { page = doc.addPage(A4); y = H - M; } };
  const lineOut = (s: string, font: PDFFont, size: number, indent = 0) => {
    for (const l of wrap(font, clean(font, s), size, width - indent)) {
      ensure(size * 1.45);
      page.drawText(l, { x: M + indent, y: y - size, size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= size * 1.45;
    }
  };

  lineOut(title, bold, 18);
  y -= 10;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { y -= 7; continue; }
    if (line.startsWith("## ")) { y -= 4; lineOut(line.slice(3), bold, 12.5); continue; }
    if (line.startsWith("# ")) { y -= 6; lineOut(line.slice(2), bold, 15); continue; }
    if (/^[-*] /.test(line)) {
      ensure(15);
      page.drawText("•", { x: M + 4, y: y - 10.5, size: 10.5, font: regular });
      lineOut(line.slice(2), regular, 10.5, 16);
      continue;
    }
    lineOut(line, regular, 10.5);
  }

  // Signature blocks: one per signer, never split across pages.
  const fields: PlacedField[] = [];
  const BLOCK = 118;
  if (signerNames.length) {
    y -= 18;
    ensure(30 + BLOCK);
    page.drawText("Signatures", { x: M, y: y - 13, size: 13, font: bold });
    y -= 30;
  }
  signerNames.forEach((name, i) => {
    ensure(BLOCK);
    const pageNo = doc.getPageCount();
    const top = y;
    page.drawText(clean(bold, name || `Signer ${i + 1}`), { x: M, y: top - 11, size: 10.5, font: bold });
    const sig = { x: M, y: top - 20 - 50, w: 230, h: 50 };
    page.drawLine({ start: { x: sig.x, y: sig.y }, end: { x: sig.x + sig.w, y: sig.y }, thickness: 0.8, color: rgb(0.4, 0.4, 0.45) });
    page.drawText("Signature", { x: M, y: sig.y - 11, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) });
    const nameBox = { x: M, y: sig.y - 34, w: 230, h: 15 };
    const dateBox = { x: M + 260, y: sig.y - 34, w: 120, h: 15 };
    page.drawText("Name", { x: M, y: nameBox.y - 10, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) });
    page.drawText("Date", { x: dateBox.x, y: dateBox.y - 10, size: 8, font: regular, color: rgb(0.4, 0.4, 0.45) });
    page.drawLine({ start: { x: nameBox.x, y: nameBox.y }, end: { x: nameBox.x + nameBox.w, y: nameBox.y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.65) });
    page.drawLine({ start: { x: dateBox.x, y: dateBox.y }, end: { x: dateBox.x + dateBox.w, y: dateBox.y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.65) });
    const frac = (b: { x: number; y: number; w: number; h: number }, kind: FieldKind): PlacedField =>
      ({ signerIndex: i, kind, page: pageNo, x: b.x / W, y: (H - (b.y + b.h)) / H, w: b.w / W, h: b.h / H });
    fields.push(frac(sig, "signature"), frac(nameBox, "name"), frac(dateBox, "date"));
    y = top - BLOCK;
  });

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount(), fields };
}

// ───────── Signed copy ─────────
export interface StampField { kind: FieldKind; page: number; x: number; y: number; w: number; h: number; value: string | null; signer: StampSigner }
export interface StampSigner {
  name: string; email: string; status: string; signedAt: Date | null; ip: string | null; userAgent: string | null;
  signatureText: string | null; signatureImage: Buffer | null; initialsText: string | null; initialsImage: Buffer | null;
}
export interface Certificate {
  documentId: string; title: string; companyName: string | null; senderName: string | null; originalSha256: string; completedAt: Date;
  signers: StampSigner[];
  activity: { at: Date; text: string }[];
}

const iso = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + " UTC";

async function drawImageIn(doc: PDFDocument, page: PDFPage, png: Buffer, b: { x: number; y: number; w: number; h: number }) {
  const img = await doc.embedPng(png);
  const s = Math.min(b.w / img.width, b.h / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, width: w, height: h });
}

function drawFit(page: PDFPage, font: PDFFont, text: string, b: { x: number; y: number; w: number; h: number }, max: number) {
  const t = clean(font, text);
  let size = Math.min(max, b.h * 0.8);
  while (size > 5 && font.widthOfTextAtSize(t, size) > b.w) size -= 0.5;
  page.drawText(t, { x: b.x + 1, y: b.y + (b.h - size) / 2 + size * 0.2, size, font, color: rgb(0.05, 0.1, 0.35) });
}

/** The original pages with every value drawn in, followed by a certificate page. */
export async function buildSignedPdf(original: Buffer, list: StampField[], cert: Certificate): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const pages = doc.getPages();
  for (const f of list) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const box = page.getCropBox();
    const b = { x: box.x + f.x * box.width, y: box.y + (1 - f.y - f.h) * box.height, w: f.w * box.width, h: f.h * box.height };
    const s = f.signer;
    if (f.kind === "signature") {
      if (s.signatureImage) await drawImageIn(doc, page, s.signatureImage, b);
      else if (s.signatureText) drawFit(page, script, s.signatureText, b, 28);
    } else if (f.kind === "initials") {
      if (s.initialsImage) await drawImageIn(doc, page, s.initialsImage, b);
      else if (s.initialsText) drawFit(page, script, s.initialsText, b, 22);
    } else if (f.kind === "date") {
      if (s.signedAt) drawFit(page, regular, s.signedAt.toISOString().slice(0, 10), b, 11);
    } else if (f.kind === "name") {
      drawFit(page, regular, s.name, b, 11);
    } else if (f.value) {
      drawFit(page, regular, f.value, b, 11);
    }
  }

  // Certificate page
  const [W, H] = A4;
  let page = doc.addPage(A4);
  let y = H - M;
  const width = W - 2 * M;
  const text = (s: string, font = regular, size = 9.5, color = rgb(0.15, 0.15, 0.18)) => {
    for (const l of wrap(font, clean(font, s), size, width)) {
      if (y - size * 1.5 < M) { page = doc.addPage(A4); y = H - M; }
      page.drawText(l, { x: M, y: y - size, size, font, color });
      y -= size * 1.5;
    }
  };
  text("Signing certificate", bold, 17);
  y -= 6;
  text(`Document: ${cert.title}`, bold, 11);
  text(`Document ID: ${cert.documentId}`);
  if (cert.companyName) text(`Sent by: ${[cert.senderName, cert.companyName].filter(Boolean).join(", ")}`);
  text(`Completed: ${iso(cert.completedAt)}`);
  text(`SHA-256 of the original file: ${cert.originalSha256}`);
  y -= 10;
  text("Signers", bold, 12);
  for (const s of cert.signers) {
    y -= 4;
    text(`${s.name} <${s.email}>`, bold, 10);
    text(`Signed: ${s.signedAt ? iso(s.signedAt) : "—"}   ·   IP address: ${s.ip ?? "—"}`);
    if (s.userAgent) text(`Device: ${s.userAgent.slice(0, 160)}`, regular, 8, rgb(0.4, 0.4, 0.45));
  }
  y -= 10;
  text("History", bold, 12);
  for (const a of cert.activity) text(`${iso(a.at)}   ${a.text}`, regular, 8.5);
  y -= 10;
  text("Each signer opened their own private signing link, reviewed the document and agreed to sign electronically.", regular, 8, rgb(0.4, 0.4, 0.45));

  doc.setProducer("Office Docs");
  doc.setModificationDate(cert.completedAt);
  return doc.save();
}

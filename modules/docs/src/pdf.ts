import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { blocks } from "./render.ts";

export interface PdfDoc {
  number: number; title: string; body: string; status: string; contentHash: string | null; sender: string;
  sentAt: Date | null; completedAt: Date | null;
  signers: { name: string; email: string; status: string; signedName: string | null; signedAt: Date | null; signedIp: string | null; signaturePng: Buffer | null }[];
  trail: { at: Date; kind: string; who: string | null; ip: string | null }[];
}

const A4: [number, number] = [595.28, 841.89];
const M = 56;
const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.42, 0.44, 0.48), RULE = rgb(0.85, 0.86, 0.88);

function safe(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return [...s.replace(/[\r\t]/g, " ")].map((c) => (ok.has(c.codePointAt(0)!) ? c : "?")).join("");
}
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) out.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      out.push(line.slice(0, cut)); line = line.slice(cut);
    }
  }
  if (line) out.push(line);
  return out;
}
const iso = (d: Date) => `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** The document as sent, then a signature page and a certificate with the evidence trail. Deterministic for the same data. */
export async function renderDocPdf(d: PdfDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(safe(font, d.title)); doc.setCreator("Office"); doc.setProducer("Office e-sign");
  const fixed = d.completedAt ?? d.sentAt ?? new Date(0);
  doc.setCreationDate(fixed); doc.setModificationDate(fixed);
  const width = A4[0] - 2 * M;
  let page!: PDFPage, y = 0, pageNo = 0;
  const footer = () => {
    const t = safe(font, `${d.title} · #${d.number}${d.contentHash ? ` · SHA-256 ${d.contentHash.slice(0, 16)}…` : ""} · page ${pageNo}`);
    page.drawText(t, { x: M, y: 30, size: 7.5, font, color: MUTED });
  };
  const newPage = () => { page = doc.addPage(A4); pageNo++; y = A4[1] - M; footer(); };
  const need = (h: number) => { if (y - h < M) newPage(); };
  const lines = (text: string, size: number, f = font, color = INK, indent = 0, gap = 4) => {
    for (const l of wrap(f, size, safe(f, text), width - indent)) { need(size + gap); page.drawText(l, { x: M + indent, y: y - size, size, font: f, color }); y -= size + gap; }
  };
  newPage();
  if (d.status === "draft") lines("DRAFT – not sent for signature", 9, bold, rgb(0.7, 0.2, 0.2));
  lines(d.title, 20, bold); y -= 6;
  lines(`From ${d.sender}`, 9, font, MUTED); y -= 10;
  for (const b of blocks(d.body)) {
    if (b.kind === "h1") { y -= 6; lines(b.text, 14, bold); y -= 2; }
    else if (b.kind === "h2") { y -= 4; lines(b.text, 12, bold); }
    else if (b.kind === "p") { lines(b.text, 10.5); y -= 6; }
    else if (b.kind === "ul") { for (const it of b.items) { need(15); page!.drawText("•", { x: M + 4, y: y - 10.5, size: 10.5, font, color: INK }); lines(it, 10.5, font, INK, 16); } y -= 6; }
  }

  // signatures
  y -= 10; need(40);
  page!.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.7, color: RULE }); y -= 18;
  lines("Signatures", 13, bold); y -= 4;
  const imgs = new Map<number, PDFImage>();
  for (const [i, s] of d.signers.entries()) if (s.signaturePng) { try { imgs.set(i, await doc.embedPng(s.signaturePng)); } catch { /* ignore a bad image */ } }
  for (const [i, s] of d.signers.entries()) {
    need(90);
    const img = imgs.get(i);
    if (s.status === "signed") {
      if (img) { const h = 40, w = Math.min(200, (img.width / img.height) * h); page!.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 4; }
      else { lines(s.signedName ?? s.name, 16, bold); }
      page!.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.5, color: INK }); y -= 4;
      lines(`${s.signedName ?? s.name} <${s.email}>`, 9);
      lines(`Signed electronically ${s.signedAt ? iso(s.signedAt) : ""}`, 8, font, MUTED);
    } else {
      y -= 30; page!.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.5, color: RULE }); y -= 4;
      lines(`${s.name} <${s.email}>`, 9);
      lines(s.status === "declined" ? "Declined to sign" : "Not signed yet", 8, font, MUTED);
    }
    y -= 12;
  }

  // certificate
  newPage();
  lines("Signature certificate", 16, bold); y -= 6;
  const kv = (k: string, v: string) => { need(14); page!.drawText(safe(bold, k), { x: M, y: y - 9, size: 9, font: bold, color: INK }); const ls = wrap(font, 9, safe(font, v), width - 130); for (const l of ls) { need(13); page!.drawText(l, { x: M + 130, y: y - 9, size: 9, font, color: INK }); y -= 13; } };
  kv("Document", `${d.title} (#${d.number})`);
  kv("Status", d.status);
  kv("Content SHA-256", d.contentHash ?? "—");
  kv("Sent", d.sentAt ? iso(d.sentAt) : "—");
  kv("Completed", d.completedAt ? iso(d.completedAt) : "—");
  y -= 8;
  for (const s of d.signers) kv(s.name, `${s.email} · ${s.status}${s.signedAt ? ` ${iso(s.signedAt)}` : ""}${s.signedIp ? ` · IP ${s.signedIp}` : ""}`);
  y -= 10; lines("Evidence trail", 12, bold); y -= 2;
  for (const e of d.trail) lines(`${iso(e.at)}  ${e.kind}${e.who ? ` · ${e.who}` : ""}${e.ip ? ` · IP ${e.ip}` : ""}`, 8.5, font, INK, 0, 3);
  return doc.save({ useObjectStreams: false });
}

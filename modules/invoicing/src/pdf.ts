import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney } from "./money.ts";
import type { PartySnapshot } from "./schema.ts";

export interface PdfInvoice {
  number: string | null; status: string; currency: string; issueDate: string | null; dueDate: string | null;
  notes: string | null; customer: PartySnapshot | null; seller: PartySnapshot | null;
  subtotal: number; taxTotal: number; total: number; amountPaid: number;
  lines: { description: string; quantity: number; unitPrice: number; taxRate: number; net: number }[];
}

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.42, 0.44, 0.48), RULE = rgb(0.85, 0.86, 0.88);

/** Standard PDF fonts only cover WinAnsi (Latin-1-ish); replace anything else rather than failing. */
function safe(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return [...s.replace(/[\r\t]/g, " ")].map((c) => (ok.has(c.codePointAt(0)!) ? c : "?")).join("");
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {   // hard-break very long words
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

/** Deterministic A4 invoice PDF from the issued snapshot (or a "DRAFT" preview). */
export async function renderInvoicePdf(inv: PdfInvoice, locale = "en"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const title = inv.number ? `Invoice ${inv.number}` : "Draft invoice";
  doc.setTitle(safe(font, title)); doc.setCreator("Office"); doc.setProducer("Office invoicing");
  const fixed = inv.issueDate ? new Date(`${inv.issueDate}T00:00:00Z`) : new Date(0);
  doc.setCreationDate(fixed); doc.setModificationDate(fixed);
  const money = (n: number) => formatMoney(n, inv.currency, locale);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const text = (s: string, x: number, size = 10, f = font, color = INK) => page.drawText(safe(f, s), { x, y, size, font: f, color });
  const right = (s: string, xr: number, size = 10, f = font, color = INK) => {
    const t = safe(f, s); page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  const block = (lines: (string | null | undefined)[], x: number, width: number, size = 10) => {
    for (const l of lines.filter((v): v is string => !!v)) for (const w of wrap(font, size, safe(font, l), width)) { text(w, x, size); y -= size + 4; }
  };
  const ensure = (h: number) => { if (y - h < M + 40) { page = doc.addPage(A4); y = A4[1] - M; } };

  // Header
  text(title, M, 20, bold); right(inv.status === "draft" ? "DRAFT" : inv.status === "void" ? "VOID" : "", A4[0] - M, 14, bold, MUTED);
  y -= 30;
  const top = y, colW = (A4[0] - 2 * M) / 2 - 10;
  text("From", M, 9, bold, MUTED); y -= 14;
  block([inv.seller?.name, inv.seller?.address, inv.seller?.taxId ? `VAT/Tax ID: ${inv.seller.taxId}` : null, inv.seller?.email], M, colW);
  const leftEnd = y; y = top;
  text("Bill to", M + colW + 20, 9, bold, MUTED); y -= 14;
  block([inv.customer?.name, inv.customer?.address, inv.customer?.taxId ? `VAT/Tax ID: ${inv.customer.taxId}` : null, inv.customer?.email], M + colW + 20, colW);
  y = Math.min(y, leftEnd) - 16;
  for (const [k, v] of [["Issue date", inv.issueDate], ["Due date", inv.dueDate], ["Currency", inv.currency]] as const) {
    if (!v) continue; text(k, M, 10, font, MUTED); text(v, M + 90, 10); y -= 14;
  }
  y -= 14;

  // Lines table
  const cols = { desc: M, qty: 340, price: 420, tax: 465, amount: A4[0] - M };
  const header = () => {
    text("Description", cols.desc, 9, bold, MUTED); right("Qty", cols.qty, 9, bold, MUTED);
    right("Unit price", cols.price, 9, bold, MUTED); right("Tax", cols.tax, 9, bold, MUTED); right("Amount", cols.amount, 9, bold, MUTED);
    y -= 6; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: RULE }); y -= 14;
  };
  header();
  for (const l of inv.lines) {
    const desc = wrap(font, 10, safe(font, l.description), cols.qty - cols.desc - 40);
    ensure(desc.length * 14 + 6);
    if (y === A4[1] - M) header();
    right(String(l.quantity), cols.qty); right(money(l.unitPrice), cols.price); right(`${l.taxRate}%`, cols.tax); right(money(l.net), cols.amount);
    for (const d of desc) { text(d, cols.desc); y -= 14; }
    y -= 2;
  }
  y -= 4; page.drawLine({ start: { x: 300, y: y + 10 }, end: { x: A4[0] - M, y: y + 10 }, thickness: 0.6, color: RULE });

  // Totals
  ensure(90);
  const totals: [string, number, boolean][] = [["Subtotal", inv.subtotal, false], ["Tax", inv.taxTotal, false], ["Total", inv.total, true]];
  if (inv.amountPaid > 0) totals.push(["Paid", -inv.amountPaid, false], ["Balance due", inv.total - inv.amountPaid, true]);
  for (const [k, v, strong] of totals) {
    right(k, cols.price, 10, strong ? bold : font, strong ? INK : MUTED); right(money(v), cols.amount, 10, strong ? bold : font); y -= 16;
  }
  y -= 10;

  // Notes, payment instructions, footer
  if (inv.notes) { ensure(40); text("Notes", M, 9, bold, MUTED); y -= 14; block([inv.notes], M, A4[0] - 2 * M); y -= 6; }
  if (inv.seller?.paymentInstructions) {
    ensure(40); text("Payment", M, 9, bold, MUTED); y -= 14; block([inv.seller.paymentInstructions], M, A4[0] - 2 * M);
  }
  if (inv.seller?.footer) {
    const pages = doc.getPages();
    for (const p of pages) {
      const t = safe(font, inv.seller.footer).slice(0, 160);
      p.drawText(t, { x: M, y: 30, size: 8, font, color: MUTED });
    }
  }
  return doc.save({ useObjectStreams: false });
}

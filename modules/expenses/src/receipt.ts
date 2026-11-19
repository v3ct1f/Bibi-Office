/**
 * Turns OCR text from a receipt or supplier invoice into suggested fields.
 * Pure and deterministic (shared by the UI and tests). Results are suggestions: the person always reviews them.
 * Handles English and Spanish wording, "1.234,56" and "1,234.56" amounts, and day-first or ISO dates.
 */

export interface ParsedLine { description: string; quantity: number; amountCents: number }
export interface ParsedReceipt {
  vendor: string | null;
  date: string | null;            // YYYY-MM-DD
  invoiceNumber: string | null;
  currency: string | null;
  lines: ParsedLine[];
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
}

const AMOUNT = String.raw`-?(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)[.,]\d{2}`;
const AMOUNT_AT_END = new RegExp(String.raw`(${AMOUNT})\s*(?:€|eur|euros?|\$|usd|£|gbp)?\s*[a-z*]?\s*$`, "i");
const AMOUNTS = new RegExp(AMOUNT, "g");

/** "1.234,56" | "1,234.56" | "12,50" | "12.50" -> cents. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, "");
  const m = /^(-?)([\d.,]*?)[.,](\d{2})$/.exec(s);
  if (!m) return null;
  const whole = m[2]!.replace(/[.,]/g, "") || "0";
  const cents = Number(whole) * 100 + Number(m[3]);
  if (!Number.isFinite(cents)) return null;
  return m[1] ? -cents : cents;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1, feb: 2, february: 2, febrero: 2, mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, june: 6, junio: 6, jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8, sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10, nov: 11, november: 11, noviembre: 11, dec: 12, december: 12, dic: 12, diciembre: 12,
};

const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31/02
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** First date found: ISO, numeric (day first unless impossible), or with a month name (EN/ES). */
export function findDate(text: string): string | null {
  let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (m) { const r = iso(+m[1]!, +m[2]!, +m[3]!); if (r) return r; }
  const numeric = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g;
  while ((m = numeric.exec(text))) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    const r = a > 12 ? iso(y, b, a) : b > 12 ? iso(y, a, b) : iso(y, b, a);
    if (r) return r;
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:de\s+)?([a-záé]{3,10})\.?,?\s*(?:de\s+|del\s+)?(\d{4})\b/i.exec(text);
  if (m && MONTHS[m[2]!.toLowerCase()]) { const r = iso(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!); if (r) return r; }
  m = /\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
  if (m && MONTHS[m[1]!.toLowerCase()]) { const r = iso(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!); if (r) return r; }
  return null;
}

const RE = {
  subtotal: /\b(sub\s*-?\s*total|base\s+imponible|importe\s+neto|net\s+(amount|total)|neto|before\s+tax)\b/i,
  tax: /\b(iva|i\.v\.a|vat|igic|tax|impuesto|cuota)\b/i,
  taxTotal: /\btotal\s+(iva|vat|tax|impuestos?)\b/i,
  total: /\b(total|a\s+pagar|amount\s+due|balance\s+due|importe)\b/i,
  notItem: /\b(sub\s*-?\s*total|total|iva|vat|igic|tax|impuesto|cuota|base|neto|net|cambio|change|efectivo|cash|tarjeta|card|visa|mastercard|entregado|tendered|pago|payment|paid|pagado|propina|tip|redondeo|rounding|saldo|balance|descuento\s+total|dto\.?\s+total)\b/i,
  header: /\b(factura|invoice|receipt|recibo|ticket|simplificada|simplified|cif|nif|vat\s*(no|number|reg)|tel[ée]?f?|phone|www\.|https?:|@|calle|c\/|avda|avenida|street|road|fecha|date|hora|time|mesa|table|camarero|server|cajero|cashier|n[º°]|no\.)\b/i,
};

const lastAmount = (line: string): number | null => {
  const all = line.match(AMOUNTS);
  return all?.length ? parseAmount(all.at(-1)!) : null;
};

function findVendor(lines: string[]): string | null {
  for (const l of lines.slice(0, 6)) {
    const t = l.replace(/[|_=*~#]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const letters = (t.match(/[a-záéíóúñü]/gi) ?? []).length;
    if (letters < 3 || letters < t.length * 0.5) continue;
    if (RE.header.test(t) || RE.total.test(t) || AMOUNT_AT_END.test(t)) continue;
    if (findDate(t)) continue;
    return t.slice(0, 120);
  }
  return null;
}

function findInvoiceNumber(text: string): string | null {
  const m = /\b(?:invoice|factura|fra\.?|ticket|receipt|recibo)\s*(?:simplificada\s*)?(?:number|num\.?|no\.?|n[º°o]?\.?|#)?\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i.exec(text);
  if (!m) return null;
  const v = m[1]!;
  // Must contain a digit and not be a date.
  return /\d/.test(v) && !findDate(v) ? v : null;
}

function findCurrency(text: string): string | null {
  if (/€|\beur(os?)?\b/i.test(text)) return "EUR";
  if (/£|\bgbp\b/i.test(text)) return "GBP";
  if (/\$|\busd\b/i.test(text)) return "USD";
  return null;
}

export function parseReceipt(text: string): ParsedReceipt {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let totalCents: number | null = null;
  let subtotalCents: number | null = null;
  let taxTotal: number | null = null;
  let taxSum = 0, taxSeen = false;
  let firstTotalRow = rows.length;
  const items: ParsedLine[] = [];

  rows.forEach((row, i) => {
    const amt = lastAmount(row);
    if (amt === null || amt < 0) return;
    if (RE.subtotal.test(row)) { subtotalCents = amt; firstTotalRow = Math.min(firstTotalRow, i); return; }
    if (RE.taxTotal.test(row)) { taxTotal = amt; firstTotalRow = Math.min(firstTotalRow, i); return; }
    if (RE.tax.test(row) && !/\b(incl|included|incluido)\b/i.test(row)) {
      // "IVA 21% 2,10" or a tax table row "21% 10,00 2,10": the tax is the last amount.
      taxSum += amt; taxSeen = true; firstTotalRow = Math.min(firstTotalRow, i); return;
    }
    if (RE.total.test(row)) {
      totalCents = Math.max(totalCents ?? 0, amt); firstTotalRow = Math.min(firstTotalRow, i); return;
    }
  });

  // Item rows: description + amount, above the totals block, not payment/tax rows.
  rows.slice(0, firstTotalRow).forEach((row, i) => {
    if (i === 0) return;
    const m = AMOUNT_AT_END.exec(row);
    if (!m || RE.notItem.test(row) || RE.header.test(row)) return;
    const amountCents = parseAmount(m[1]!);
    if (amountCents === null || amountCents <= 0) return;
    let desc = row.slice(0, m.index).trim();
    let quantity = 1;
    const q = /^(\d+(?:[.,]\d+)?)\s*(?:x|uds?\.?|un\.?|\*)?\s+(.*)$/i.exec(desc);
    if (q && /[a-z]/i.test(q[2]!)) { quantity = Number(q[1]!.replace(",", ".")) || 1; desc = q[2]!; }
    desc = desc.replace(new RegExp(String.raw`\s*(?:x\s*)?${AMOUNT}\s*$`, "i"), "").replace(/[|_*]+/g, " ").replace(/\s{2,}/g, " ").trim();
    if ((desc.match(/[a-záéíóúñü]/gi) ?? []).length < 2) return;
    items.push({ description: desc.slice(0, 200), quantity: quantity > 0 ? quantity : 1, amountCents });
  });

  let taxCents: number | null = taxTotal ?? (taxSeen ? taxSum : null);
  if (totalCents === null && subtotalCents !== null) totalCents = subtotalCents + (taxCents ?? 0);
  if (totalCents === null && items.length) totalCents = items.reduce((s, l) => s + l.amountCents, 0);
  if (taxCents !== null && totalCents !== null && taxCents > totalCents) taxCents = null; // misread
  if (subtotalCents === null && totalCents !== null) subtotalCents = totalCents - (taxCents ?? 0);
  if (taxCents === null && subtotalCents !== null && totalCents !== null && totalCents >= subtotalCents) taxCents = totalCents - subtotalCents;

  return {
    vendor: findVendor(rows),
    date: findDate(text),
    invoiceNumber: findInvoiceNumber(text),
    currency: findCurrency(text),
    lines: items.slice(0, 50),
    subtotalCents, taxCents, totalCents,
  };
}

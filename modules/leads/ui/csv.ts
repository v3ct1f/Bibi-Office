/** Small CSV reader: quotes, doubled quotes, commas/semicolons/tabs, line breaks inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export const IMPORT_FIELDS = [
  { key: "name", label: "Full name", hints: ["name", "fullname", "contact", "contactname", "lead"] },
  { key: "firstName", label: "First name", hints: ["firstname", "first", "givenname"] },
  { key: "lastName", label: "Last name", hints: ["lastname", "last", "surname", "familyname"] },
  { key: "email", label: "Email", hints: ["email", "emailaddress", "mail"] },
  { key: "phone", label: "Phone", hints: ["phone", "phonenumber", "mobile", "tel", "telephone"] },
  { key: "companyName", label: "Company", hints: ["company", "companyname", "organisation", "organization", "business"] },
  { key: "jobTitle", label: "Job title", hints: ["jobtitle", "title", "position", "role"] },
  { key: "source", label: "Source", hints: ["source", "leadsource", "origin"] },
  { key: "notes", label: "Notes", hints: ["notes", "note", "comments", "comment"] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Guess which spreadsheet column holds each field (index, or -1). */
export function guessMapping(header: string[]): Record<ImportField, number> {
  const out = {} as Record<ImportField, number>;
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS) {
    const i = header.findIndex((h, idx) => !used.has(idx) && (f.hints as readonly string[]).includes(norm(h)));
    out[f.key] = i;
    if (i >= 0) used.add(i);
  }
  return out;
}

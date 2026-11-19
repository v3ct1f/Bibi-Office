// Template merge fields and the tiny body format shared by the UI, the signing page and the PDF.
//   "# Heading", "## Subheading", "- bullet", blank line = new paragraph. No HTML, ever.

export const FIELD = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\s*\}\}/g;

/** Field names used in a text, in first-seen order. */
export const fieldsIn = (...texts: string[]) => [...new Set(texts.flatMap((t) => [...t.matchAll(FIELD)].map((m) => m[1]!)))];

/** Replace {{fields}}; returns the names that had no value (left in place). */
export function merge(text: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(FIELD, (all, name: string) => {
    const v = values[name];
    if (v === undefined || v === "") { missing.add(name); return all; }
    return v.replace(/\{\{/g, "{ {");   // a value can't inject new fields
  });
  return { text: out, missing: [...missing] };
}

export type Block = { kind: "h1" | "h2" | "p"; text: string } | { kind: "ul"; items: string[] };
export function blocks(body: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: "p", text: para.join(" ") }); para = []; };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: h[1]!.length === 1 ? "h1" : "h2", text: h[2]! }); continue; }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const last = out.at(-1);
      if (last?.kind === "ul") last.items.push(li[1]!); else out.push({ kind: "ul", items: [li[1]!] });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

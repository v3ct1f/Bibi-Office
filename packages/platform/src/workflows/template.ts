/**
 * Minimal, safe templating for action inputs: "{{payload.email}}".
 * No expressions, no code: dotted path lookup only. A string that is exactly one
 * placeholder keeps the raw value type (number, object...).
 */
const ONE = /^\{\{\s*([\w.]+)\s*\}\}$/;
const ANY = /\{\{\s*([\w.]+)\s*\}\}/g;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

function get(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const k of path.split(".")) {
    if (FORBIDDEN.has(k) || cur == null || typeof cur !== "object") return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, k) ? (cur as Record<string, unknown>)[k] : undefined;
  }
  return cur;
}

export function render(value: unknown, data: unknown): unknown {
  if (typeof value === "string") {
    const one = ONE.exec(value);
    if (one) return get(data, one[1]!) ?? null;
    return value.replace(ANY, (_, p: string) => {
      const v = get(data, p);
      return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => render(v, data));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, data)]));
  }
  return value;
}

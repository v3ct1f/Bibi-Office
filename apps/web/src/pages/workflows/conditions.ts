/**
 * Simple condition rows <-> JSONLogic. Rows cover the common case; anything else stays in
 * "advanced" (raw JSONLogic) mode so no definition is ever lost by the editor.
 */
export type Op = "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "exists";
export interface Row { path: string; op: Op; value: string }
export interface Rows { mode: "all" | "any"; rows: Row[] }

export const OPS: { op: Op; label: string }[] = [
  { op: "==", label: "equals" }, { op: "!=", label: "does not equal" }, { op: ">", label: ">" }, { op: ">=", label: "≥" },
  { op: "<", label: "<" }, { op: "<=", label: "≤" }, { op: "in", label: "contains text" }, { op: "exists", label: "is set" },
];

const parseValue = (s: string): unknown => {
  const t = s.trim();
  if (t === "true" || t === "false") return t === "true";
  if (t === "null") return null;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return s;
};
const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function rowsToLogic(r: Rows): unknown {
  const parts = r.rows.filter((x) => x.path.trim()).map((x) => {
    const v = { var: x.path.trim() };
    if (x.op === "exists") return { "!!": [v] };
    if (x.op === "in") return { in: [x.value, v] };
    return { [x.op]: [v, parseValue(x.value)] };
  });
  if (!parts.length) return null;
  return parts.length === 1 && r.mode === "all" ? parts[0] : { [r.mode === "all" ? "and" : "or"]: parts };
}

function one(c: unknown): Row | null {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const [[op, args]] = Object.entries(c) as [[string, unknown]];
  if (!Array.isArray(args)) return null;
  const isVar = (x: unknown): x is { var: string } => !!x && typeof x === "object" && typeof (x as { var?: unknown }).var === "string";
  if (op === "!!" && args.length === 1 && isVar(args[0])) return { path: args[0].var, op: "exists", value: "" };
  if (op === "in" && args.length === 2 && typeof args[0] === "string" && isVar(args[1])) return { path: args[1].var, op: "in", value: args[0] };
  if (["==", "!=", ">", ">=", "<", "<="].includes(op) && args.length === 2 && isVar(args[0]) && (args[1] === null || typeof args[1] !== "object")) {
    return { path: args[0].var, op: op as Op, value: showValue(args[1]) };
  }
  return null;
}

/** Returns rows when the logic is representable, else null (use advanced mode). */
export function logicToRows(c: unknown): Rows | null {
  if (c == null) return { mode: "all", rows: [] };
  const single = one(c);
  if (single) return { mode: "all", rows: [single] };
  if (typeof c === "object" && !Array.isArray(c)) {
    const e = Object.entries(c);
    if (e.length === 1 && (e[0]![0] === "and" || e[0]![0] === "or") && Array.isArray(e[0]![1])) {
      const rows = (e[0]![1] as unknown[]).map(one);
      if (rows.every(Boolean)) return { mode: e[0]![0] === "and" ? "all" : "any", rows: rows as Row[] };
    }
  }
  return null;
}

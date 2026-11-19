import { describe, expect, it } from "vitest";
import { logicToRows, rowsToLogic, type Rows } from "../src/pages/workflows/conditions";
import { hasPermission } from "../src/lib/permissions";
import { contactName, fmtDate, fmtRelative, initials } from "../src/lib/format";

describe("workflow conditions <-> JSONLogic", () => {
  it("empty rows give null and null gives empty rows", () => {
    expect(rowsToLogic({ mode: "all", rows: [] })).toBeNull();
    expect(rowsToLogic({ mode: "all", rows: [{ path: "  ", op: "==", value: "x" }] })).toBeNull();
    expect(logicToRows(null)).toEqual({ mode: "all", rows: [] });
  });

  it("a single 'all' row is not wrapped in and", () => {
    expect(rowsToLogic({ mode: "all", rows: [{ path: "payload.email", op: "exists", value: "" }] })).toEqual({ "!!": [{ var: "payload.email" }] });
  });

  it("parses numbers, booleans and null but keeps other text", () => {
    const logic = rowsToLogic({
      mode: "any",
      rows: [
        { path: "a", op: ">=", value: "10.5" },
        { path: "b", op: "==", value: "true" },
        { path: "c", op: "!=", value: "null" },
        { path: "d", op: "==", value: "007x" },
        { path: "e", op: "in", value: "acme" },
      ],
    });
    expect(logic).toEqual({
      or: [
        { ">=": [{ var: "a" }, 10.5] },
        { "==": [{ var: "b" }, true] },
        { "!=": [{ var: "c" }, null] },
        { "==": [{ var: "d" }, "007x"] },
        { in: ["acme", { var: "e" }] },
      ],
    });
  });

  it("round-trips every operator", () => {
    const rows: Rows = {
      mode: "all",
      rows: [
        { path: "p.a", op: "==", value: "x" }, { path: "p.b", op: "!=", value: "1" }, { path: "p.c", op: ">", value: "2" },
        { path: "p.d", op: ">=", value: "3" }, { path: "p.e", op: "<", value: "4" }, { path: "p.f", op: "<=", value: "5" },
        { path: "p.g", op: "in", value: "txt" }, { path: "p.h", op: "exists", value: "" },
      ],
    };
    expect(logicToRows(rowsToLogic(rows))).toEqual(rows);
  });

  it("returns null for logic the simple editor cannot show (advanced mode)", () => {
    expect(logicToRows({ and: [{ "==": [{ var: "a" }, 1] }, { or: [] }] })).toBeNull();
    expect(logicToRows({ "==": [1, 1] })).toBeNull();
    expect(logicToRows({ "==": [{ var: "a" }, { var: "b" }] })).toBeNull();
    expect(logicToRows({ "+": [1, 2] })).toBeNull();
    expect(logicToRows([1])).toBeNull();
  });
});

describe("hasPermission", () => {
  it("matches exact, module wildcard and global wildcard", () => {
    expect(hasPermission(["core:contacts.read"], "core:contacts.read")).toBe(true);
    expect(hasPermission(["core:*"], "core:contacts.write")).toBe(true);
    expect(hasPermission(new Set(["*"]), "invoicing:invoices.read")).toBe(true);
    expect(hasPermission(["core:contacts.read"], "core:contacts.write")).toBe(false);
    expect(hasPermission(["crm:*"], "core:contacts.read")).toBe(false);
    expect(hasPermission([], undefined)).toBe(true);
  });
});

describe("format helpers", () => {
  it("contactName falls back to email then 'Unnamed'", () => {
    expect(contactName({ firstName: "Ann", lastName: "Lee", email: "a@b.c" })).toBe("Ann Lee");
    expect(contactName({ firstName: null, lastName: null, email: "a@b.c" })).toBe("a@b.c");
    expect(contactName({ firstName: null, lastName: null, email: null })).toBe("Unnamed");
  });

  it("initials uses up to two parts", () => {
    expect(initials("Alice Example")).toBe("AE");
    expect(initials("bob@example.com")).toBe("BE");
    expect(initials("")).toBe("?");
  });

  it("dates show a dash when empty and relative time picks a unit", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtRelative(undefined)).toBe("—");
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    expect(fmtRelative(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe(rtf.format(-2, "hour"));
    expect(fmtRelative(new Date(Date.now() + 3 * 86400_000).toISOString())).toBe(rtf.format(3, "day"));
  });
});

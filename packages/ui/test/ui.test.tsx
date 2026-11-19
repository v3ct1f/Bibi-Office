import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, ConfirmDialog, SchemaForm, coerceTemplateValue, unwrap, type JsonSchema } from "../src/index.ts";
import { defineModuleUi, findPage, matchRoute } from "../src/module-ui.ts";

const settings: JsonSchema = {
  type: "object",
  required: ["currency"],
  properties: {
    currency: { type: "string", enum: ["EUR", "USD"], default: "EUR" },
    paymentTermDays: { type: "integer", minimum: 0, default: 30 },
    autoSend: { type: "boolean" },
    stripeSecretKey: { type: "string", "x-secret": true },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

function Harness({ initial = {}, secretsSet = [] as string[], template = false, schema = settings }) {
  const [v, setV] = useState<Record<string, unknown>>(initial);
  return <><SchemaForm schema={schema} value={v} onChange={setV} secretsSet={secretsSet} template={template} /><pre data-testid="out">{JSON.stringify(v)}</pre></>;
}
const out = () => JSON.parse(screen.getByTestId("out").textContent!);

describe("SchemaForm", () => {
  it("renders typed controls and emits typed values", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.selectOptions(screen.getByLabelText(/Currency/), "USD");
    await u.type(screen.getByLabelText("Payment Term Days"), "14");
    await u.click(screen.getByRole("switch", { name: "Auto Send" }));
    await u.type(screen.getByLabelText("Note"), "x");
    expect(out()).toEqual({ currency: "USD", paymentTermDays: 14, autoSend: true, note: "x" });
    await u.clear(screen.getByLabelText("Note"));
    expect(out().note).toBeNull(); // nullable field cleared -> null
  });

  it("never shows stored secrets; blank keeps, Clear sends null", async () => {
    const u = userEvent.setup();
    render(<Harness secretsSet={["stripeSecretKey"]} />);
    expect(screen.getByText("set")).toBeInTheDocument();
    const pw = screen.getByLabelText(/Stripe Secret Key/);
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveValue("");
    expect(out()).toEqual({});
    await u.click(screen.getByText("Clear"));
    expect(out()).toEqual({ stripeSecretKey: null });
  });

  it("template mode accepts placeholders in numeric fields", async () => {
    const u = userEvent.setup();
    render(<Harness template schema={{ type: "object", properties: { days: { type: "integer" }, title: { type: "string" } } }} />);
    await u.type(screen.getByLabelText("Days"), "{{{{payload.n}}");
    await u.type(screen.getByLabelText("Title"), "Hi {{{{payload.name}}");
    expect(out()).toEqual({ days: "{{payload.n}}", title: "Hi {{payload.name}}" });
  });

  it("helpers", () => {
    expect(coerceTemplateValue("3", "integer")).toBe(3);
    expect(coerceTemplateValue("{{a.b}}", "integer")).toBe("{{a.b}}");
    expect(coerceTemplateValue("", "string")).toBeUndefined();
    expect(unwrap({ type: ["string", "null"] })).toEqual({ schema: { type: "string" }, nullable: true });
  });
});

describe("ConfirmDialog", () => {
  it("awaits onConfirm then closes", async () => {
    const u = userEvent.setup();
    const onConfirm = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete it?" confirmLabel="Delete" destructive onConfirm={onConfirm} />);
    await u.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Button shows busy state", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("module UI contract", () => {
  const A = () => null, B = () => null, C = () => null;
  const m = defineModuleUi({ key: "inv", pages: { "/invoices": A, "/invoices/:id": B, "/invoices/new": C } });
  it("matches routes, static beats param", () => {
    expect(matchRoute("/x/:id", "/x/a%20b")).toEqual({ id: "a b" });
    expect(matchRoute("/x/:id", "/x")).toBeNull();
    expect(findPage(m, "/invoices/new")!.Component).toBe(C);
    expect(findPage(m, "/invoices/7")).toEqual({ Component: B, params: { id: "7" } });
    expect(findPage(m, "/nope")).toBeNull();
  });
  it("rejects relative page routes", () => {
    expect(() => defineModuleUi({ key: "k", pages: { "x": A } })).toThrow(/must start with/);
  });
});

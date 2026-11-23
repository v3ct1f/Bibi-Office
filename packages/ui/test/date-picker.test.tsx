import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatePicker, Field, parseTypedDate, toIsoDate } from "../src/index.ts";

describe("parseTypedDate", () => {
  it("reads ISO, month names and empty text", () => {
    expect(parseTypedDate("2026-11-23")).toBe("2026-11-23");
    expect(parseTypedDate("23 Nov 2026")).toBe("2026-11-23");
    expect(parseTypedDate("Nov 23, 2026")).toBe("2026-11-23");
    expect(parseTypedDate("23 november 2026")).toBe("2026-11-23");
    expect(parseTypedDate("  ")).toBe("");
  });
  it("rejects impossible or partial dates", () => {
    expect(parseTypedDate("2026-02-30")).toBeNull();
    expect(parseTypedDate("23 Nov 20")).toBeNull();
    expect(parseTypedDate("hello")).toBeNull();
  });
});

function Harness({ min, max }: { min?: string; max?: string }) {
  const [v, setV] = useState("");
  return <><Field label="Last day">{(a) => <DatePicker {...a} value={v} onChange={setV} min={min} max={max} />}</Field><output data-testid="out">{v}</output></>;
}

describe("DatePicker", () => {
  it("is found by its label and accepts a typed date", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.type(screen.getByLabelText("Last day"), "2026-03-14");
    expect(screen.getByTestId("out").textContent).toBe("2026-03-14");
  });

  it("picks today from the calendar and moves by keyboard", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByRole("grid")).toBeTruthy();
    await u.keyboard("{ArrowRight}{Enter}");
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    expect(screen.getByTestId("out").textContent).toBe(toIsoDate(tomorrow));
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("disables days outside min/max", async () => {
    const u = userEvent.setup();
    render(<Harness min="2026-11-10" max="2026-11-20" />);
    await u.click(screen.getByRole("button", { name: "Open calendar" }));
    const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;
    expect(day("2026-11-09").disabled).toBe(true);
    expect(day("2026-11-15").disabled).toBe(false);
    expect(day("2026-11-21").disabled).toBe(true);
  });
});

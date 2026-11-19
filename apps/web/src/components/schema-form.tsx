import { useState } from "react";
import { Field, Input, Select } from "@office/ui";
import type { JsonSchema } from "../lib/types.ts";

type Prop = NonNullable<JsonSchema["properties"]>[string];

/**
 * Minimal JSON Schema form for module settings: string, number/integer, boolean, enum.
 * Secret fields ("x-secret") are write-only: blank keeps the stored value.
 */
export function SchemaForm({ schema, values, secretsSet, onChange }: {
  schema: JsonSchema; values: Record<string, unknown>; secretsSet: string[];
  onChange(patch: Record<string, unknown>): void;
}) {
  const props = Object.entries(schema.properties ?? {});
  const [local, setLocal] = useState<Record<string, unknown>>({});
  const set = (k: string, v: unknown) => { const n = { ...local, [k]: v }; setLocal(n); onChange(n); };
  if (!props.length) return <p className="text-sm text-muted">This module has no settings.</p>;
  return (
    <div className="grid gap-4">
      {props.map(([k, p]: [string, Prop]) => {
        const label = p.title ?? k;
        const current = k in local ? local[k] : values[k] ?? p.default ?? "";
        const required = schema.required?.includes(k);
        if (p["x-secret"]) {
          return (
            <Field key={k} label={`${label}${required ? " *" : ""}`} hint={secretsSet.includes(k) ? "Stored. Leave blank to keep." : "Not set."}>
              {(a) => <Input {...a} type="password" autoComplete="off" value={String(local[k] ?? "")} onChange={(e) => set(k, e.target.value || undefined)} />}
            </Field>
          );
        }
        if (p.enum) {
          return (
            <Field key={k} label={label} hint={p.description}>
              {(a) => <Select {...a} value={String(current)} onChange={(e) => set(k, e.target.value)}>
                {p.enum!.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
              </Select>}
            </Field>
          );
        }
        if (p.type === "boolean") {
          return (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!current} onChange={(e) => set(k, e.target.checked)} /> {label}
            </label>
          );
        }
        const num = p.type === "number" || p.type === "integer";
        return (
          <Field key={k} label={`${label}${required ? " *" : ""}`} hint={p.description}>
            {(a) => <Input {...a} type={num ? "number" : "text"} value={String(current)}
              onChange={(e) => set(k, num ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />}
          </Field>
        );
      })}
    </div>
  );
}

/** Drop undefined (untouched secrets) before sending. */
export const cleanPatch = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));

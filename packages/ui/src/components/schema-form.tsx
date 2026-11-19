import type { ReactNode } from "react";
import { Field, Input, Select, Textarea } from "./input.tsx";
import { Switch } from "./controls.tsx";
import { Badge } from "./badge.tsx";

/** JSON Schema subset rendered by SchemaForm (what module settings and action inputs use). */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  "x-secret"?: boolean;
  [k: string]: unknown;
}

type Values = Record<string, unknown>;

/** Collapse `anyOf: [X, {type:"null"}]` (zod nullish) to X, remembering nullability. */
export function unwrap(s: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const alts = s.anyOf ?? s.oneOf;
  if (alts) {
    const nonNull = alts.filter((a) => a.type !== "null");
    if (nonNull.length === 1) return { schema: { ...nonNull[0], ...pick(s) }, nullable: nonNull.length < alts.length };
  }
  if (Array.isArray(s.type)) {
    const t = s.type.filter((x) => x !== "null");
    if (t.length === 1) return { schema: { ...s, type: t[0] }, nullable: t.length < s.type.length };
  }
  return { schema: s, nullable: false };
}
const pick = (s: JsonSchema) => Object.fromEntries(Object.entries(s).filter(([k]) => ["title", "description", "default"].includes(k)));

export function schemaDefaults(schema: JsonSchema): Values {
  const out: Values = {};
  for (const [k, p] of Object.entries(schema.properties ?? {})) if (p.default !== undefined) out[k] = p.default;
  return out;
}

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const TEMPLATE = /\{\{\s*[\w.]+\s*\}\}/;

/** Parse text typed into a non-string field in template mode. */
export function coerceTemplateValue(raw: string, type: string | undefined): unknown {
  if (raw === "") return undefined;
  if (TEMPLATE.test(raw)) return raw;
  if ((type === "number" || type === "integer") && /^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw);
  if (type === "boolean" && (raw === "true" || raw === "false")) return raw === "true";
  return raw;
}

export interface SchemaFormProps {
  schema: JsonSchema;
  value: Values;
  onChange: (v: Values) => void;
  /** Secret fields already stored server-side (shown as "set"; blank = keep). */
  secretsSet?: string[];
  /** Allow {{placeholders}} in every field (workflow action inputs). */
  template?: boolean;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
}

export function SchemaForm({ schema, value, onChange, secretsSet = [], template, errors = {}, disabled }: SchemaFormProps) {
  const props = Object.entries(schema.properties ?? {});
  if (!props.length) return <p className="text-sm text-muted-foreground">No fields.</p>;
  const required = new Set(schema.required ?? []);
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined) delete next[k]; else next[k] = v;
    onChange(next);
  };
  return (
    <div className="grid gap-4">
      {props.map(([k, raw]) => {
        const { schema: s, nullable } = unwrap(raw);
        const label = s.title ?? humanize(k);
        const err = errors[k];
        const hint = s.description;
        const isReq = required.has(k) && !nullable;
        const v = value[k];
        const t = Array.isArray(s.type) ? s.type[0] : s.type;

        if (s["x-secret"]) {
          const isSet = secretsSet.includes(k) && v === undefined;
          return (
            <Field key={k} label={<span className="inline-flex items-center gap-2">{label}{isSet && <Badge variant="success">set</Badge>}</span>}
              hint={hint ?? (isSet ? "Stored encrypted. Leave blank to keep; type to replace." : "Stored encrypted; never shown again.")} error={err}>
              {(a) => (
                <div className="flex gap-2">
                  <Input {...a} type="password" autoComplete="new-password" disabled={disabled} value={typeof v === "string" ? v : ""}
                    placeholder={isSet ? "••••••••" : ""} onChange={(e) => set(k, e.target.value === "" ? undefined : e.target.value)} />
                  {isSet && <button type="button" className="text-xs text-destructive hover:underline cursor-pointer" onClick={() => set(k, null)}>Clear</button>}
                  {v === null && <span className="self-center text-xs text-muted-foreground">will be cleared</span>}
                </div>
              )}
            </Field>
          );
        }

        if (t === "boolean" && !(template && typeof v === "string")) {
          return (
            <div key={k} className="flex items-start justify-between gap-4">
              <div className="grid gap-1"><span className="text-sm font-medium">{label}</span>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</div>
              <Switch aria-label={label} disabled={disabled} checked={v === true || (v === undefined && s.default === true)} onCheckedChange={(c) => set(k, c)} />
            </div>
          );
        }

        if (s.enum) {
          return (
            <Field key={k} label={label} hint={hint} error={err} required={isReq}>
              {(a) => (
                <Select {...a} disabled={disabled} value={v === undefined || v === null ? "" : String(v)}
                  onChange={(e) => {
                    const opt = s.enum!.find((x) => String(x) === e.target.value);
                    set(k, e.target.value === "" ? (nullable ? null : undefined) : opt ?? e.target.value);
                  }}>
                  <option value="">{isReq ? "Select…" : "—"}</option>
                  {s.enum!.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                </Select>
              )}
            </Field>
          );
        }

        if (t === "array" && (unwrap(s.items ?? {}).schema.type === "string" || !s.items)) {
          const arr = Array.isArray(v) ? (v as unknown[]).map(String) : [];
          return (
            <Field key={k} label={label} hint={hint ?? "One per line"} error={err} required={isReq}>
              {(a) => <Textarea {...a} disabled={disabled} rows={3} value={arr.join("\n")}
                onChange={(e) => { const lines = e.target.value.split("\n"); set(k, lines.length === 1 && lines[0] === "" ? undefined : lines); }} />}
            </Field>
          );
        }

        if (t === "object" || t === "array" || (!t && !s.enum)) {
          return <JsonField key={k} label={label} hint={hint} error={err} required={isReq} value={v} disabled={disabled} onChange={(x) => set(k, x)} />;
        }

        const numeric = t === "number" || t === "integer";
        const long = t === "string" && (s.maxLength ?? 0) > 500;
        const inputType = template ? "text" : numeric ? "number"
          : s.format === "email" ? "email" : s.format === "uri" ? "url" : s.format === "date-time" ? "datetime-local" : s.format === "date" ? "date" : "text";
        const shown = v === undefined || v === null ? "" : String(v);
        const onText = (txt: string) => {
          if (template) return set(k, numeric ? coerceTemplateValue(txt, t) : txt === "" ? undefined : txt);
          if (numeric) return set(k, txt === "" ? (nullable ? null : undefined) : Number(txt));
          return set(k, txt === "" ? (nullable ? null : undefined) : txt);
        };
        return (
          <Field key={k} label={label} hint={hint ?? (template ? "Text or {{payload.field}}" : undefined)} error={err} required={isReq}>
            {(a) => long
              ? <Textarea {...a} disabled={disabled} value={shown} onChange={(e) => onText(e.target.value)} />
              : <Input {...a} type={inputType} disabled={disabled} value={shown}
                  {...(numeric && !template ? { min: s.minimum, max: s.maximum, step: t === "integer" ? 1 : "any" } : {})}
                  placeholder={s.default !== undefined ? String(s.default) : undefined}
                  onChange={(e) => onText(e.target.value)} />}
          </Field>
        );
      })}
    </div>
  );
}

function JsonField({ label, hint, error, required, value, onChange, disabled }: {
  label: ReactNode; hint?: string | undefined; error?: string | undefined; required: boolean; value: unknown; disabled?: boolean | undefined; onChange: (v: unknown) => void;
}) {
  return (
    <Field label={label} hint={hint ?? "JSON"} error={error} required={required}>
      {(a) => (
        <Textarea
          {...a} disabled={disabled} rows={4} className="font-mono text-xs"
          defaultValue={value === undefined ? "" : JSON.stringify(value, null, 2)}
          onBlur={(e) => {
            const txt = e.target.value.trim();
            if (!txt) return onChange(undefined);
            try { onChange(JSON.parse(txt)); e.target.setCustomValidity(""); } catch { e.target.setCustomValidity("Invalid JSON"); e.target.reportValidity(); }
          }}
        />
      )}
    </Field>
  );
}

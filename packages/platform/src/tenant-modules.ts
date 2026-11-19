import { and, eq } from "drizzle-orm";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  audit, badRequest, conflict, emitEvent, notFound, type RequestContext,
} from "@office/core";
import { rolePermissions, roles, tenantModules, type Tx } from "@office/db";
import type { ModuleDefinition } from "@office/sdk";
import type { ModuleRegistry } from "./registry.ts";
import type { SecretBox } from "./crypto.ts";
import { createModuleContext, type ModuleState } from "./context.ts";
import type { FileDeps } from "./files.ts";
import type { MailEnv } from "./mail.ts";

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false });
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();
const validatorFor = (m: ModuleDefinition) => {
  let v = validators.get(m.manifest);
  if (!v) { v = ajv.compile(m.manifest.settings); validators.set(m.manifest, v); }
  return v;
};
const secretKeys = (m: ModuleDefinition): string[] => {
  const props = (m.manifest.settings as { properties?: Record<string, { "x-secret"?: boolean }> }).properties ?? {};
  return Object.entries(props).filter(([, s]) => s["x-secret"]).map(([k]) => k);
};

/** `files` absent => ctx.files throws (e.g. a process without storage configured). */
export interface ModuleDeps { registry: ModuleRegistry; secrets: SecretBox; files?: FileDeps | undefined; mail?: MailEnv | undefined }

export async function listModules(tx: Tx, d: ModuleDeps) {
  const rows = await tx.select().from(tenantModules);
  return d.registry.all().map((m) => {
    const r = rows.find((x) => x.moduleKey === m.manifest.key);
    return {
      key: m.manifest.key, name: m.manifest.name, version: m.manifest.version, description: m.manifest.description,
      dependsOn: m.manifest.dependsOn, enabled: r?.enabled ?? false, settings: r?.settings ?? {},
      secretsSet: r?.secrets ? secretKeys(m) : [], permissions: m.manifest.permissions.declares, ui: m.manifest.ui,
      settingsSchema: m.manifest.settings,
    };
  });
}

/** Returns module state if enabled for the tenant in tx, else null. */
export async function loadEnabledModule(tx: Tx, d: ModuleDeps, tenantId: string, key: string): Promise<{ def: ModuleDefinition; state: ModuleState } | null> {
  const def = d.registry.get(key);
  if (!def) return null;
  const [r] = await tx.select().from(tenantModules).where(and(eq(tenantModules.moduleKey, key), eq(tenantModules.enabled, true)));
  if (!r) return null;
  const secrets = r.secrets ? JSON.parse(d.secrets.open(r.secrets, tenantId)) as Record<string, string> : {};
  return { def, state: { settings: r.settings, secrets, files: d.files, mail: d.mail } };
}

export async function enabledModuleKeys(tx: Tx): Promise<Set<string>> {
  const rows = await tx.select({ k: tenantModules.moduleKey }).from(tenantModules).where(eq(tenantModules.enabled, true));
  return new Set(rows.map((r) => r.k));
}

export async function enableModule(tx: Tx, ctx: RequestContext, d: ModuleDeps, key: string) {
  const def = d.registry.get(key);
  if (!def) throw notFound("Module");
  const enabled = await enabledModuleKeys(tx);
  const missing = def.manifest.dependsOn.filter((k) => !enabled.has(k));
  if (missing.length) throw conflict(`Enable required modules first: ${missing.join(", ")}`);

  const [existing] = await tx.select().from(tenantModules).where(eq(tenantModules.moduleKey, key));
  if (existing?.enabled) return { key, enabled: true };
  const settings = existing?.settings ?? {};
  const v = validatorFor(def);
  const candidate = structuredClone(settings);
  if (!v(candidate)) throw conflict("Module settings invalid; update settings first");

  await tx.insert(tenantModules).values({
    tenantId: ctx.tenantId, moduleKey: key, enabled: true, version: def.manifest.version, settings: candidate,
    enabledAt: new Date(), enabledBy: ctx.actor.userId ?? null,
  }).onConflictDoUpdate({
    target: [tenantModules.tenantId, tenantModules.moduleKey],
    set: { enabled: true, version: def.manifest.version, settings: candidate, enabledAt: new Date(), enabledBy: ctx.actor.userId ?? null },
  });

  // Grant declared permissions to their default system roles (admin always; owner already has "*").
  // Only on first enable: later admin edits to roles are respected.
  if (!existing?.enabledAt) {
    const sysRoles = await tx.select().from(roles).where(eq(roles.system, true));
    const grants = def.manifest.permissions.declares.flatMap((p) => {
      const want = new Set(["admin", ...(p.defaultRoles ?? [])]);
      return sysRoles.filter((r) => want.has(r.key)).map((r) => ({ tenantId: ctx.tenantId, roleId: r.id, permission: p.key }));
    });
    if (grants.length) await tx.insert(rolePermissions).values(grants).onConflictDoNothing();
  }

  const loaded = (await loadEnabledModule(tx, d, ctx.tenantId, key))!;
  await def.lifecycle?.enable?.(createModuleContext(tx, ctx, def, loaded.state));
  await audit(tx, ctx, "module.enabled", { type: "module", id: ctx.tenantId }, { key, version: def.manifest.version });
  await emitEvent(tx, ctx, "core.module.enabled", { key, version: def.manifest.version });
  return { key, enabled: true };
}

export async function disableModule(tx: Tx, ctx: RequestContext, d: ModuleDeps, key: string) {
  const def = d.registry.get(key);
  if (!def) throw notFound("Module");
  const enabled = await enabledModuleKeys(tx);
  if (!enabled.has(key)) return { key, enabled: false };
  const blocking = d.registry.dependents(key).filter((m) => enabled.has(m.manifest.key)).map((m) => m.manifest.key);
  if (blocking.length) throw conflict(`Disable dependent modules first: ${blocking.join(", ")}`);
  const loaded = (await loadEnabledModule(tx, d, ctx.tenantId, key))!;
  await def.lifecycle?.disable?.(createModuleContext(tx, ctx, def, loaded.state));
  await tx.update(tenantModules).set({ enabled: false }).where(eq(tenantModules.moduleKey, key));
  // Data is retained; permissions stay assigned but are inert while disabled.
  await audit(tx, ctx, "module.disabled", { type: "module", id: ctx.tenantId }, { key });
  await emitEvent(tx, ctx, "core.module.disabled", { key });
  return { key, enabled: false };
}

/** Merge + validate settings. Secret fields are sealed separately and never returned. Send null to clear a secret. */
export async function updateModuleSettings(tx: Tx, ctx: RequestContext, d: ModuleDeps, key: string, patch: Record<string, unknown>) {
  const def = d.registry.get(key);
  if (!def) throw notFound("Module");
  const sKeys = new Set(secretKeys(def));
  const [row] = await tx.select().from(tenantModules).where(eq(tenantModules.moduleKey, key));
  const secrets: Record<string, string> = row?.secrets ? JSON.parse(d.secrets.open(row.secrets, ctx.tenantId)) : {};
  const settings: Record<string, unknown> = { ...(row?.settings ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (sKeys.has(k)) { if (v === null) delete secrets[k]; else secrets[k] = String(v); }
    else if (v === null) delete settings[k];
    else settings[k] = v;
  }
  const full = { ...settings, ...secrets };
  const v = validatorFor(def);
  if (!v(full)) throw badRequest("Invalid settings", v.errors?.map((e) => ({ path: e.instancePath, message: e.message })));
  for (const k of Object.keys(full)) if (!sKeys.has(k)) settings[k] = full[k]; // keep ajv defaults
  const sealed = Object.keys(secrets).length ? d.secrets.seal(JSON.stringify(secrets), ctx.tenantId) : null;

  await tx.insert(tenantModules).values({
    tenantId: ctx.tenantId, moduleKey: key, enabled: false, version: def.manifest.version, settings, secrets: sealed,
  }).onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleKey], set: { settings, secrets: sealed } });
  await audit(tx, ctx, "module.settings_updated", { type: "module", id: ctx.tenantId },
    { key, changed: Object.keys(patch).map((k) => (sKeys.has(k) ? `${k} (secret)` : k)) });
  return { key, settings, secretsSet: Object.keys(secrets) };
}


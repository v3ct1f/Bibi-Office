# Modules

One folder per module: `modules/<key>/` (package `@office/module-<key>`) with `README.md`, `package.json`, `src/index.ts` (`export default defineModule({...})`), `migrations/*.sql`, `ui/`, `tests/`.

Checklist for a new module:
1. Manifest per ARCHITECTURE.md §4 (permissions `<key>:*`, events `<key>.*`), plus `icon`, `category`
   (finance | sales | team | operations | other) and `roles` (`{ manager?, member?, viewer? }`: permissions each system role gets
   when a company adds the feature; owner and admin always get everything). These drive the "Add features" page.
2. Tables `<key_with_underscores>_*`, each with `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `tenant_id = app_tenant_id()`, composite FKs `(tenant_id, id)`, grants to `office_app`. Installer refuses otherwise.
3. Use only `ctx` (no imports from other modules or `@office/core`).
4. Register in `packages/modules/src/index.ts`, run `pnpm modules:install`.
5. Reference implementation: `apps/api/test/fixtures/sample/`.

## Feature lifecycle (per company)

- Nothing is on by default. Owner/admin (`core:modules.manage`) add or remove features on **Add features** (`/t/<slug>/features`).
- Add: dependencies checked, role grants applied (missing system roles such as Manager are created), `lifecycle.enable` runs,
  `enabled_at`/`enabled_by` stored. Remove: `lifecycle.disable` runs, `disabled_at`/`disabled_by` stored.
- While off, the module's nav/slots disappear and every `/m/<key>/*` route answers **403 `module_disabled`**. Data is never deleted;
  adding the feature again restores access to it.

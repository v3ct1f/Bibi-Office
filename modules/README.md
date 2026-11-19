# Modules

One folder per module: `modules/<key>/` (package `@office/module-<key>`) with `README.md`, `package.json`, `src/index.ts` (`export default defineModule({...})`), `migrations/*.sql`, `ui/`, `tests/`.

Checklist for a new module:
1. Manifest per ARCHITECTURE.md §4 (permissions `<key>:*`, events `<key>.*`).
2. Tables `<key_with_underscores>_*`, each with `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `tenant_id = app_tenant_id()`, composite FKs `(tenant_id, id)`, grants to `office_app`. Installer refuses otherwise.
3. Use only `ctx` (no imports from other modules or `@office/core`).
4. Register in `packages/modules/src/index.ts`, run `pnpm modules:install`.
5. UI: export `{ pages, components }` from `ui/index.tsx` (props: `SlotProps` from `@office/sdk/ui`), register in `apps/web/src/modules/registry.ts`.
6. Reference implementations: `modules/invoicing/` (full), `apps/api/test/fixtures/sample/` (minimal).

| Module | Status |
|---|---|
| `invoicing` | v1.1.0 (Session 5; company tab + `source` in events in Session 6) |
| `crm` | v1.0.0 (Session 6) |
| `expenses` | v1.0.0 (Session 7) |
| `scheduling` | v1.0.0 (Session 8) |

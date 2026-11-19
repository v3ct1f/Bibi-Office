import { defineConfig } from "tsup";
// Bundle workspace packages (TS sources); keep npm deps external.
export default defineConfig({
  // temporal-workflow: plain JS for Temporal's workflow bundler (webpack, no TS loader).
  entry: { main: "src/main.ts", "temporal-workflow": "../../packages/platform/src/workflows/temporal-workflow.ts" }, format: "esm", target: "node22", outDir: "dist",
  sourcemap: true, clean: true, noExternal: [/^@office\//], skipNodeModulesBundle: true, splitting: false,
});

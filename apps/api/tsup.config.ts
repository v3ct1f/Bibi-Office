import { defineConfig } from "tsup";
// Bundle workspace packages (TS sources); keep npm deps external.
export default defineConfig({
  entry: ["src/server.ts"], format: "esm", target: "node22", outDir: "dist",
  sourcemap: true, clean: true, noExternal: [/^@office\//],
});

/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

/**
 * Serves the receipt reader (Tesseract OCR engine + English/Spanish data, used by the Expenses module) from /ocr/,
 * so nothing is loaded from a third-party CDN. Dev: served from node_modules. Build: copied into dist/ocr/.
 */
function ocrAssets(): Plugin {
  const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));
  const core = ["lstm", "simd-lstm", "relaxedsimd-lstm", "", "simd", "relaxedsimd"].map((v) => (v ? `tesseract-core-${v}` : "tesseract-core"));
  const files: Record<string, string> = {
    "ocr/worker.min.js": nm("tesseract.js/dist/worker.min.js"),
    ...Object.fromEntries(core.flatMap((c) => [
      [`ocr/core/${c}.wasm.js`, nm(`tesseract.js-core/${c}.wasm.js`)],
      [`ocr/core/${c}.wasm`, nm(`tesseract.js-core/${c}.wasm`)],
    ])),
    "ocr/lang/eng.traineddata.gz": nm("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
    "ocr/lang/spa.traineddata.gz": nm("@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz"),
  };
  const type = (f: string) => (f.endsWith(".js") ? "text/javascript" : f.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
  return {
    name: "office-ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0]?.replace(/^\//, "");
        const src = path ? files[path] : undefined;
        if (!src) return next();
        res.setHeader("content-type", type(path!));
        res.setHeader("cache-control", "public, max-age=86400");
        res.end(readFileSync(src));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(files)) this.emitFile({ type: "asset", fileName, source: readFileSync(src) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), ocrAssets()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true, target: "es2022" },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.{ts,tsx}"] },
});

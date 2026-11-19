import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const API = process.env.OFFICE_API_PROXY ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { "/api": API } },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), strictPort: true, proxy: { "/api": API } },
  build: { sourcemap: true },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.tsx"] },
} as never);

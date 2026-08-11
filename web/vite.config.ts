/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // Cloudflare Pages はルート配信なので base はそのまま。
  base: "/",
  plugins: [react(), wasm(), topLevelAwait()],
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // E2E は Playwright が回すので vitest からは外す。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

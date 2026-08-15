import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

/**
 * 重量級コーパス(Layer 6)専用のビルド。既存 vite.config.ts には触らない——
 * あちらに入口を足すと VitePWA の workbox がハーネスを precache に巻き込み、
 * 配信する Service Worker が変わってしまう(設計書 §6.4)。
 *
 * React も PWA も要らない。要るのは wasm を読める最小構成だけである。
 */
export default defineConfig({
  base: "/",
  plugins: [wasm(), topLevelAwait()],
  build: {
    target: "es2022",
    outDir: "dist-heavy",
    rollupOptions: { input: "heavy-harness.html" },
  },
});

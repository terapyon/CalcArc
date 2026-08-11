/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // Cloudflare Pages はルート配信なので base はそのまま。
  base: "/",
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      // "prompt" は登録戦略の名前であって UI の有無ではない(設計書 §2)。
      // UI は配線しない: 新 SW は waiting に留まり、全タブ閉鎖後の再訪で
      // 切り替わる。"autoUpdate" にしてはいけない——skipWaiting+clientsClaim が
      // 注入され、実行中のページの下で世代がすり替わり予告なくリロードされる。
      registerType: "prompt",
      workbox: {
        // 既定の glob は {js,css,html} だけで .wasm が precache に載らない。
        // wasm が落ちると「オフラインで開くが計算できない」抜け殻になる。
        globPatterns: ["**/*.{js,css,html,wasm,svg,png,webmanifest}"],
        // 既定 2MB。超過は警告どまりで precache から黙って外れるため、
        // 余裕を持って明示する。番人は scripts/check-sw.mjs(設計書 §7)。
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
      },
      manifest: {
        name: "CalcArc",
        short_name: "CalcArc",
        lang: "ja",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // tokens.css の --surface-bg(ライト)と一致させる。manifest は CSS を
        // 読めないので値の重複はやむを得ない(設計書 §3)。
        theme_color: "#f2f2f7",
        background_color: "#f2f2f7",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // E2E は Playwright が回すので vitest からは外す。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

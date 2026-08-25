/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import pkg from "./package.json";

export default defineConfig({
  // **版数はビルド時に埋める**(0.2.0 設計書 §4)。フッタはシェルが持ち、
  // シェルは WASM を読まないので、core_version() の非同期な経路では
  // 最初の描画に間に合わない。
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
        // png と webmanifest は入れない: プラグインが manifest とその
        // アイコンを自動で precache に注入するため、加えると重複して載る。
        globPatterns: ["**/*.{js,css,html,wasm,svg}"],
        // 既定 2MB。v1.3.0 の実測では超過はビルドエラーになる(劣化した
        // sw.js を書き出してから落ちる)。上限の明示は将来の挙動変化への
        // 備えで、成果物側の番人は scripts/check-sw.mjs(設計書 §7)。
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        // **拡張子を持つパスは navigation fallback の対象にしない。**
        // アドレスバーに /ogp.png と打つのは navigation リクエストなので、
        // 除外しないと SW が index.html(アプリ本体)を返し、画像が見られない
        // (curl では SW を通らないので気づけない)。このアプリはハッシュで
        // タブを切り替えるのでパスにドットが入る経路が無く、SPA の動作には
        // 影響しない。オフラインの `/` のフォールバックもそのまま効く。
        // **判定対象は pathname + search(クエリを含む。ハッシュは含まない)。**
        // `?v=1.2.3` のようなドット入りのクエリを持つリンクを足すと、その 1 本
        // だけ SPA フォールバックが外れる——足すときはここを見ること。
        navigateFallbackDenylist: [/\.[^/]+$/],
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
    // **時間帯を固定する。手元と CI を同じ条件にするためである。**
    // 固定しないと手元は JST、CI の runner は UTC で回り、**時間帯で答が
    // 割れる検査が「手元だけ緑」になる**——2026-08-25 に実際に起きた
    // (`rates.test.ts` の `fetchedAt` が `2026-08-19 23:30` で、JST では
    // 経過 32.98 時間・UTC では 23.98 時間と読まれた)。
    //
    // **値を UTC にしたのは CI の runner に合わせたからで、UTC が正しい
    // からではない。** 製品は利用者の時間帯で動く。**「時間帯によらない」
    // ことは、この固定ではなく専用の検査が主張する**
    // (`rates.test.ts` の「時間帯の無い綴りは…」)——固定は
    // **手元と CI をずらさない**ためだけの道具である。
    env: { TZ: "UTC" },
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // E2E は Playwright が回すので vitest からは外す。
    // `tests/unit` は Playwright の testDir(`tests/heavy`) の外にある——
    // **中に置くと `**\/*.test.*` の既定に当たって両方が拾う。**
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
    ],
  },
});

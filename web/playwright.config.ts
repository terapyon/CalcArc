import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // **ブラウザの時間帯も固定する**(vite.config.ts の `test.env.TZ` と同じ理由)。
  // Playwright はブラウザに時間帯を渡すので、`TZ` 環境変数では効かない。
  use: { baseURL: "http://localhost:4179", timezoneId: "UTC" },
  webServer: {
    // **ポートは 4179（Vite 既定の 4173 ではない）。** 既定のままだと、同じ
    // マシンで動いている別プロジェクトの preview を `reuseExistingServer` が
    // 掴み、**他人のページに対してテストが走る**。2026-08-15 に実際に起きた
    // ——`cmscom-lp-vector` が 4173 を `--strictPort` で握っており、こちらの
    // preview は起動できず、E2E は相手のランディングページを見ていた。
    // `preview` 側にも `--strictPort` を付けてあるので、取れなければ黙って
    // 別ポートに逃げず、その場で落ちる。
    // wasm は事前に用意されている前提。ローカルでは pnpm wasm を先に実行する。
    command: "pnpm exec vite build && pnpm preview",
    url: "http://localhost:4179",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "mobile",
      // スマートフォン第一(base-spec §42)。既定の viewport を縦持ちにする。
      use: { viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
});

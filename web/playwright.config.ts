import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // **ブラウザの時間帯も固定する**(vite.config.ts の `test.env.TZ` と同じ理由)。
  // Playwright はブラウザに時間帯を渡すので、`TZ` 環境変数では効かない。
  use: {
    baseURL: "http://localhost:4179",
    timezoneId: "UTC",
    // 落ちた検査の画面を報告書に残す(下の html と対)。
    screenshot: "only-on-failure",
  },
  // **失敗の報告書を html で書く**(2026-09-11)。書き出し先は ci.yml の
  // 2 つの E2E ジョブが落ちた日に上げる `web/playwright-report/` である。
  // **それまで reporter を書いておらず、html は 1 度も作られていなかった**
  // ——upload の段は「No files were found」の警告だけで success になり、
  // **Chromium の End-to-end も含めて、落ちた日に報告書が上がったことは
  // 1 度も無い**(WebKit の最初の走行 34543367685 で見つけた)。
  // 端末の出力は既定のまま(CI は dot、手元は list)。
  // 番人は `tools/tests/webkit-gate.test.ts`(書き出し先と upload の path)。
  reporter: [
    [process.env.CI ? "dot" : "list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
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
    {
      name: "webkit",
      // **Safari のエンジン（WebKit）で同じ E2E を回す**（1.0 の門 1、
      // `docs/superpowers/specs/2026-09-10-one-point-oh-gate-design.md` §1.3）。
      // iPhone では、どのブラウザも中身は WebKit である。
      //
      // **条件は `mobile` と 1 つも変えない**（390×844、`isMobile: false`）。
      // **変える変数をエンジンの 1 つにするため**である——`devices["iPhone 13"]`
      // のような端末定義にすると、エンジンと端末の振る舞い（`isMobile`・タッチ・
      // 拡大率・UA）が同時に変わり、落ちたときに**どちらのせいか分からない**。
      // 端末の振る舞いは、エンジンの差を片付けてから 1 つずつ足す。
      //
      // **CI では別のジョブ（`End-to-end (WebKit)`）が回す。** `pnpm e2e` は
      // `--project mobile` だけを回す。**2026-09-10 の作業機では WebKit が
      // 起動しなかった**（共有ライブラリ `libavif16` と
      // `libgstreamer-plugins-bad1.0-0` が無い。設計書 §1.2）。回せる環境では
      // `pnpm exec playwright test --project webkit`。
      //
      // 番人は `tools/tests/webkit-gate.test.ts`（この project が在ること、
      // `browserName` のほかは `mobile` と同じであること）。
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: false,
      },
    },
  ],
});

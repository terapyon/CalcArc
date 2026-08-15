import { defineConfig } from "@playwright/test";

/**
 * 重量級コーパス(Layer 6)。既存 playwright.config.ts の testDir は
 * ./tests/e2e なので、こちらの spec は構造的に拾われない(設計書 §6.2)。
 */
export default defineConfig({
  testDir: "./tests/heavy",
  // 1 シャードで数千件を回す。既定の 30 秒では足りない。
  timeout: 300_000,
  // **1 ファイル内の test を並列に走らせない。** fullyParallel が制御するのは
  // 並列度だけで、失敗時に打ち切るかどうか(bail / maxFailures)とは無関係
  // である(レビュー修正ラウンド 2 でコメントの誤りを訂正)。ここで直列に
  // するのは、シャードごとに数千件を 1 往復で流すテストが同時に走ると
  // ブラウザ 1 つに重い evaluate が重なり、報告の順序も混ざるためである。
  fullyParallel: false,
  use: { baseURL: "http://localhost:4180" },
  webServer: {
    // **ポートは 4180。** 既存 E2E は 4179、Vite 既定は 4173。どちらとも
    // 衝突させない。--strictPort は「取れなければ黙って別ポートに逃げる」を
    // 禁じる——2026-08-15 に他プロジェクトの preview を掴む事故が実在した。
    command:
      "pnpm exec vite build --config vite.heavy.config.ts && pnpm exec vite preview --config vite.heavy.config.ts --port 4180 --strictPort",
    url: "http://localhost:4180/heavy-harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

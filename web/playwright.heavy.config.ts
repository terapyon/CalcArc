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
  //
  // **そしてもう一つ、この設定は集計そのものを支えている。**
  // `tests/heavy/report.ts` はモジュールスコープの配列 `summaries` に
  // `record()` で積み、`test.afterAll` の `writeReport()` で 1 枚の
  // `heavy-report.md` を書き出す。`fullyParallel: true` にすると各テストが
  // 別ワーカー(別プロセス)に散り、**ワーカーごとに別のモジュールインスタンス**
  // になる。すると各ワーカーが自分の見た分だけの `summaries` を持って
  // 同じ `heavy-report.md` を上書きし合い、**集計が黙って消える**——
  // 落ちるのではなく、件数の減った緑の報告書が残る。並列にしたいときは、
  // 先に集計をプロセス間で合流させる仕組み(各ワーカーが別ファイルに書き、
  // グローバル teardown で束ねる等)を用意すること。
  fullyParallel: false,
  use: { baseURL: "http://localhost:4180" },
  webServer: {
    // **ポートは 4180。** 既存 E2E は 4179、Vite 既定は 4173。どちらとも
    // 衝突させない。--strictPort は「取れなければ黙って別ポートに逃げる」を
    // 禁じる——2026-08-15 に他プロジェクトの preview を掴む事故が実在した。
    command:
      "pnpm exec vite build --config vite.heavy.config.ts && pnpm exec vite preview --config vite.heavy.config.ts --port 4180 --strictPort",
    url: "http://localhost:4180/heavy-harness.html",
    // **手元では 4180 に既に居るものを掴む。** CI では毎回立て直すが、
    // ローカルでは起動が遅いので使い回す。その代償として、**4180 に別物が
    // 居ればそれを掴む**。2026-08-15 の敵対者レビューはこれを使い、
    // 「あらゆるキー列に `{main: "0"}` を返すだけ」の偽ハーネスを 4180 に
    // 置いて全件を緑にした。古いビルドを掴むのも同じ経路である。
    //
    // ハーネスが自分の素性(`calc.version()`)を返し、それが報告書の
    // 「計算コア(wasm)」欄に載るので、**掴んだものが何かは報告書から読める**。
    // ただし版が同じ偽物は見分けられない。結果を疑うときは 4180 を落として
    // から回すこと(`CI=1 pnpm heavy` でも毎回立て直す)。
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

import { defineConfig } from "@playwright/test";

/**
 * 重量級コーパス(Layer 6)。既存 playwright.config.ts の testDir は
 * ./tests/e2e なので、こちらの spec は構造的に拾われない(設計書 §6.2)。
 */
export default defineConfig({
  testDir: "./tests/heavy",
  // 1 シャードで数千件を回す。既定の 30 秒では足りない。
  timeout: 300_000,
  // **集計はワーカーの外に置く。**
  // `tests/heavy/report.ts` の `record()` が、シャード 1 枚につき 1 ファイルを
  // `web/.heavy-summaries/` に書く。`globalSetup` が走行の頭でそのディレクトリと
  // 前回の `heavy-report.md` を消し、`globalTeardown` が全部を読んで 1 枚の
  // 報告書に束ねる。**プロセス内の配列に集計を溜めない。**
  //
  // 以前はモジュールスコープの配列 `summaries` に積み、`test.afterAll` で
  // 書き出していた。Playwright は**テストが 1 本落ちるとワーカーを再起動する**
  // ので、そのとき配列ごと集計が消える。新しいワーカーの `afterAll` が自分の
  // 見た分だけで同じファイルを上書きし、実測では 1 件の `expect.re` を壊した
  // だけで「値: 0 / 不一致: 0 / 最大相対誤差 0.00e+0」——**赤い走行のあとに
  // 緑の顔をした報告書**が残った(`wrote …heavy-report.md` がログに 2 回出る)。
  // `fullyParallel: true` は同じ壊れ方を**落ちなくても**引き起こすが、
  // 原因はそこではなく、集計をワーカーのメモリに置いていたことだった。
  globalSetup: "./tests/heavy/global-setup.ts",
  globalTeardown: "./tests/heavy/global-teardown.ts",
  // **1 ファイル内の test を並列に走らせない。** fullyParallel が制御するのは
  // 並列度だけで、失敗時に打ち切るかどうか(bail / maxFailures)とは無関係
  // である(レビュー修正ラウンド 2 でコメントの誤りを訂正)。ここで直列に
  // するのは、シャードごとに数千件を 1 往復で流すテストが同時に走ると
  // ブラウザ 1 つに重い evaluate が重なり、報告の順序も混ざるためである。
  // 集計の合流はもう上の globalSetup / globalTeardown が担っているので、
  // この設定はレポートの正しさを支えていない。
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

import { defineConfig, devices } from "@playwright/test";

/**
 * 重量級コーパスの **UI 経路**(設計書 2026-08-15 §12 の段階 4)。
 *
 * **`playwright.heavy.config.ts` とはブラウザに載るものが違う。** あちらは
 * `heavy-harness.html` だけを配信するので、**画面が存在しない**——計算コアは
 * 呼べるが、ボタンが押せる場所にあるか、Shift の奥のキーに届くか、表示に
 * 配線されているかは何も分からない。ここは**本物のアプリ**を配信する。
 *
 * 遅い。1 件ごとに実際のクリックが要るので、コアを直接呼ぶ経路の数百倍かかる。
 * だから**全件は通さない**——通すのは「押せること」と「代表を押した結果」で、
 * 網羅は計算コアの経路が担う。
 */
export default defineConfig({
  testDir: "./tests/ui",
  // 実クリックは 1 件あたり数十 ms かかるので既定(30 秒)では足りないが、
  // **長すぎる timeout は「壊れている」と「遅い」を区別できなくする**——
  // 最初にこれを 600 秒にしたせいで、ハングが 10 分待たないと見えなかった。
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // **押したキーの集計はワーカーの外に置く。**
  // `tests/heavy-ui/presses.ts` の `recordPress()` が、ワーカー 1 つにつき
  // 1 ファイルを `web/.heavy-ui-presses/` に書く。`globalSetup` が走行の頭で
  // そのディレクトリと前回の `heavy-ui-run.json` を消し、`globalTeardown` が
  // 全部を読んで**指示書 §8 の 9 キーが実際に押されたか**を主張する。
  //
  // **主張をテストファイルに置かない。** ファイルの実行順に依存すると、
  // 記録より先に検査が走って空の台帳を見る。`globalTeardown` は走行そのものに
  // 紐づいていて、テストが落ちても必ず 1 度だけ走る(`playwright.heavy.config.ts`
  // の `writeReport` がそこに居るのと同じ理由である)。
  globalSetup: "./tests/ui/global-setup.ts",
  globalTeardown: "./tests/ui/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:4181",
  },
  webServer: {
    // **ポートは 4181。** 既存 E2E が 4179、ハーネスが 4180、Vite 既定が 4173。
    // どれとも衝突させない。`--strictPort` は「取れなければ黙って別ポートに
    // 逃げる」を禁じる——他プロジェクトの preview を掴む事故が実在した。
    // アプリのビルドは web の仕事。heavy はアプリのビルド設定を持たないので、
    // ここで web に cd してから vite を呼ぶ。
    cwd: "../web",
    command:
      "pnpm exec vite build && pnpm exec vite preview --port 4181 --strictPort",
    url: "http://localhost:4181",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

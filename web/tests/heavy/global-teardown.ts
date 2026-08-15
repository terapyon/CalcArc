import { writeReport } from "./report";

/**
 * **報告書は走行の最後に 1 度だけ書く。**
 *
 * 以前これは `corpus.spec.ts` の `test.afterAll` にあった。Playwright は
 * テストが 1 本落ちるとワーカーを再起動するので、`afterAll` は**生き残った
 * ワーカーごとに**走り、それぞれが自分の見た分だけで同じファイルを上書き
 * した(ログに `wrote …heavy-report.md` が 2 回出る)。実測では 1 件の
 * `expect.re` を壊しただけで、赤い走行のあとに「値: 0 / 不一致: 0 /
 * 最大相対誤差 0.00e+0」という**緑の顔をした成果物**が残った。
 *
 * `globalTeardown` はワーカーではなく走行そのものに紐づいていて、テストが
 * 落ちても必ず 1 度だけ走る。集計はディスクから読むので、途中で死んだ
 * ワーカーが書いた分も残っている。
 */
export default function globalTeardown(): void {
  writeReport();
}

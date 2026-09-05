import { CONVERT_CATEGORY_IDS } from "../../src/convert/types";
import { SCALE_CATEGORIES } from "../../src/route";
import { expect, test } from "./fixtures";

/**
 * **画面の現在地**——タブの名前(`document.title`)と、この先この計画が足す
 * `<h1>` を見る(設計書 §3・§4)。
 *
 * **なぜ E2E か。** `document.title` だけなら jsdom でも読めるので、
 * `App.test.tsx` でも書ける。だがこの計画では**同じファイルが `<h1>` と
 * その役割の意味論も見る**ことになり、そちらは jsdom では確かめられない
 * ——**jsdom はアクセシビリティツリーを組み立てない**(CLAUDE.md「踏んだ罠」)。
 * 設計書 §4.3 の実測もそこが本体である(`display:none` にすると役割クエリが
 * 0 件になる。`clip-path` の綴りなら 1 件)。
 *
 * **タイトルと見出しは「いまどの画面に居るか」という 1 つの主張**なので、
 * 2 つの層に割らず**ここ 1 か所で見る**。片方だけ直した日に、もう片方が
 * 同じファイルの隣の行で赤くなる。
 */

/**
 * 13 route と、そのタブの名前。
 *
 * **期待値は逐一、手で書く。** アプリと同じ表(`web/src/ui/screenName.ts`)から
 * 組み立てる形も採れるが採らない——**組み立てると、表と期待値が同時に
 * 間違っても緑になる**。`tools/check-boundary.mjs` の 4 本目に同じ理由が
 * 書いてある(「テストが期待値を自分で持つのは正しい——トークンを読んで
 * 突き合わせたら、両方が同時に間違っても緑になる」)。
 *
 * **導くのは網羅だけである**(下の 1 本)。カテゴリを足してこの一覧に
 * 書き忘れたら、件数が合わずに赤くなる。
 *
 * **13 全部を入れる。** `#convert/currency` と `#scale/llm` は
 * `viewport-budget.spec.ts` の巡回からは外れているが、**あれは寸法の話**
 * (レートの状態と、ユーザーが許容した縦の溢れ)であって、
 * **タブの名前には効かない**。
 */
const SCREENS = [
  ["#scientific", "関数電卓 | CalcArc"],
  ["#convert/length", "長さの換算 | CalcArc"],
  ["#convert/mass", "質量の換算 | CalcArc"],
  ["#convert/temperature", "温度の換算 | CalcArc"],
  ["#convert/area", "面積の換算 | CalcArc"],
  ["#convert/volume", "体積の換算 | CalcArc"],
  ["#convert/speed", "速さの換算 | CalcArc"],
  ["#convert/data-size", "データ量の換算 | CalcArc"],
  ["#convert/currency", "為替の換算 | CalcArc"],
  ["#scale/data-scale", "データ量の規模 | CalcArc"],
  ["#scale/llm", "LLM のメモリ | CalcArc"],
  ["#scale/transfer", "データ転送 | CalcArc"],
  ["#finance", "金融計算 | CalcArc"],
] as const;

test("the tour covers every route there is", () => {
  // **網羅だけを機械から導く。** scientific 1 + convert 8 + scale 3 +
  // finance 1。**手で `13` と書かない**——カテゴリが増えた日に、この数だけが
  // 古いまま残る。
  expect(
    SCREENS.length,
    `the tour lists ${SCREENS.length} screens: ${SCREENS.map(([hash]) => hash).join(" ")}`,
  ).toBe(1 + CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1);
});

for (const [hash, title] of SCREENS) {
  test(`${hash} is titled ${title}`, async ({ page }) => {
    await page.goto(`/${hash}`);
    // **パネルの描画は待たない。** タイトルは `App` の effect が書くので、
    // WASM の読み込みとは無関係に最初の描画のあとで入る。`toHaveTitle` 自身が
    // 待つ。
    await expect(page).toHaveTitle(title);
  });
}

test("an unknown hash falls back to the default screen", async ({ page }) => {
  // **互換分岐を作らないという `route.ts` の裁定**の、タイトル側の姿。
  // 知らない先頭は `scientific` へ倒れるので、名前もそちらになる。
  await page.goto("/#nope");
  await expect(page).toHaveTitle("関数電卓 | CalcArc");
});

test("the bare URL is titled as the default screen too", async ({ page }) => {
  // **`index.html` の `<title>CalcArc</title>` のままにしない**(設計書 §3)。
  // ハッシュが無くても `routeFromHash` は `scientific` へ倒す。
  await page.goto("/");
  await expect(page).toHaveTitle("関数電卓 | CalcArc");
});

test("the title follows the hash without reloading the document", async ({
  page,
}) => {
  // **上の巡回は、これだけでは「読み込み直したから変わった」と区別が
  // つかない。** ハッシュだけを変える遷移は same-document navigation で、
  // document も React の木も入れ替わらない——**そこでも effect が追随する**
  // ことが、盤面をタブで渡り歩いたときに名前が付いてくる根拠である。
  await page.goto("/#scientific");
  await expect(page).toHaveTitle("関数電卓 | CalcArc");

  // **この document が生き延びたことの印。** 読み込み直しが起きれば消える。
  await page.evaluate(() => {
    (window as Window & { __sameDocument?: true }).__sameDocument = true;
  });

  // **`page.goto` を使わない。** ハッシュを書き換えるだけにして、
  // 「読み込んだから変わった」という説明を塞ぐ。
  await page.evaluate(() => {
    window.location.hash = "#finance";
  });

  await expect(page).toHaveTitle("金融計算 | CalcArc");

  // **印が残っていること。** 残っていれば、名前を変えたのは新しい document
  // ではなく、生きたままの `App` の effect である。
  const survived = await page.evaluate(
    () =>
      (window as Window & { __sameDocument?: true }).__sameDocument === true,
  );
  expect(survived, "the document was reloaded — this proves nothing").toBe(
    true,
  );
});

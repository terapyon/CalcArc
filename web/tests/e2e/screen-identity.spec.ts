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
 * 13 route と、そのタブの名前と、その `<h1>` の名前。
 *
 * **3 列目も手で書く。** タイトルから ` | CalcArc` を剥いで作る形も採れるが
 * 採らない——それでは「見出しとタブが同じ文字列である」という主張が、
 * **自分で作った文字列を自分と突き合わせるだけ**になる。2 列が独立に
 * 書かれているからこそ、下の `the tab name starts with the heading`
 * (§4)が意味を持つ。
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
  ["#scientific", "関数電卓 | CalcArc", "関数電卓"],
  ["#convert/length", "長さの換算 | CalcArc", "長さの換算"],
  ["#convert/mass", "質量の換算 | CalcArc", "質量の換算"],
  ["#convert/temperature", "温度の換算 | CalcArc", "温度の換算"],
  ["#convert/area", "面積の換算 | CalcArc", "面積の換算"],
  ["#convert/volume", "体積の換算 | CalcArc", "体積の換算"],
  ["#convert/speed", "速さの換算 | CalcArc", "速さの換算"],
  ["#convert/data-size", "データ量の換算 | CalcArc", "データ量の換算"],
  ["#convert/currency", "為替の換算 | CalcArc", "為替の換算"],
  ["#scale/data-scale", "データ量の規模 | CalcArc", "データ量の規模"],
  ["#scale/llm", "LLM のメモリ | CalcArc", "LLM のメモリ"],
  ["#scale/transfer", "データ転送 | CalcArc", "データ転送"],
  ["#finance", "金融計算 | CalcArc", "金融計算"],
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

for (const [hash, title, heading] of SCREENS) {
  test(`${hash} is titled ${title}`, async ({ page }) => {
    await page.goto(`/${hash}`);
    // **パネルの描画は待たない。** タイトルは `App` の effect が書くので、
    // WASM の読み込みとは無関係に最初の描画のあとで入る。`toHaveTitle` 自身が
    // 待つ。
    await expect(page).toHaveTitle(title);
  });

  test(`${hash} is headed ${heading}`, async ({ page }) => {
    await page.goto(`/${hash}`);

    // **役割で引く。`h1` というタグ名では引かない。** ここが設計書 §4.3 の
    // 実測が効く場所である——`visually-hidden` を `display:none` や
    // `visibility:hidden` に取り違えると、タグは在るのに
    // **アクセシビリティツリーから消えて 0 件になる**。タグ名で引くと
    // その取り違えは緑のまま通る。
    //
    // **`exact: true`。** 既定は部分一致なので、`データ量の換算` が
    // `データ量の規模` を拾うといった取り違えを塞ぐ。
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toHaveCount(1);

    // **ページ全体でちょうど 1 つ。** 見出しの階層は `<h1>` が 1 つである
    // ことを前提にしている。`App` が持つという置き場所がこれを保証して
    // いるので、**この行はその置き場所が動いた日に赤くなる**
    // (パネル側へ移すと、パネルが 2 つ出た日に 2 つになる)。
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
}

test("the tab name starts with the heading, on every screen", async () => {
  // **見出しで確認した名前とタブの名前が食い違わない**(設計書 §4)。
  // 上の 2 本は 2 つの文字列を別々に見ているだけで、**同じ文字列である
  // という主張はどこにも無い**——それをここが持つ。一覧の 2 列は独立に
  // 手で書かれているので、片方だけ直した日にここが赤くなる。
  const mismatched = SCREENS.filter(
    ([, title, heading]) => title !== `${heading} | CalcArc`,
  );
  expect(
    mismatched,
    `the tab name and the heading disagree: ${JSON.stringify(mismatched)}`,
  ).toEqual([]);
});

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

test("the history screen keeps the <h1> and nests its own <h2> under it", async ({
  page,
}) => {
  // **履歴の面は route ではない**(設計書 §8)。`showingHistory` は
  // `ScientificPanel` の state で、ハッシュは `#scientific` のままである。
  // したがって**`<h1>` は `App` が持ったまま消えず**、`History` の
  // `<h2>履歴` がその下に入る——**いま飛んでいる見出しの段が埋まる**のが
  // この面である。
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toBeVisible();

  await page
    .getByRole("button", { name: "第2面に切り替え", exact: true })
    .click();
  await page.getByRole("button", { name: "履歴", exact: true }).click();

  // **見出しを document の順で全部並べる。** 「`<h1>` が在る」と
  // 「`<h2>` がその下に来る」は別の主張で、後者は順序でしか言えない
  // ——`getByRole("heading").all()` は DOM の順に返る。**件数も同時に
  // 主張している**ので、3 つ目の見出しが増えた日にもここが赤くなる。
  const headings = await page.getByRole("heading").all();
  const seen = await Promise.all(
    headings.map(async (h) => ({
      tag: await h.evaluate((el) => el.tagName),
      text: (await h.textContent())?.trim(),
    })),
  );
  expect(
    seen,
    `headings on the history screen: ${JSON.stringify(seen)}`,
  ).toEqual([
    { tag: "H1", text: "関数電卓" },
    { tag: "H2", text: "履歴" },
  ]);

  // **タイトルは `関数電卓 | CalcArc` のまま**(設計書 §8.1)。履歴の面は
  // route ではないので、タブの名前は動かない。**これは穴として認識された
  // うえで利用者が承認した挙動**である(直すなら履歴を route にする話に
  // なり、それは URL 設計の変更で、この計画の範囲ではない)。
  // **意図であることを、検査で固定する**——気づかず変えた日に赤くなる。
  await expect(page).toHaveTitle("関数電卓 | CalcArc");
});

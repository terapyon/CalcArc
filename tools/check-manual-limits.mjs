// **マニュアルが読者に見せている上限の数**が、**製品が実際に使っている数**と
// 一致しているかを見張る番人。
//
// **なぜ要るか(実測、仮定ではない)。** 0.9.2 のマニュアル監査で、上限の表の主張が
// **どのテストにも覆われていない**ことが分かった——マニュアルの数値を見ている番人は
// `web/tests/unit/manual-widths.test.ts` の**画面幅 2 つだけ**で、上限の表を見る行は
// **0 本**だった。実際に 2 件の誤りが見つかっている(年利の「8 文字」、残価の例の欠落)。
//
// # この番人の形
//
// **ソースの本文を読んで数を取り出し、マニュアルの文と突き合わせる。**
// `tools/check-version.mjs` が 6 か所の版数でやっているのと同じ作法である
// ——**実行時の値は要らない。突き合わせたいのは「文書に書かれた数」と
// 「ソースに書かれた数」だからである。** だから **`pub`/`export` を 1 つも増やさない**。
//
// # 3 つの落とし穴(どれも 0.9.3 の設計で実測した)
//
// 1. **文書の数と定数の数は、同じとは限らない。** 小数点の壁は、定数が **8** で
//    マニュアルは **7 文字まで**と書く——`pushDot` が `length >= max` で拒むからで、
//    **どちらも正しい**。だから**導き方を 1 行書く**。`==` で比べると**正しい文書が赤くなる**。
// 2. **同じ数が別の場所にもある。** `1200` は盤面とコアに別々に在り、`10` は
//    `numeric/format.rs` と `convert/format.rs` の両方に在る。**数の一致だけを見る番人は、
//    間違った相手と握手していても緑になる**ので、**どのファイルのどの綴りを読むかを名指しする**。
// 3. **型の上限は、ソースに数として現れない。** `18,446,744,073,709,551,615` は
//    `u64` の上限であって、どこにも書かれていない。**計算して比べる**——そして
//    **`parse::<u64>` が実在することも確かめる**(型が変われば、その行が変わる)。
//
// # 見たことを証明する
//
// **行ごとに「ちょうど 1 件見つかった」を確かめ、0 件なら落とす。** マニュアル側の文でも、
// ソース側の綴りでも同じ——**綴りが変わった日に黙って緑にならないため**である
// (`check-citations.mjs`・`check-conflict-markers.mjs` と同じ床の置き方)。
//
// # 行番号で探さない
//
// **マニュアルは書き換わる。** 行番号で当てる番人は、章を 1 つ足した日に全部赤くなる。
// **文で探す**(表の項目名、箇条書きの言い回し)。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

/**
 * @typedef {{name: string, manual: number, source: number, why: string}} Row
 */

/** マニュアルから**ちょうど 1 件**の数を取り出す。0 件でも 2 件でも落とす。 */
function numberInManual(text, label, pattern) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `マニュアルの「${label}」が ${matches.length} 件見つかった(1 件であること)。` +
        "マニュアルの言い回しが変わったか、この番人の探し方が古い。",
    );
  }
  return Number(matches[0][1].replace(/,/g, ""));
}

/** ソースの `const NAME = 123;` から**ちょうど 1 件**の数を取り出す。 */
function numberInConst(text, path, name) {
  const pattern = new RegExp(
    `const\\s+${name}\\s*(?::\\s*[A-Za-z0-9_]+)?\\s*=\\s*([0-9_]+)`,
    "g",
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${path} の \`${name}\` が ${matches.length} 件見つかった(1 件であること)。` +
        "定数が消えたか、名前が変わったか、同じ名前が 2 つある。",
    );
  }
  return Number(matches[0][1].replace(/_/g, ""));
}

/** ソースに綴りが**ちょうど 1 回**現れることを確かめる(型の錨)。 */
function spellingAppearsOnce(text, path, spelling) {
  const count = text.split(spelling).length - 1;
  if (count !== 1) {
    throw new Error(
      `${path} に \`${spelling}\` が ${count} 回現れた(1 回であること)。` +
        "型が変わったか、受け口が増えている。",
    );
  }
}

export function collectRows() {
  const manual = read("docs/manual/detail.ja.md");
  const state = read("crates/calcarc-core/src/engine/state.rs");
  const convertEntry = read("web/src/convert/entry.ts");
  const financeEntry = read("web/src/finance/entry.ts");
  const financePanel = read("web/src/ui/Finance/FinancePanel.tsx");
  const compound = read("crates/calcarc-core/src/finance/compound.rs");
  const closedForm = read(
    "crates/calcarc-core/src/finance/loan/closed_form.rs",
  );

  /** @type {Row[]} */
  const rows = [];

  // ## 打鍵で止まる(打てなくなる)
  rows.push({
    name: "Scientific の入力の文字数",
    manual: numberInManual(
      manual,
      "Scientific の入力（… 文字）",
      /Scientific の入力[^|]*\|\s*(\d+) 文字/g,
    ),
    source: numberInConst(state, "engine/state.rs", "MAX_ENTRY_LEN"),
    why: "そのまま。`digits.len() >= MAX_ENTRY_LEN` で打鍵を落とす",
  });

  rows.push({
    name: "Exp のあとの指数の桁数",
    manual: numberInManual(
      manual,
      "【Exp】のあとの指数は別に … 桁まで",
      /【Exp】のあとの指数は別に (\d+) 桁まで/g,
    ),
    source: numberInConst(state, "engine/state.rs", "MAX_EXPONENT_LEN"),
    why: "そのまま。`exponent.digits.len() >= MAX_EXPONENT_LEN` で落とす",
  });

  rows.push({
    name: "Convert の値の桁数",
    manual: numberInManual(
      manual,
      "Convert の値（… 桁）",
      /Convert の値[^|]*\|\s*(\d+) 桁/g,
    ),
    source: numberInConst(convertEntry, "convert/entry.ts", "MAX_VALUE_DIGITS"),
    why: "そのまま。数字も小数点も同じ定数を通る",
  });

  rows.push({
    name: "Finance の金額の桁数",
    manual: numberInManual(
      manual,
      "Finance の金額（… 桁）",
      /Finance の金額[^|]*\|\s*(\d+) 桁/g,
    ),
    source: numberInConst(financeEntry, "finance/entry.ts", "MAX_YEN_DIGITS"),
    why: "そのまま。`pressDigit` は項目で分岐しない",
  });

  // **導き方が要る行。** `pushDot` は `tail.text.length >= maxDigits` で拒むので、
  // **`MAX_RATE_LEN` 文字目では打てず、その 1 つ手前まで打てる**。
  // マニュアルはその「打てるほう」を書いている。**ここを `==` にすると、正しい文書が赤くなる。**
  const rateLen = numberInConst(
    financePanel,
    "ui/Finance/FinancePanel.tsx",
    "MAX_RATE_LEN",
  );
  rows.push({
    name: "小数点を打てる文字数",
    manual: numberInManual(
      manual,
      "小数点は、いま打っている数が … 文字までのあいだ",
      /小数点は、いま打っている数が (\d+) 文字までのあいだ/g,
    ),
    source: rateLen - 1,
    why: `MAX_RATE_LEN(${rateLen}) − 1。\`length >= max\` で拒むので、その手前までは打てる`,
  });

  // ## 打てるが、答えで断られる
  //
  // **註: この行は打鍵の壁ではない。** 盤面の `MAX_PERIODS` を読むのは
  // `domainOf` の**着地**だけで、数字の打鍵は `MAX_YEN_DIGITS` を通る。
  // **「打てなくなる」と読んで経路を強化すると、間違った場所を触ることになる。**
  const periodsInPanel = numberInConst(
    financePanel,
    "ui/Finance/FinancePanel.tsx",
    "MAX_PERIODS",
  );
  const periodsInCore = numberInConst(
    compound,
    "finance/compound.rs",
    "MAX_PERIODS",
  );
  if (periodsInPanel !== periodsInCore) {
    throw new Error(
      `期間の上限が盤面(${periodsInPanel})とコア(${periodsInCore})で食い違っている。` +
        "**どちらも計算は正しいままなので、ほかのどの検査にも映らない**" +
        "(`token_parity.rs` の註が名指ししている穴)。",
    );
  }
  rows.push({
    name: "Finance の期間（打鍵ではなく着地に効く）",
    manual: numberInManual(
      manual,
      "Finance の期間（1,200）",
      /Finance の期間[^|]*\|\s*([\d,]+)/g,
    ),
    source: periodsInCore,
    why: "そのまま。盤面とコアの 2 つが一致することも上で確かめている",
  });

  // 「10 億円」は億で書いてある。定数は円。
  const cap = numberInConst(
    closedForm,
    "finance/loan/closed_form.rs",
    "MAX_VERIFIED_MONTHLY_YEN",
  );
  rows.push({
    name: "ローンの返済月額と賞与の答えの上限（億円）",
    manual: numberInManual(
      manual,
      "… 億円まで",
      /返済額の答え[^|]*\|\s*(\d+) 億円まで/g,
    ),
    source: cap / 100_000_000,
    why: `MAX_VERIFIED_MONTHLY_YEN(${cap.toLocaleString("en-US")}) ÷ 1 億`,
  });

  return rows;
}

/**
 * **型の上限の行。** `u64` の上限はソースに数として現れないので、**計算して比べる**。
 * `Number` では精度が落ちて**間違った数と一致してしまう**ので `BigInt` で作る。
 * あわせて **`parse::<u64>` が実在すること**も確かめる——**型が `u128` に変わった日に、
 * この行が赤くなる**ようにするためである(数だけ見ていると、黙って古いまま緑になる)。
 */
export function checkTypeCeiling() {
  const manual = read("docs/manual/detail.ja.md");
  const loanMod = read("crates/calcarc-core/src/finance/loan/mod.rs");

  spellingAppearsOnce(loanMod, "finance/loan/mod.rs", "parse::<u64>");

  const matches = [...manual.matchAll(/計算できる金額の上限は ([\d,]+) 円/g)];
  if (matches.length !== 1) {
    throw new Error(
      `マニュアルの「計算できる金額の上限」が ${matches.length} 件見つかった(1 件であること)。`,
    );
  }
  const written = matches[0][1].replace(/,/g, "");
  const ceiling = (2n ** 64n - 1n).toString();
  if (written !== ceiling) {
    throw new Error(
      `マニュアルの金額の上限 ${written} が u64 の上限 ${ceiling} と違う。`,
    );
  }
  return { written, ceiling };
}

function main() {
  let rows;
  try {
    rows = collectRows();
    checkTypeCeiling();
  } catch (error) {
    console.error(`check:manual-limits NG — ${error.message}`);
    process.exit(1);
  }

  const wrong = rows.filter((row) => row.manual !== row.source);
  if (wrong.length > 0) {
    console.error(
      `check:manual-limits NG — マニュアルの数と製品の数が違う(${wrong.length} 行)`,
    );
    for (const row of wrong) {
      console.error(
        `  ${row.name}: マニュアル ${row.manual} / 製品 ${row.source}(${row.why})`,
      );
    }
    process.exit(1);
  }

  console.log(
    `check:manual-limits OK — 上限 ${rows.length} 行と u64 の上限 1 行が一致`,
  );
}

if (process.argv[1]?.endsWith("check-manual-limits.mjs")) {
  main();
}

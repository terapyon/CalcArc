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

  // **年利は 2 つの経路を持つ**——打った文字列を直接受ける `loan/rate.rs` と、
  // **式として打った年利を評価してから受ける** `expr/mod.rs`（0.9.2 で年利と為替が式を受けるようになった）。
  //
  // **その 2 つが一致することは、ここでは主張しない。**
  // `crates/calcarc-core/src/expr/mod.rs` の **`both_paths_carry_the_same_rate_limits`** が
  // **実際の定数どうしを突き合わせている**（型を跨いで `as i128` / `as u32` で比べる）。
  // **同じ主張を 2 か所に書かない**——書けば、片方だけ直された日に**どちらが正しいか分からなくなる**。
  // だからここは **`loan/rate.rs` の側だけ**を読み、**マニュアルとの結びつけに専念する**。
  const rateRs = read("crates/calcarc-core/src/finance/loan/rate.rs");
  const percentCeiling = numberInConst(
    rateRs,
    "finance/loan/rate.rs",
    "MAX_ANNUAL_PERCENT",
  );
  const percentDecimals = numberInConst(
    rateRs,
    "finance/loan/rate.rs",
    "MAX_PERCENT_DECIMALS",
  );

  rows.push({
    name: "Finance の年利の上限（％）",
    manual: numberInManual(
      manual,
      "Finance の年利（… まで）",
      /Finance の年利[^|]*\|\s*(\d+) まで/g,
    ),
    source: percentCeiling,
    why: "そのまま。式の経路との一致は `both_paths_carry_the_same_rate_limits` が持つ",
  });

  rows.push({
    name: "Finance の年利の小数桁数",
    manual: numberInManual(
      manual,
      "小数点以下は … 桁まで",
      /小数点以下は (\d+) 桁まで/g,
    ),
    source: percentDecimals,
    why: "そのまま。`PERCENT_SCALE` は桁数から導いてあるので、倍率は Rust が保証する",
  });

  // **導き方が要る行。** マニュアルは「**5 桁以上**は答えが出ない」と書く——
  // これは「4 桁までは出る」の裏返しである。**`+ 1` を番人の中に書く。**
  rows.push({
    name: "答えが出なくなる年利の小数桁数",
    manual: numberInManual(
      manual,
      "小数点以下が … 桁以上の年利は、打てても答えは出ません",
      /小数点以下が (\d+) 桁以上の年利は/g,
    ),
    source: percentDecimals + 1,
    why: `MAX_PERCENT_DECIMALS(${percentDecimals}) + 1。「4 桁までは出る」の裏返し`,
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

/** golden から**ちょうど 1 件**を id で取り出す。 */
function goldenCase(cases, id) {
  const found = cases.filter((c) => c.id === id);
  if (found.length !== 1) {
    throw new Error(
      `testdata/finance.json に \`${id}\` が ${found.length} 件見つかった(1 件であること)。` +
        "golden の id が変わったか、この例が消えている。",
    );
  }
  return found[0];
}

/**
 * **マニュアルが読者に見せている賞与の例**（0.9.3 検証側 C-3）。
 *
 * **値の裏づけは参照実装が持ち、この番人は「マニュアルの文」と「golden の数」を結ぶ。**
 * **ここで計算し直さない**——JS で償還を組み直せば、それは 3 つ目の実装になり、
 * **同じ間違いを 2 か所に書く**ことになる（CLAUDE.md「参照実装を Rust の移植にしない」と同じ形）。
 *
 * **差額は 2 つの golden の引き算で出す。** マニュアルは「賞与なしの総支払より 18,279 円多い」と
 * 書いており、**その 2 つの総支払はどちらも golden に在る**。
 */
export function collectWorkedExample() {
  const manual = read("docs/manual/detail.ja.md");
  const cases = JSON.parse(read("testdata/finance.json")).cases;
  const bonus = goldenCase(
    cases,
    "loan_bonus_forward/30000000/6000000/1.5/420",
  );
  const plain = goldenCase(cases, "loan_forward/30000000/1.5/420/0");

  const written = [
    ...manual.matchAll(
      /月々は ([\d,]+) 円、賞与回は ([\d,]+) 円（(\d+) 回）、総支払額は ([\d,]+) 円/g,
    ),
  ];
  if (written.length !== 1) {
    throw new Error(
      `マニュアルの賞与の例が ${written.length} 件見つかった(1 件であること)。` +
        "言い回しが変わったか、この番人の探し方が古い。",
    );
  }
  const diff = [
    ...manual.matchAll(
      /賞与を使わないときの総支払額 ([\d,]+) 円より ([\d,]+) 円多くなります/g,
    ),
  ];
  if (diff.length !== 1) {
    throw new Error(
      `マニュアルの「賞与なしとの差額」が ${diff.length} 件見つかった(1 件であること)。`,
    );
  }

  const n = (s) => Number(s.replace(/,/g, ""));
  const plainTotal = Number(plain.expect.total_payment);
  const bonusTotal = Number(bonus.expect.total_payment);

  /** @type {Row[]} */
  return [
    {
      name: "賞与の例: 月々の返済額",
      manual: n(written[0][1]),
      source: Number(bonus.expect.monthly_payment),
      why: "golden `loan_bonus_forward/30000000/6000000/1.5/420` の `monthly_payment`",
    },
    {
      name: "賞与の例: 賞与回の返済額",
      manual: n(written[0][2]),
      source: Number(bonus.expect.bonus_payment),
      why: "同じ golden の `bonus_payment`",
    },
    {
      name: "賞与の例: 賞与回の回数",
      manual: n(written[0][3]),
      source: bonus.expect.bonus_rows,
      why: "同じ golden の `bonus_rows`",
    },
    {
      name: "賞与の例: 総支払額",
      manual: n(written[0][4]),
      source: bonusTotal,
      why: "同じ golden の `total_payment`",
    },
    {
      name: "賞与の例: 賞与を使わないときの総支払額",
      manual: n(diff[0][1]),
      source: plainTotal,
      why: "golden `loan_forward/30000000/1.5/420/0` の `total_payment`",
    },
    {
      name: "賞与の例: 差額",
      manual: n(diff[0][2]),
      source: bonusTotal - plainTotal,
      why: "**2 つの golden の引き算**（マニュアルはこの差を書いている）",
    },
  ];
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
    rows = [...collectRows(), ...collectWorkedExample()];
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
    `check:manual-limits OK — 上限と worked example ${rows.length} 行、u64 の上限 1 行が一致`,
  );
}

if (process.argv[1]?.endsWith("check-manual-limits.mjs")) {
  main();
}

import { expect, test } from "@playwright/test";
import { openHarness, runAll } from "./harness";

// 表示書式を知るための探り。合否は判定せず、観測結果を出力する。
const PROBES: [string, string[]][] = [
  ["整数", ["3", "eq"]],
  ["2 の平方根", ["2", "sqrt"]],
  ["1 ÷ 3", ["1", "div", "3", "eq"]],
  ["円周率", ["pi"]],
  ["負の数", ["5", "neg"]],
  ["大きい数", ["9", "zeros3", "zeros3", "mul", "9", "zeros3", "zeros3", "eq"]],
  ["小さい数", ["1", "div", "9", "zeros3", "zeros3", "eq"]],
  ["sin 30 度", ["3", "0", "sin"]],
  ["負数の平方根", ["4", "neg", "sqrt"]],
];

test("record how the display formats numbers (observation only, no pass/fail on values)", async ({
  page,
}) => {
  await openHarness(page);
  const results = await runAll(
    page,
    PROBES.map(([, keys]) => keys),
  );
  // 観測そのものが嘘をつかないための最低限の保証: ハーネスが 9 件を返したこと。
  // これ以外は一切合否を判定しない。
  expect(results).toHaveLength(PROBES.length);
  for (const [index, probe] of PROBES.entries()) {
    console.log(`${probe[0]}: ${JSON.stringify(results[index])}`);
  }
});

/**
 * **許容の根拠を、散文ではなく assertion で持つ。**
 *
 * コーパスの `tolerance` は「表示は有効数字 10 桁」という実測から導いている
 * (最下位桁の丸め幅の半分を相対で見ると 5e-11〜5e-10 に収まるので `rel = 5e-10`)。
 * その根拠は `docs/corpus-measurements.md` に**散文で**書いてあった。
 *
 * 散文は腐る。しかもこの層は緑のまま腐る——表示書式が変わっても、コーパスの
 * ケースがたまたま影響を受けなければ誰も気づかない。実際、同文書の
 * 「`sqrt(-4)` の表示は `j2`」は、関数を実数に閉じる変更が入れば事実でなくなる。
 *
 * そこで**再観測できる根拠だけを**ここに移す。表示書式が動いた瞬間にこの test が
 * 赤くなり、「実測し直して `tolerance` を導出し直せ」と言う。相手に何も要求しない
 * ので、変更した側が伝え忘れても働く。
 *
 * ここに移せないもの(「なぜあのケースを上書きしたか」のような物理の説明)は
 * 散文のままである。その線引きは意図的なもので、設計書 §3.6 に書いてある。
 */
const FORMAT_FACTS: [string, string[], string][] = [
  // --- 有効数字 10 桁。tolerance = 5e-10 の直接の根拠。---
  ["無理数は 10 桁", ["2", "sqrt"], "1.414213562"],
  ["循環小数も 10 桁", ["1", "div", "3", "eq"], "0.3333333333"],
  ["円周率も 10 桁", ["pi"], "3.141592654"],

  // --- 指数表記の形。parseDisplay が受け付ける書式そのもの。---
  // 小文字 `e`、`+` を付けない、桁区切りを入れない。
  [
    "指数は小文字 e で + を付けない",
    ["9", "zeros3", "zeros3", "mul", "9", "zeros3", "zeros3", "eq"],
    "8.1e13",
  ],

  // --- 平坦表示と指数表記の境界。**両側に置く。** ---
  // 片側だけだと閾値がずれても通ってしまう。
  //
  // **必ず eq を押して「計算結果」にする。** 入力中の表示は別の規則で、
  // 1e10 を打ち込むと平坦な "10000000000" が出る(2026-08-16 実測)。
  // ここで測りたいのは結果の整形であって、入力バッファではない。
  // **2026-08-16 の main 取り込みでカンマが入った**(`group_integer_part`)。
  // この行はそれを捕まえて赤くなった——書式が動いたことを知らせる仕掛けが
  // 実際に働いた 2 例目である。整数部だけが 3 桁ごとに区切られる。
  [
    "上端の手前は平坦（3 桁区切りつき）",
    ["9", "9", "9", "9", "9", "9", "9", "9", "9", "9", "eq"],
    "9,999,999,999",
  ],
  [
    "上端ちょうどで指数へ",
    ["1", "zeros3", "zeros3", "mul", "1", "zeros3", "0", "eq"],
    "1e10",
  ],
  [
    "下端ちょうどは平坦",
    ["1", "div", "1", "zeros3", "zeros3", "zeros3", "eq"],
    "0.000000001",
  ],
  [
    "下端の下で指数へ",
    ["1", "div", "1", "zeros3", "zeros3", "zeros3", "0", "eq"],
    "1e-10",
  ],

  // --- 負号と、素の整数。---
  ["負号は ASCII のハイフン", ["5", "neg"], "-5"],
  ["割り切れる値は素で出る", ["3", "0", "sin"], "0.5"],
];

test("the display format the tolerance was derived from has not moved", async ({
  page,
}) => {
  await openHarness(page);
  const results = await runAll(
    page,
    FORMAT_FACTS.map(([, keys]) => keys),
  );

  const drifted: string[] = [];
  for (const [index, [label, keys, expected]] of FORMAT_FACTS.entries()) {
    const actual = results[index];
    if (actual === undefined) {
      drifted.push(`${label}: ハーネスが結果を返さなかった`);
      continue;
    }
    if (actual.error !== null) {
      drifted.push(`${label}: error ${actual.error}（${keys.join(" ")}）`);
      continue;
    }
    if (actual.main !== expected) {
      drifted.push(
        `${label}: "${actual.main}" だが "${expected}" のはず（${keys.join(" ")}）`,
      );
    }
  }

  expect(
    drifted.join("\n"),
    "表示書式が動いた。コーパスの tolerance はこの書式から導いているので、" +
      "docs/corpus-measurements.md を実測し直し、rel を導出し直すこと。" +
      "この test を新しい値に合わせて黙らせるだけでは、許容の根拠が嘘になる。",
  ).toBe("");
});

/**
 * **これは今この瞬間の事実であって、守りたい性質ではない。**
 *
 * 生成器は負数の平方根を `OutOfShard` で範囲外にしている。**範囲外である
 * ことは一度も変わっていないが、その理由は 2026-08-16 に変わった。**
 *
 * かつての理由: 表示が `j2`(複素表記)で、`parseDisplay` が読まないから。
 * いまの理由: engine が `DomainError` を返すエラー経路だから。
 *
 * **この test は予告どおり赤くなり、記録を更新させた。** 仕掛けとして機能した
 * 実例なので、消さずに新しい実測値で置き直してある。次に変わったときも同じく
 * 赤くなり、そのときも**記録を更新するのが正しい対応**である。
 *
 * 実測(2026-08-16、main 取り込み後): `4 neg sqrt` → `Math ERROR` / `DomainError`。
 */
test("the recorded reason for excluding sqrt of a negative still holds", async ({
  page,
}) => {
  await openHarness(page);
  const [result] = await runAll(page, [["4", "neg", "sqrt"]]);

  expect(
    result,
    "sqrt(-4) の表示が変わった。docs/corpus-measurements.md と設計書 §11 が " +
      "記録している除外理由を、実態に合わせて更新すること" +
      "（範囲外であること自体は変わらないはず）。",
  ).toEqual({ main: "Math ERROR", error: "DomainError" });
});

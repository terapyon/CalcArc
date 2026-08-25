#!/usr/bin/env node
/**
 * **0.3.0 の 3 計算(単位換算・LLM メモリ・データ転送量)の検出力を測る。**
 *
 * `detection-power.mjs` は生成コーパスのシャードが反応したかを見るが、
 * この 3 つには**生成コーパスが無い**(実測 2026-08-20: 18 枚のシャードに
 * convert・llm・transfer は 1 枚も無い)。代わりに `cargo test` を走らせ、
 * **赤くなったテストの名前の集合**を期待と突き合わせる。
 *
 * **変異を当てて戻す手続きは写さない**——`detection-power.mjs` の
 * `runOneMutation` に判定を注入して使う(戻し忘れの経路を 2 つにしない)。
 * このファイルは「測り方」と「判定」だけを持つ。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exitCodeFrom, runOneMutation } from "./detection-power.mjs";

const HEAVY = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * リポジトリの根。**変異表のテストが `from` の実在を確かめるのに要る**
 * ので export している——テスト側で根を組み立て直すと、`vitest` の
 * `import.meta.url` が file URL でないために解けない(実測)。
 */
export const ROOT = dirname(HEAVY);
const OUT = join(HEAVY, "exact-power.json");

/**
 * 1 件の変異。`detection-power.mjs` の `MUTATIONS` と同じ 5 項目に、
 * 期待をシャード名でなく**テスト名**で書く `expectTests` を足したもの。
 *
 * @typedef {{
 *   id: string,
 *   what: string,
 *   file: string,
 *   from: string,
 *   to: string,
 *   expectTests: string[],
 * }} ExactMutation
 */

/**
 * `cargo test` 1 回ぶんの測定。
 *
 * **`buildOk` と `failed` を別々に持つ。** ビルドが失敗すると 1 本も
 * 走らないので `failed` は空になり、「捕まえられなかった」と見分けが
 * つかなくなる(`detection-power.mjs` §4.2 が名指しで禁じた形)。
 *
 * @typedef {{ buildOk: boolean, exitCode: number | null, failed: string[] }} CargoMeasurement
 */

/** @typedef {{ ok: boolean, kind: string, why: string }} Verdict */

/**
 * `cargo test` が 1 テストごとに出す `test <名前> ... FAILED` を拾う。
 *
 * **要約行(`test result: FAILED. 25 passed; 2 failed`)を拾わない。**
 * 拾うと赤の件数が毎回 1 多くなり、1 本も赤くならなかった走行が
 * 「1 本捕まえた」に化ける。要約行を外しているのは ` ... ` の区切りで、
 * 要約行にはこれが無い——**行全体を `test <名前> ... FAILED` の形に
 * 合わせる**(前後に何も許さない)ことが、その見分けを持っている。
 *
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseFailedTests(stdout) {
  const failed = [];
  for (const line of stdout.split("\n")) {
    const match = /^test (.+) \.\.\. FAILED$/.exec(line.trim());
    if (match) failed.push(match[1]);
  }
  return failed;
}

/**
 * 走行の生の結果を測定に畳む。
 *
 * @param {{ buildOk: boolean, exitCode: number | null, stdout: string }} raw
 * @returns {CargoMeasurement}
 */
export function readCargoMeasurement({ buildOk, exitCode, stdout }) {
  return { buildOk, exitCode, failed: buildOk ? parseFailedTests(stdout) : [] };
}

/**
 * **両側を主張する。** 期待したテストが赤いこと**と**、期待していない
 * テストが緑のままであること。片側だけだと「何かが赤い」で通り、
 * **どの層が捕まえたか**の地図が描けない(`verdictFor` の `sameSet` と
 * 同じ厳しさ)。
 *
 * @param {ExactMutation} mutation
 * @param {CargoMeasurement} m
 * @returns {Verdict}
 */
export function verdictForTests(mutation, m) {
  /** @type {(kind: string, why: string) => Verdict} */
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) {
    return fail("measurement-failed", "cargo がビルドできなかった——検出の有無は測れていない");
  }
  if (m.exitCode === null) return fail("measurement-failed", "cargo を起動できなかった");
  const expected = mutation.expectTests;
  const missing = expected.filter((name) => !m.failed.includes(name));
  const extra = m.failed.filter((name) => !expected.includes(name));
  // **「1 本も赤くならなかった」を別の名前で残す。** 変異が届いていない
  // のと、届いたが別の場所を壊したのとでは、次にやることが違う。
  if (missing.length > 0 && m.failed.length === 0) {
    return fail("caught-nothing", `1 本も赤くならなかった(期待: ${expected.join(", ")})`);
  }
  if (extra.length > 0) {
    return fail("unexpected-red", `期待していないテストが赤い: ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    return fail("missed", `期待したテストが緑のまま: ${missing.join(", ")}`);
  }
  // `missing` も `extra` も空、すなわち**集合として一致している**。
  // 両側を主張した結果として、ここに来られるのはその場合だけである。
  return { ok: true, kind: "ok", why: `期待どおり ${m.failed.length} 本が赤くなった` };
}

/**
 * 変異を当てた状態で `cargo test` を走らせる。**wasm も playwright も
 * 要らない**(変異は Rust に当てるので、Rust の検査で足りる。計画の裁定 2)。
 *
 * `--no-fail-fast` は**全部のテストを最後まで走らせる**ため。既定では
 * 最初に赤くなったクレートで止まり、**別のクレートが同じ変異を捕まえて
 * いたかどうかが測れない**——それがまさに知りたいことである。
 *
 * @returns {CargoMeasurement}
 */
export function measureCargo() {
  try {
    const stdout = execFileSync("cargo", ["test", "--workspace", "--no-fail-fast"], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readCargoMeasurement({ buildOk: true, exitCode: 0, stdout });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    // **ビルド失敗と「テストが赤い」を混ぜない。** ビルドが失敗すると
    // 1 本も走らないので、`failed` が空になり「捕まえられなかった」に
    // 見える。1 本でも走った証拠(`running N tests` か要約行)を
    // stdout に見つけられたときだけ「ビルドは通った」と読む。
    const buildOk = stdout.includes("running ") || stdout.includes("test result:");
    return readCargoMeasurement({ buildOk, exitCode: exitCodeFrom(error), stdout });
  }
}

/**
 * **0.3.0 の 3 計算に効く欠陥を 6 種**。spec §5 の分類(係数・オフセット・
 * 基数・丸め・合成)を 1 つずつ踏む。
 *
 * **`expectTests` は実測で埋めた。** 先に期待を書いて実測を合わせると、
 * 「期待どおり」が「自分の推測どおり」になる。空で 1 度走らせ、
 * **実際に赤くなった名前**をそのまま書き入れてある(2026-08-20 の実測。
 * 判定と赤の内訳は `docs/corpus-measurements.md`)。
 *
 * @type {ExactMutation[]}
 */
export const EXACT_MUTATIONS = [
  {
    id: "binary-base-is-decimal",
    what: "2 進の基数を単位表から導かず 1000 に固定する",
    file: "crates/calcarc-core/src/data_scale/format.rs",
    // **製品コードに `1024` の literal は無い**(実測: doc コメントと
    // テストにしか出ない)。基数は `units[0]` から導いている——だから
    // 壊すのは導出のほうである。
    from: "let base = units[0].1;",
    to: "let base = 1000;",
    expectTests: [
      // **Task 4 で足した単体テスト。** 基数の取り違えが見えるのは
      // 整数部が 1000 以上 1024 未満に収まる 2 進の値だけで、それまで
      // `format.rs` の 8 本はどれもその帯を通っていなかった。
      "data_scale::format::tests::the_binary_base_is_ten_twenty_four_not_a_thousand",
      "data_scale_matches_the_reference",
    ],
  },
  {
    id: "degf-offset-dropped",
    what: "華氏のオフセット(459.67 × 5/9)を落とす",
    file: "crates/calcarc-core/src/convert/mod.rs",
    // アフィン変換の平行移動。比だけの単位では起きない壊れ方(spec §5)。
    from: "Rational::from_ratio(45967, 180)?",
    to: "zero",
    expectTests: [
      "convert::tests::minus_forty_is_the_fixed_point_of_the_two_scales",
      "convert::tests::the_offsets_check_out",
      "convert_matches_the_reference",
    ],
  },
  {
    id: "micrometre-off-by-thousand",
    what: "um の係数を 1/1,000,000 から 1/1,000 にずらす",
    file: "crates/calcarc-core/src/convert/mod.rs",
    // **Step 0 の実測**: `convert/mod.rs` の `mod tests`(:535 以降)に
    // `Unit::Um` は 1 度も出てこない——係数を literal で固定している
    // 単体テストは同居していないので、この変異は上の層まで届く。
    from: "Unit::Um => (Rational::from_ratio(1, 1_000_000)?, zero)",
    to: "Unit::Um => (Rational::from_ratio(1, 1_000)?, zero)",
    expectTests: [
      "convert_matches_the_reference",
    ],
  },
  {
    id: "half-even-becomes-half-up",
    what: "表示の丸めを half-even から half-up に変える",
    file: "crates/calcarc-core/src/convert/format.rs",
    from: "core::cmp::Ordering::Equal => last_is_odd,",
    to: "core::cmp::Ordering::Equal => true,",
    expectTests: [
      "convert::format::tests::half_to_even_rounds_toward_the_even_digit",
      "convert_matches_the_reference",
    ],
  },
  {
    id: "kv-counts-once-not-twice",
    what: "KV キャッシュの 2 倍(K と V)を 1 倍にする",
    file: "crates/calcarc-core/src/data_scale/llm.rs",
    from: "let mut kv_bits = 2u128;",
    to: "let mut kv_bits = 1u128;",
    expectTests: [
      "data_scale::llm::tests::overflow_is_an_error_not_a_wrap",
      "data_scale::llm::tests::kv_heads_is_not_the_attention_head_count",
      "data_scale::llm::tests::the_headline_case",
      "data_scale::llm::tests::the_kv_side_never_needs_the_ceiling",
      "llm_matches_the_reference",
    ],
  },
  {
    id: "partial-byte-truncated",
    what: "ビットからバイトへの端数を切り上げでなく切り捨てにする",
    file: "crates/calcarc-core/src/data_scale/transfer.rs",
    from: "Ok(bits.div_ceil(8))",
    to: "Ok(bits / 8)",
    expectTests: [
      "data_scale::transfer::tests::a_partial_byte_rounds_up",
      "transfer_matches_the_reference",
    ],
  },
  // ---- 0.3.1 の通貨換算に効く欠陥を 4 種(2026-08-25 に追加) ----
  //
  // **`currency.rs` の `mod tests` は密である。** 意味論の大半を同じ
  // ファイルの 14 本が literal で固定しているので、**minor unit の表を
  // 壊す変異は使わない**——`the_minor_units_match_the_spec` が表そのものを
  // literal で持っており、測れるのはその 1 本だけになる。**壊すのは合成の
  // ほう**である(換算の向き・判定の順序・丸めの tie・符号)。
  {
    id: "cross-rate-inverted",
    what: "クロスレートの向きを取り違える(to と from を入れ替える)",
    file: "crates/calcarc-core/src/convert/currency.rs",
    // 基準通貨を経由する合成そのもの。係数表には 1 文字も触らない。
    from: "value.checked_mul(to_rate)?.checked_div(from_rate)",
    to: "value.checked_mul(from_rate)?.checked_div(to_rate)",
    // **実測 2026-08-25。先に書いて実測を合わせたのではない**——空の
    // `expectTests` で 1 度走らせ、赤くなった名前をそのまま写した。
    // **2 層が見張っている**: 同居する単体テスト 4 本と golden 1 本。
    expectTests: [
      "convert::currency::tests::a_rate_of_zero_is_an_error_not_a_division",
      "convert::currency::tests::the_conversion_goes_through_the_base_currency",
      "convert::currency::tests::the_entry_point_takes_strings_and_never_sees_an_f64",
      "convert::currency::tests::the_tie_that_tells_f64_from_an_exact_rational",
      "currency_matches_the_reference",
    ],
  },
  {
    id: "zero-check-after-multiply",
    what: "ゼロ判定を掛け算の後ろへ動かす(Overflow が DivisionByZero を隠す)",
    file: "crates/calcarc-core/src/convert/currency.rs",
    // **`exchange` の doc コメントが理由を宣言している変異である。**
    // 「0 の判定を掛け算より先に置くのは、`value × to_rate` があふれる組で
    // `Overflow` が `DivisionByZero` を隠さないようにするためである」——
    // **その理由が検査されているかどうかを、この変異が測る。**
    from: [
      "    if from_rate.is_zero() {",
      "        return Err(CalcError::DivisionByZero);",
      "    }",
      "    value.checked_mul(to_rate)?.checked_div(from_rate)",
    ].join("\n"),
    to: [
      "    let scaled = value.checked_mul(to_rate)?;",
      "    if from_rate.is_zero() {",
      "        return Err(CalcError::DivisionByZero);",
      "    }",
      "    scaled.checked_div(from_rate)",
    ].join("\n"),
    // **1 度目の実測(2026-08-25)は赤 0 本だった。** 宣言された理由を誰も
    // 検査していなかった——`value × to_rate` があふれる組で `from_rate` が 0、
    // という組が既存 390 本のどこにも無い(rationales-rot-silently)。
    //
    // **この暗い帯にだけ 2 本足した**(`convert/currency.rs` の `mod tests`)。
    // **golden では言えない**——参照実装の `Fraction` は多倍長で `Overflow` を
    // 持たないので、`testdata/currency.json` に Overflow のケースは 1 件も無い。
    // だから 2 層にはならず、**core の単体テスト 1 層だけ**である。
    expectTests: [
      "convert::currency::tests::a_zero_rate_is_named_even_when_the_product_overflows",
      "convert::currency::tests::the_entry_point_names_the_zero_rate_before_it_multiplies",
    ],
  },
  {
    id: "currency-half-even-becomes-half-up",
    what: "金額の丸めを half-even から half-up に変える",
    file: "crates/calcarc-core/src/convert/currency.rs",
    // `convert/format.rs` の同型の変異(`half-even-becomes-half-up`)とは
    // **別の実装**である——裁定 2 が共有すると言っているのは規則であって
    // コードではないので、丸めの tie は 2 か所に別々に書かれている。
    from: "core::cmp::Ordering::Equal => !units.is_multiple_of(2),",
    to: "core::cmp::Ordering::Equal => true,",
    // **実測 2026-08-25。** `convert/format.rs` 側の同型の変異と同じく 2 層。
    expectTests: [
      "convert::currency::tests::rounding_is_half_to_even",
      "currency_matches_the_reference",
    ],
  },
  {
    id: "rounded-zero-keeps-its-sign",
    what: "丸めて 0 になった額に負号を残す(`-0.00` を出す)",
    file: "crates/calcarc-core/src/convert/currency.rs",
    // 値は 1 ビットも変わらない。表示の符号だけが変わる。
    from: 'let sign = if negative && units != 0 { "-" } else { "" };',
    to: 'let sign = if negative { "-" } else { "" };',
    // **実測 2026-08-25。** golden にも 1 件(`currency/-0.001usdtousd@…`)
    // 置いてあるので 2 層で見張られている。
    expectTests: [
      "convert::currency::tests::a_rounded_zero_has_no_sign",
      "currency_matches_the_reference",
    ],
  },
];

/**
 * 6 種を順に当てて測り、判定を `web/exact-power.json` に書く。
 *
 * **変異を当てて戻すのは `runOneMutation` に任せる**(戻し忘れの経路を
 * 2 つにしない)。ここが差し替えるのは**測り先**(`measureCargo`)と
 * **判定**(`verdictForTests`)だけである。
 *
 * **`pnpm wasm` は回さない。** `detection-power.mjs` の `main()` は
 * 最後に wasm を作り直すが、それは playwright で測るからで、こちらは
 * `cargo test` しか回さない——`web/src/wasm/` に変異が入る経路が無い。
 */
function main() {
  const results = [];
  for (const mutation of EXACT_MUTATIONS) {
    process.stderr.write(`[${mutation.id}] ${mutation.what} ... `);
    const result = runOneMutation(mutation, {
      measure: measureCargo,
      verdict: verdictForTests,
    });
    process.stderr.write(`${result.ok ? "ok" : result.kind}\n`);
    results.push(result);
  }
  writeFileSync(OUT, `${JSON.stringify({ results }, null, 2)}\n`);
  for (const result of results) {
    console.log(`[${result.id}] ${result.ok ? "ok" : result.kind} — ${result.why}`);
  }
  console.error(`exact-power: wrote ${OUT}`);
  const bad = results.filter((result) => !result.ok);
  // **暗い帯は失敗ではない。** それでも非ゼロで終えるのは、`ok` でない
  // 判定を黙って通さないため——記録は JSON に残る。
  process.exitCode = bad.length === 0 ? 0 : 1;
}

// **import されたときは走らない。** テストがこのファイルを読むだけで
// 変異が始まっては困る。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

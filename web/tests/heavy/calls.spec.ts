import { expect, test } from "@playwright/test";
import { type CallCase, loadCallShards } from "./corpus";
import { openHarness } from "./harness";
import { record, summaryName } from "./report";

/**
 * 金融とデータスケールの照合(設計書 2026-08-17)。
 *
 * **科学計算とは比較の仕方が違う。** あちらは表示 10 桁を相対許容で見るが、
 * こちらは**円とバイト数の整数**なので厳密一致で比べる。1 円違えば違うと言える。
 *
 * 期待値は `compound_ref` / `loan_ref` / `data_scale_ref` が Python の
 * 任意精度整数と `Decimal` で出したもの。Rust は f64 と u64 で計算しており、
 * **アルゴリズムを共有していない。**
 */

/** 1 束あたりのケース数。往復のコストが計算のコストを覆わない大きさにする。 */
const BATCH = 500;

/**
 * wasm 側のキーを参照側の綴りに寄せる。
 *
 * **wasm は camelCase、参照実装は snake_case** である(`monthlyPayment` と
 * `monthly_payment`)。設計書 2026-08-17 §6 が予告したとおりで、**寄せるのは
 * こちら側**——参照実装を Rust に合わせて書き換えると、独立していることが
 * 検証の土台なのにその土台を崩す。
 *
 * `error: null` も落とす。wasm は成功時も `error` を `null` で持つが、
 * 参照実装は成功時にキーごと出さない。**「エラーが無い」という同じ事実の
 * 2 通りの書き方**であって、食い違いではない。
 */
/**
 * camelCase を超える綴りの違い。**wasm 側の名前 → 参照側の名前。**
 * 増やすときは、なぜ違うのかを 1 行添えること。
 */
const RENAMES: Record<string, string> = {
  // `loan_term` が返す期間。wasm は `months`、参照は `n`(入力と同じ名前)。
  months: "n",
};

function normalise(got: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(got)) {
    if (key === "error" && value === null) {
      continue;
    }
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[RENAMES[snake] ?? snake] = value;
  }
  return out;
}

/**
 * wasm が返した構造体と、参照実装が出した辞書を突き合わせる。
 *
 * **キーの集合も比べる。** 値だけ比べると、片方にしか無いキーを見逃す——
 * wasm が `total_interest` を返さなくなっても、残りが合っていれば緑になる。
 */
function differences(
  actual: unknown,
  expected: Record<string, unknown>,
  input: Record<string, string | number | boolean>,
): string[] {
  if (actual === null || typeof actual !== "object") {
    return [`wasm returned ${JSON.stringify(actual)}, not an object`];
  }
  const got = normalise(actual as Record<string, unknown>);
  const keys = new Set([...Object.keys(got), ...Object.keys(expected)]);
  const out: string[] = [];
  for (const key of [...keys].sort()) {
    const a = got[key];
    const e = expected[key];
    // **エラー時、wasm は値の欄を `null` で埋め、参照はキーごと出さない。**
    // 同じ事実の 2 通りの書き方なので、食い違いにしない。
    //
    // **ただし「wasm が null で、参照には値がある」は本物の食い違いである**
    // ——計算できたはずのものを計算できなかった、という意味なので、
    // ここで握りつぶすと判定がいちばん重い嘘をつく。
    if (a === null && !(key in expected)) {
      continue;
    }
    // **wasm は入力の一部を結果に含めて返す**(`compound_deposit_for` が
    // `periods` を、`compound_periods_for` が `deposit` を)。参照実装は
    // 出さない。返ってきた値が**入力そのもの**なら情報は増えていないので
    // 食い違いにしない。
    //
    // **違う値をエコーしていたら食い違いとして報告する**——入力を歪めて
    // 返しているという意味であり、それは黙って通してよいものではない。
    if (
      !(key in expected) &&
      key in input &&
      String(a) === String(input[key])
    ) {
      continue;
    }
    // JSON の数と文字列を混ぜない。参照側は金額を文字列で持つので、
    // wasm が数で返していたら**それ自体が食い違い**である。
    if (JSON.stringify(a) !== JSON.stringify(e)) {
      out.push(`${key}: ${JSON.stringify(a)} ≠ ${JSON.stringify(e)}`);
    }
  }
  return out;
}

for (const { name, shard } of loadCallShards()) {
  test(`every call in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    const cases = shard.cases;
    const mismatches: string[] = [];

    for (let start = 0; start < cases.length; start += BATCH) {
      const batch = cases.slice(start, start + BATCH);
      const results = await page.evaluate(
        (input: { op: string; input: Record<string, unknown> }[]) => {
          const harness = window.__calcarc;
          if (harness === undefined) {
            throw new Error("harness is not on the page");
          }
          return harness.runCalls(input as never);
        },
        batch.map((c: CallCase) => ({ op: c.op, input: c.input })),
      );
      batch.forEach((testCase: CallCase, index: number) => {
        const diff = differences(
          results[index],
          testCase.expect,
          testCase.input,
        );
        if (diff.length > 0) {
          mismatches.push(
            `${testCase.id} (${testCase.op} ${JSON.stringify(testCase.input)}): ` +
              diff.join("; "),
          );
        }
      });
    }

    // **expect より先に記録する。** 落ちたときこそ報告書が要る。
    record({
      name: summaryName(name, "calls"),
      total: cases.length,
      values: cases.length,
      equivalences: 0,
      generatedBy: shard.generated_by,
      mismatches,
      // 整数の厳密一致なので、誤差という概念が無い。**0 は「測っていない」では
      // なく「ずれが存在しない」**である。
      maxRelativeError: 0,
      maxAbsoluteError: 0,
      appliedOverrides: [],
      relUndefinedCases: [],
      relMeasured: 0,
      relUndefinedNonZeroAbs: 0,
      looserThanDisplay: 0,
      precedenceCases: 0,
      exponentDisplayCases: 0,
      worstEffectiveRelTolerance: 0,
      bands: {
        display: cases.length,
        "1e-9": 0,
        "1e-7": 0,
        "1e-5": 0,
        worse: 0,
        undefined: 0,
      },
      shape: { sequences: cases.length, tokens: {}, depths: {} },
      magnitudes: { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0 },
      tolerance: { abs: 0, rel: 0 },
    });

    expect(
      mismatches,
      `${name}: ${mismatches.length} of ${cases.length} calls disagreed with ` +
        "the reference implementation. These are exact integer comparisons — " +
        "a difference is a difference, not a rounding artefact.",
    ).toEqual([]);
  });
}

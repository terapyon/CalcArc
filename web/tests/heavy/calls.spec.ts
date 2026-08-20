import { expect, test } from "@playwright/test";
import { describe, differences } from "./calls";
import {
  compoundDepositForProbes,
  compoundPeriodsForProbes,
  countDegenerateLoanPrincipalCases,
  loanPrincipalProbes,
  loanTermProbes,
  type Probe,
  runProbes,
} from "./certificates";
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
 * 期待値として持っているエラー種別ごとの件数。
 *
 * `expect.error` を読む——**`"error" in expect` を数えるだけでは種別が消える**。
 * 電卓の表示はどの種別でも同じ `Math ERROR` なので、種別を落とした集計からは
 * 種別の取り違えが二度と見えない。
 */
function countErrorKinds(cases: CallCase[]): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const testCase of cases) {
    const error = testCase.expect.error;
    if (typeof error === "string") {
      kinds[error] = (kinds[error] ?? 0) + 1;
    }
  }
  return kinds;
}

const SHARDS = loadCallShards();

for (const { name, shard } of SHARDS) {
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
              describe(diff),
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
      // **エラーを期待値として持つケースを、種別ごとに数える。** 金融と
      // データスケールは入力の検証が仕事の一部なので、エラーになること自体が
      // 仕様である。**合計ではなく種別で渡す**——報告書は「金融の
      // `SyntaxError`」と「金融の `Overflow`」を別の経路として出すので、
      // ここで畳むと片方が 0 件でも読み手に分からない。
      errorKinds: countErrorKinds(cases),
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

/**
 * 逆算証明書(設計書 2026-08-19 §4.10)。
 *
 * 上のループは「答が参照実装と同じ値である」ことを見る。ここでは
 * **その答が境界そのものであること**を、`loan_forward` / `compound_grow`
 * の正算だけを使って heavy ハーネス経由で確かめる。詳しくは `certificates.ts`
 * のコメントを見よ。
 *
 * 必要期間の証明書だけが n 回(答の期数ぶん)の呼び出しになる。既存の
 * `BATCH`(500)より大きな束で流す——束の数がそのまま往復の回数になる。
 */
const CERT_BATCH = 5000;

const FINANCE_SHARD = SHARDS.find(({ name }) => name === "finance-000.json");
if (FINANCE_SHARD === undefined) {
  throw new Error(
    "calls.spec.ts: finance-000.json is not among the call shards — the " +
      "inverse certificates have nothing to certify.",
  );
}
const FINANCE_CASES = FINANCE_SHARD.shard.cases;

const CERTIFICATES: { op: string; build: (cases: CallCase[]) => Probe[] }[] = [
  { op: "loan_principal", build: loanPrincipalProbes },
  { op: "loan_term", build: loanTermProbes },
  { op: "compound_deposit_for", build: compoundDepositForProbes },
  { op: "compound_periods_for", build: compoundPeriodsForProbes },
];

for (const { op, build } of CERTIFICATES) {
  test(`${op}'s answer is the boundary, not just a number`, async ({
    page,
  }) => {
    await openHarness(page);
    const probes = build(FINANCE_CASES);
    expect(
      probes.length,
      `${op}: built zero boundary checks — either the corpus has no normal ` +
        `${op} cases, or the certificate is not wired up`,
    ).toBeGreaterThan(0);

    const mismatches = await runProbes(page, probes, CERT_BATCH);

    expect(
      mismatches,
      `${op}: ${mismatches.length} of ${probes.length} boundary checks ` +
        "failed. Each line says which case, and which side of the boundary " +
        "(the answer itself, or one step past it), broke.",
    ).toEqual([]);
  });
}

test("loan_principal's degenerate answers are counted, not silently dropped", () => {
  // `loan_forward` は「n 期を使い切る」前提の月額しか計算できない。予算に
  // 余裕があって n 期より早く払い終わる(縮退)答は、`loan_forward` では
  // 再現できず、境界証明書から除かれる(`certificates.ts` の
  // `isDegenerateLoanPrincipal` のコメントに実例がある)。**その除外を
  // 黙って通さない。** 件数を毎回言わせ、全数除外(証明書が何も見ていない)
  // になっていないことを確かめる。
  const total = FINANCE_CASES.filter(
    (c) => c.op === "loan_principal" && !("error" in c.expect),
  ).length;
  const excluded = countDegenerateLoanPrincipalCases(FINANCE_CASES);
  console.log(
    `loan_principal: ${excluded} of ${total} normal cases are degenerate ` +
      "(rows_paid < n) and excluded from the boundary certificate.",
  );
  // **実測値を焼き付ける。** 「全数除外でないこと」だけを見ても、17 件が
  // 400 件に増えた走行が緑で通り、証明書が覆う範囲が黙って縮む。除外は
  // 証明書の穴なので、穴の大きさが動いたら気づけなければならない。
  //
  // ここが赤くなったときに直す先はこの数字ではなく、まず
  // `docs/corpus-measurements.md` の「Heavy の逆算証明書」の記録である
  // ——何件が境界の証明を持たないかは、外の読み手に対する主張の一部。
  expect({ total, excluded }).toEqual({ total: 432, excluded: 17 });
});

import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/calc/types";
import type { LoanBonusForwardResult } from "../../src/finance/loan/types";

/**
 * **無効な状態を表現できない**ことを型に言わせる(設計書 §0)。
 *
 * ここが主張するのは「両方の枝が実際に書ける」ことだけである
 * ——「`kind` を見ずに payload を読むコードが書けない」のは**型が保証する**ので、
 * 実行時のテストで主張するものではない(設計書 §8)。
 */
describe("Outcome", () => {
  it("成功の枝では payload が必ず在る", () => {
    const r: LoanBonusForwardResult = {
      kind: "ok",
      monthlyPayment: "85000",
      bonusPayment: "120000",
      bonusRows: 40,
      totalPayment: "36000000",
      totalInterest: "6000000",
      monthlyFinalPayment: "84999",
      bonusFinalPayment: "119998",
    };
    if (r.kind !== "ok") throw new Error("unreachable");
    // **`| null` が無いので、ここで null チェックが要らない。**
    expect(r.monthlyPayment.length).toBeGreaterThan(0);
  });

  it("失敗の枝には payload が無い", () => {
    const r: LoanBonusForwardResult = { kind: "error", code: "Overflow" };
    expect(r.kind).toBe("error");
  });

  it("成功に error は混ざらない", () => {
    const bad: Outcome<{ text: string }, "Overflow"> = {
      kind: "ok",
      text: "1",
      // **印は宣言の上ではなくこの行に置く。** TS は余分なプロパティを
      // **そのプロパティの行**で報告するので、宣言に付けると
      // `Unused '@ts-expect-error' directive` で落ちる(実測)。
      // @ts-expect-error 成功の枝に code は無い
      code: "Overflow",
    };
    expect(bad).toBeDefined();
  });
});

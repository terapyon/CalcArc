// エラー分類の共有は境界違反ではない: 設計書 §9 が「エラー分類(CalcError)」を
// モジュール間の共有項目として明示している。import するのは型だけで、値も
// ロジックも持ち込まない。narrowing の根拠は compound の WASM 境界がこの 2 つ
// しか返さないこと(calcarc-core の Overflow/SyntaxError)。**Rust 側はこれを
// 保証していない**ので、`crates/calcarc-wasm/tests/boundary_shape.rs` が
// 実測で見張っている(設計書 §5)。
import type { CalcErrorCode, Outcome } from "../calc/types";

export type CompoundErrorCode = Extract<
  CalcErrorCode,
  "Overflow" | "SyntaxError"
>;

/** 複利の周期。年・半年・月だけを持つ(numerical-policy)。 */
export const PERIODS_PER_YEAR = [1, 2, 12] as const;

export type PeriodsPerYear = (typeof PERIODS_PER_YEAR)[number];

/**
 * 複利・積立の結果。金額はすべて文字列 —— 円は JS の number を超えうる。
 *
 * 税の 3 項目は、税を求めなかったとき `null` になる。**既定はタックス
 * フリー**(NISA 前提。設計書 §6)。この `| null` は**失敗を潰すためのもの
 * ではなく、本当に任意である**——だから Outcome 化しても残る(設計書 §3)。
 */
export type CompoundResult = Outcome<
  {
    /** 満期の残高(元利合計)。 */
    finalBalance: string;
    /** 自分で入れた合計(元本 + 積立額×期数)。 */
    principalTotal: string;
    /** 運用で増えたぶん。 */
    interest: string;
    nationalTax: string | null;
    localTax: string | null;
    /** 税引後の受取額。 */
    net: string | null;
  },
  CompoundErrorCode
>;

/**
 * 逆算の結果。**答(`deposit` か `periods`)と、その答における全体像**。
 *
 * 税の 3 項目が `null` になる条件は `CompoundResult` と同じ(税を求めなかったとき)。
 */
export type CompoundInverseResult = Outcome<
  {
    /** 必要積立額。必要年数を求めたときは入力そのまま。 */
    deposit: string;
    /** 必要期数。必要積立額を求めたときは入力そのまま。 */
    periods: string;
    finalBalance: string;
    principalTotal: string;
    interest: string;
    nationalTax: string | null;
    localTax: string | null;
    net: string | null;
  },
  CompoundErrorCode
>;

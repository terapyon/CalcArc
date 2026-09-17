/**
 * Convert の値の入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——桁数の上限——を束ねるだけである。
 *
 * **値は式で打てる**(spec §4.3)。`5*12` と打って `in` を選べば `60 in` で
 * あり、演算子と括弧はそのまま再輸出する。
 *
 * **単位トークン(`pushUnit` / `canPushUnit`)は再輸出しない。** Finance の
 * `億` `万` や Data Scale の `G` `M` `K` は入力の途中に混ざる接尾辞だが、
 * Convert の単位は**入力とは別の面で選ぶ**(spec §4.1 の「変換元」「変換先」)。
 * 使わない口を開けておくと、盤面がどちらの流儀か読んだ人に分からなくなる。
 */
import * as units from "../units/entry";

export type { Entry, Operator, Token } from "../units/entry";
export {
  backspace,
  canPushCloseParen,
  canPushOpenParen,
  canPushOperator,
  EMPTY,
  fromDigits,
  grouped,
  hasOperator,
  isEmpty,
  openDepth,
  pushCloseParen,
  pushOpenParen,
  pushOperator,
  text,
} from "../units/entry";

/**
 * 値は `Rational`(i128 有界)へ載る。`i128::MAX` は 10 進 39 桁なので、
 * そこで頭打ちにする。**これは上限であって保証ではない**——39 桁でも
 * 係数の比の向き次第で `Overflow` は起きる(spec §3.5)。
 *
 * **この 39 は `calcarc_core::convert::settle::MAX_VALUE_CHARS` と同じ数で、
 * 2 つは一緒に動かす。** 定数は境界を越えて公開されていないので機械の番人は
 * 置けない——ここだけ上げると、コアの上限を超える桁を打てるようになり、
 * `settle` がその値を `Overflow` で返して `=` が disabled になる(押せなく
 * なるだけで、値が黙って壊れることはない)。
 */
const MAX_VALUE_DIGITS = 39;

export function pushDigit(entry: units.Entry, digit: string): units.Entry {
  return units.pushDigit(entry, digit, MAX_VALUE_DIGITS);
}

export function pushDot(entry: units.Entry): units.Entry {
  return units.pushDot(entry, MAX_VALUE_DIGITS);
}

/**
 * `=` の答え(コアの `settle`: 有限小数か既約分数 `p/q`、**符号なし**)から値の欄を組み直す
 * (0.9.2 設計書 §4)。分数は「数・/・数」の 3 語にする——次に打つ演算子はそのあとに続き、
 * コアが式として読み直す(`/` は `×`・`÷` と同じ段で左から畳むので、`1/3 × 3` は 1)。
 */
/**
 * `=` の答えが出ている状態で、**新しい入力を始めるキー**か
 * (0.9.3 設計書 §4.5、利用者の裁定 2026-09-17)。
 *
 * **画面の数を捨てるキーは新しい入力を始め、手元の値に掛かるキーは続く**
 * ——0.9.2 の「**数を黙って捨てるキーは押せない**」(F5)と同じ線である。
 * 関数電卓は engine が同じ規則を持っている(`=` のあとの数字は新しい計算。
 * `crates/calcarc-core/tests/engine_table.rs` の S6)。**Convert だけ別の形にしない。**
 *
 * | キー | どうなるか |
 * |---|---|
 * | 数字・`.`・`000` | **新しい入力を始める** |
 * | `+/−` | 続き(答えの符号を変えるだけで、値を捨てない) |
 * | 二項演算子・`(`・`)` | 続き(答えを左辺にして式を続ける) |
 * | `DEL`・`AC` | 続き(答えを編集する／捨てる) |
 *
 * **0.9.2 まではどのキーも「続き」だった**ので、`1 ÷ 3 = 5` が `1/35` になっていた
 * ——`fromSettled` が digits で終わる `Entry` を作り、`pushDigit` が末尾に追記するため。
 */
export function startsNewValue(token: string): boolean {
  return token.startsWith("digit:") || token === "dot" || token === "zeros3";
}

export function fromSettled(value: string): units.Entry {
  const [numerator = "", denominator] = value.split("/");
  if (denominator === undefined) return units.fromDigits(numerator);
  return {
    tokens: [
      { kind: "digits", text: numerator },
      { kind: "op", op: "/" },
      { kind: "digits", text: denominator },
    ],
  };
}

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

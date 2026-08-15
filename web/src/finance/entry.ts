/**
 * Finance の数の入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——単位のラベルと並び、桁数の上限——を束ねるだけである。
 *
 * **scale は持たない。** `3000万` を 30,000,000 にするのはコアの仕事である
 * （設計書 2026-08-15 訂正 2）。ここが持つのはラベルと順番だけで、
 * 「億 の次に 万 は置けるが逆は不可」の判定にはそれで足りる。
 */
import type { Unit } from "../units/entry";
import * as units from "../units/entry";

export type { Entry, Operator, Token, Unit } from "../units/entry";
export {
  backspace,
  canPushCloseParen,
  canPushOpenParen,
  canPushOperator,
  canPushUnit,
  EMPTY,
  fromDigits,
  grouped,
  hasOperator,
  isEmpty,
  openDepth,
  pushCloseParen,
  pushDot,
  pushOpenParen,
  pushOperator,
  pushUnit,
  text,
} from "../units/entry";

/** 金額の単位。降順（rank が小さいほど大きい）。 */
export const OKU: Unit = { label: "億", rank: 0 };
export const MAN: Unit = { label: "万", rank: 1 };

/** 期間の単位。**複利では周期に従って意味が変わる**が、並びは同じ。 */
export const YEAR: Unit = { label: "年", rank: 0 };
export const MONTH: Unit = { label: "月", rank: 1 };

/** 金額は u64。10 進 20 桁で頭打ちにする。 */
const MAX_YEN_DIGITS = 20;

export function pushDigit(entry: units.Entry, digit: string): units.Entry {
  return units.pushDigit(entry, digit, MAX_YEN_DIGITS);
}

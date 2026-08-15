/**
 * Data Scale の数の入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——単位のラベルと並び、桁数の上限——を束ねるだけである。
 *
 * **scale は持たない**（設計書 2026-08-15 訂正 2）。`100M` を 100,000,000 に
 * するのはコアの仕事で、ここはラベルと順番だけを持つ。
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
  pushOpenParen,
  pushOperator,
  pushUnit,
  text,
} from "../units/entry";

/** 件数の単位。降順（rank が小さいほど大きい）。 */
export const G: Unit = { label: "G", rank: 0 };
export const M: Unit = { label: "M", rank: 1 };
export const K: Unit = { label: "K", rank: 2 };

/** 件数と次元数は u128。10 進 39 桁で頭打ちにする。 */
const MAX_COUNT_DIGITS = 39;

export function pushDigit(entry: units.Entry, digit: string): units.Entry {
  return units.pushDigit(entry, digit, MAX_COUNT_DIGITS);
}

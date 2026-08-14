/**
 * Data Scale の数の入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——K/M/G と、u128 の 10 進 39 桁——を束ねるだけである。
 *
 * K/M/G は **UI 層の文字列展開**であり、コアへ渡すのは展開後の素の数字列で
 * ある（`parse_count` は数字だけを受ける。base-spec §26: 丸めた表示値を
 * 入力に還流させない）。
 */
import type { Entry, Unit } from "../units/entry";
import * as units from "../units/entry";

export type { Entry, Unit } from "../units/entry";
export {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  grouped,
  isEmpty,
  pushUnit,
  text,
} from "../units/entry";

export const K: Unit = { label: "K", scale: 10n ** 3n };
export const M: Unit = { label: "M", scale: 10n ** 6n };
export const G: Unit = { label: "G", scale: 10n ** 9n };

/** 件数と次元数は u128。10 進 39 桁で頭打ちにする。 */
const MAX_COUNT_DIGITS = 39;

export function pushDigit(entry: Entry, digit: string): Entry {
  return units.pushDigit(entry, digit, MAX_COUNT_DIGITS);
}

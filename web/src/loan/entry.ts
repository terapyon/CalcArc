/**
 * Loan の金額入力。機構は `units/entry.ts` にあり、ここは**この電卓の
 * 定義域**——万・億と、u64 の 10 進 20 桁——を束ねるだけである。
 *
 * D が K/M/G で同じ機構を使うので、**2 人目の利用者が出た時点で引き上げた**
 * （S1 の部品を L が一般化したのと同じ順序。最初から汎用に作らない）。
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

export const MAN: Unit = { label: "万", scale: 10n ** 4n };
export const OKU: Unit = { label: "億", scale: 10n ** 8n };

/** 円は u64。10 進 20 桁で頭打ちにする。 */
const MAX_YEN_DIGITS = 20;

export function pushDigit(entry: Entry, digit: string): Entry {
  return units.pushDigit(entry, digit, MAX_YEN_DIGITS);
}

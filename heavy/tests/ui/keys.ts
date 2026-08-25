import type { KeyToken } from "../../../web/src/calc";
import { SCIENTIFIC_SECTIONS } from "../../../web/src/ui/Keypad/scientific";

/**
 * キートークン → 盤面のボタン。
 *
 * **手書きの表を持たない。** UI が描くのと同じ定義(`SCIENTIFIC_SECTIONS`)から
 * 導く。手で書くと、キーが Shift の裏に移動しても表は古いまま緑になり——
 * 「そのキーは押せる」という嘘が残る。
 *
 * 導いた結果、**どのトークンにもボタンが無い**なら、それは
 * 「盤面から到達できないキー」であり、**それ自体が発見である。**
 */
export interface ButtonFor {
  /** 押すボタンのアクセシブルネーム。 */
  ariaLabel: string;
  /** 押す前に Shift を押す必要があるか。 */
  needsShift: boolean;
  /** どの区画にあるか。region 起点で引くために要る。 */
  section: string;
}

export const SHIFT_ARIA_LABEL = "第2面に切り替え";

function build(): Map<KeyToken, ButtonFor> {
  const map = new Map<KeyToken, ButtonFor>();
  for (const section of SCIENTIFIC_SECTIONS) {
    for (const key of section.keys) {
      if (key.token !== null) {
        const existing = map.get(key.token);
        if (existing !== undefined) {
          throw new Error(
            `keys: ${key.token} appears twice on the keypad ` +
              `(${existing.ariaLabel} and ${key.ariaLabel}). The driver would ` +
              "press one of them arbitrarily.",
          );
        }
        map.set(key.token, {
          ariaLabel: key.ariaLabel,
          needsShift: false,
          section: section.ariaLabel,
        });
      }
      const shifted = key.shift;
      if (shifted !== undefined && shifted.token !== null) {
        if (map.has(shifted.token)) {
          throw new Error(
            `keys: ${shifted.token} appears twice on the keypad. ` +
              "The driver would press one of them arbitrarily.",
          );
        }
        map.set(shifted.token, {
          ariaLabel: shifted.ariaLabel,
          needsShift: true,
          section: section.ariaLabel,
        });
      }
    }
  }
  return map;
}

export const BUTTON_FOR: ReadonlyMap<KeyToken, ButtonFor> = build();

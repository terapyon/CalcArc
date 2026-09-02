import type { Offness } from "../Keypad/types";
import styles from "./Key.module.css";

export type KeyVariant = "digit" | "operator" | "function" | "danger";

export interface KeyProps<T> {
  /**
   * 押したときに送るトークン。**null は予約スロット**——そこに何か来ることを
   * 示すだけの、押せないキーである(S1 設計書 §5)。
   */
  token: T | null;
  /** 画面に出す文字。記号でよい。 */
  label: string;
  /**
   * 読み上げ用の名前。記号キーには必ず与える(base-spec §43)。
   * 省略時は label をそのまま使う。
   */
  ariaLabel?: string;
  variant?: KeyVariant;
  /**
   * トグルキーの押下状態。**渡さなければ `aria-pressed` は付かない**——
   * ただのキーに "false" が付くと、読み上げがトグルボタンとして扱う。
   */
  pressed?: boolean;
  /**
   * 押せない理由。**押せるなら渡さない（`undefined`）。**
   *
   * **`boolean` ではない。** 0.5.0 で「この盤面では永久に押せない」を
   * `disabled?: boolean` へ入れたために、**散文でしか守っていなかった
   * 「条件が変われば押せる」という契約が黙って破れた**（設計書
   * `2026-08-31-two-shades-of-off.md` §0）。**型で塞いである。**
   *
   * **予約スロット（`token === null`）は `"permanent"` に合流する**
   * ——利用者にとって、予約スロットと死んだ演算子の違いは意味を持たない
   * （ユーザー裁定 2026-08-31）。
   */
  off?: Offness;
  /**
   * 「この盤面では永久に押せない」ことを説明する要素の id。
   * **永久のキーだけがこれを指す**（`Keypad` が 1 つ置き、全部で共有する）。
   *
   * **`aria-label` に文を足さない**——キーは読み上げ名で選ばれており
   * （`getByRole("button", { name })`）、名前に説明を混ぜると**名前で選ぶ検査が
   * 広範に壊れ、名前の安定性も失う**（設計書 §1.2）。**説明は説明の欄へ。**
   */
  permanentDescriptionId?: string;
  onPress: (token: T) => void;
  /**
   * トークンを送らない特別なキー(Shift)。渡されたらこちらが優先され、
   * `token` は使われない。
   */
  onActivate?: () => void;
}

export function Key<T>({
  token,
  label,
  ariaLabel,
  variant = "digit",
  pressed,
  off: offReason,
  permanentDescriptionId,
  onPress,
  onActivate,
}: KeyProps<T>) {
  // 面を切り替えるキーは token を持たないが、押せる。
  const reserved = token === null && !onActivate;
  // **予約スロットは永久側**（設計書 §1.1 の裁定）。
  const offness: Offness | undefined = reserved ? "permanent" : offReason;
  const off = offness !== undefined;
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}${
        reserved ? ` ${styles.empty}` : ""
      }`}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      data-token={token === null ? undefined : String(token)}
      disabled={off}
      aria-disabled={off || undefined}
      aria-describedby={
        offness === "permanent" ? permanentDescriptionId : undefined
      }
      onClick={() => {
        if (onActivate) {
          onActivate();
          return;
        }
        if (token !== null) onPress(token);
      }}
    >
      {/* **予約スロットには何も書かない**（ユーザー裁定 2026-09-02）。
          記号を持つキー(`÷ × − + =`・`( )`)は**記号を残したまま**押せない
          見た目にするが、**まだ何も入っていないセルに `—` を置くと、
          「そういうキーがある」に見える**。**枠(セル)は残す**——5×5 の
          格子は面をまたいで同じ位置にあり、そこは変えない。

          **面のデータ(`dataScale.ts` ほか)は `—` を持ったままである**
          ——格子のどこが空きかを読める形で残すため。**画に出すかはここが
          決める**ので、**データの `—` を書き換えても画は変わらない**
          （番人は `operators.test.tsx` の「予約枠に文字が無い」）。 */}
      {reserved ? null : label}
    </button>
  );
}

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
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      data-token={token === null ? undefined : String(token)}
      disabled={off}
      aria-disabled={off || undefined}
      onClick={() => {
        if (onActivate) {
          onActivate();
          return;
        }
        if (token !== null) onPress(token);
      }}
    >
      {label}
    </button>
  );
}

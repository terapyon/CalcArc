import type { KeyToken } from "../../calc";
import styles from "./Key.module.css";

export type KeyVariant = "digit" | "operator" | "function" | "danger";

export interface KeyProps {
  /** calcarc-core に渡すトークン。null は予約スロット(何も送らない)。 */
  token: KeyToken | null;
  /** 画面に出す文字。記号でよい。 */
  label: string;
  /**
   * 読み上げ用の名前。記号キーには必ず与える(base-spec §43)。
   * 省略時は label をそのまま使う。
   */
  ariaLabel?: string;
  variant?: KeyVariant;
  /** トグルキー(Shift)の押下状態。通常のキーには渡さない。 */
  pressed?: boolean;
  onPress: (token: KeyToken) => void;
  /**
   * トークンを送らない特別なキー(Shift)。渡されたらこちらが優先され、
   * `token` は使われない。
   */
  onActivate?: () => void;
}

export function Key({
  token,
  label,
  ariaLabel,
  variant = "digit",
  pressed,
  onPress,
  onActivate,
}: KeyProps) {
  // 予約スロット(設計書 §5)。S2 が埋めるまで場所だけ確保する。
  // 面を切り替えるキーは token を持たないが、押せる。
  const reserved = token === null && !onActivate;
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      data-token={token ?? undefined}
      disabled={reserved}
      aria-disabled={reserved || undefined}
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

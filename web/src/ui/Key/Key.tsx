import type { KeyToken } from "../../calc";
import styles from "./Key.module.css";

export type KeyVariant = "digit" | "operator" | "function" | "danger";

export interface KeyProps {
  /** calcarc-core に渡すトークン。 */
  token: KeyToken;
  /** 画面に出す文字。記号でよい。 */
  label: string;
  /**
   * 読み上げ用の名前。記号キーには必ず与える(base-spec §43)。
   * 省略時は label をそのまま使う。
   */
  ariaLabel?: string;
  variant?: KeyVariant;
  onPress: (token: KeyToken) => void;
}

export function Key({
  token,
  label,
  ariaLabel,
  variant = "digit",
  onPress,
}: KeyProps) {
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      data-token={token}
      onClick={() => onPress(token)}
    >
      {label}
    </button>
  );
}

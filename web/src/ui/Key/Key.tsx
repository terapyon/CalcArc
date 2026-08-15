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
   * 今は押せない(状態依存)。**予約スロットとは由来が違う**——あちらは
   * 「ここに何か来る」永続的な空きで、こちらは条件が変われば押せる
   * (L 設計書 §4)。
   */
  disabled?: boolean;
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
  disabled,
  onPress,
  onActivate,
}: KeyProps<T>) {
  // 面を切り替えるキーは token を持たないが、押せる。
  const reserved = token === null && !onActivate;
  const off = reserved || disabled === true;
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

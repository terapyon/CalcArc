import { type CSSProperties, useState } from "react";
import { Key } from "../Key/Key";
import styles from "./Keypad.module.css";
import type { KeypadSection } from "./types";

export interface KeypadProps<T> {
  /** 区画ごとのキー集合。列数と行の高さは区画が持つ(S1 設計書 §6)。 */
  sections: KeypadSection<T>[];
  onPress: (token: T) => void;
  /**
   * 押下状態を呼び出し側が決める(モード行・項目行。L 設計書 §4)。
   * **`undefined` は「トグルではない」**——`aria-pressed` を付けない。
   * 数字キーに "false" が付くと、読み上げが全キーをトグルとして扱う。
   */
  pressed?: (token: T) => boolean | undefined;
  /**
   * 今は押せない(状態依存)。省略時はすべて押せる。**予約スロットとは
   * 由来が違う**——あちらは「ここに何か来る」永続的な空きである。
   */
  disabled?: (token: T) => boolean;
}

export function Keypad<T>({
  sections,
  onPress,
  pressed,
  disabled,
}: KeypadProps<T>) {
  // Shift は UI 層の状態である。engine には面の概念を持ち込まない
  // (S1 設計書 §3)。engine から見れば従来どおり単一トークンの列である。
  const [shifted, setShifted] = useState(false);

  return (
    <div className={styles.keypad}>
      {sections.map((section) => (
        <fieldset
          key={section.ariaLabel}
          className={`${styles.section} ${styles[section.height]}`}
          aria-label={section.ariaLabel}
          style={{ "--keypad-columns": section.columns } as CSSProperties}
        >
          {section.keys.map((key, index) => {
            if (key.kind === "shift") {
              return (
                <Key
                  // 面を切り替えるキーは区画に 1 つだけ。
                  key="shift"
                  token={null}
                  label={key.label}
                  ariaLabel={key.ariaLabel}
                  variant={key.variant}
                  pressed={shifted}
                  onPress={onPress}
                  onActivate={() => setShifted((on) => !on)}
                />
              );
            }
            // 第 2 面の空きスロットは押せないので、面は立ったままになる。
            // 解除は Shift をもう一度押す——「押せないキーで面が降りる」より、
            // 何も起きないほうが読める(S1 レビューでの申し送りの裁定)。
            const face = shifted && key.shift ? key.shift : key;
            const token = face.token;
            return (
              // React の key はトークンと位置で固定する。面で変えると別要素と
              // みなされフォーカスが落ちる。**予約スロットはトークンもラベルも
              // 重なる**(どれも null と「—」)ので、位置以外に一意にする手が
              // 無い——キー集合はモジュール定数で並び替えも挿入も起きないから、
              // 位置は安定した識別子である。
              <Key
                // biome-ignore lint/suspicious/noArrayIndexKey: 上のとおり
                key={`${key.token ?? "slot"}-${index}`}
                token={token}
                label={face.label}
                ariaLabel={face.ariaLabel}
                variant={face.variant}
                pressed={token === null ? undefined : pressed?.(token)}
                disabled={token === null ? undefined : disabled?.(token)}
                onPress={(sent) => {
                  onPress(sent);
                  // ワンショット(S1 設計書 §3): 1 キーで第 1 面へ戻る。
                  setShifted(false);
                }}
              />
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

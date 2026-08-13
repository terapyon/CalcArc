import { type CSSProperties, useState } from "react";
import type { KeyToken } from "../../calc";
import { Key } from "../Key/Key";
import styles from "./Keypad.module.css";
import type { KeypadSection } from "./types";

export interface KeypadProps {
  /** 区画ごとのキー集合。列数と行の高さは区画が持つ(設計書 §6)。 */
  sections: KeypadSection[];
  onPress: (token: KeyToken) => void;
}

export function Keypad({ sections, onPress }: KeypadProps) {
  // Shift は UI 層の状態である。engine には面の概念を持ち込まない
  // (設計書 §3)。engine から見れば従来どおり単一トークンの列である。
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
          {section.keys.map((key) => {
            if (key.kind === "shift") {
              return (
                <Key
                  key={key.label}
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
            const face = shifted && key.shift ? key.shift : key;
            return (
              // React の key は第 1 面のラベルで固定する。面で変えると
              // 別要素とみなされ、フォーカスが落ちる。
              <Key
                key={key.label}
                token={face.token}
                label={face.label}
                ariaLabel={face.ariaLabel}
                variant={face.variant}
                onPress={(token) => {
                  onPress(token);
                  // ワンショット(設計書 §3): 1 キーで第 1 面へ戻る。
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

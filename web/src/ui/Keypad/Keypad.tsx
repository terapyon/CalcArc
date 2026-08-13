import type { CSSProperties } from "react";
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
  return (
    <div className={styles.keypad}>
      {sections.map((section) => (
        <fieldset
          key={section.ariaLabel}
          className={`${styles.section} ${styles[section.height]}`}
          aria-label={section.ariaLabel}
          style={{ "--keypad-columns": section.columns } as CSSProperties}
        >
          {section.keys.map((key) => (
            <Key
              key={key.label}
              token={key.token}
              label={key.label}
              ariaLabel={key.ariaLabel}
              variant={key.variant}
              onPress={onPress}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

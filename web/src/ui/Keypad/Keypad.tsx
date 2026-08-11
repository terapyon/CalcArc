import type { KeyToken } from "../../calc";
import { Key } from "../Key/Key";
import styles from "./Keypad.module.css";
import { KEYPAD_LAYOUT } from "./layout";

export interface KeypadProps {
  onPress: (token: KeyToken) => void;
}

export function Keypad({ onPress }: KeypadProps) {
  return (
    <fieldset className={styles.keypad} aria-label="電卓キーパッド">
      {KEYPAD_LAYOUT.map((key) => (
        <Key
          key={key.token}
          token={key.token}
          label={key.label}
          ariaLabel={key.ariaLabel}
          variant={key.variant}
          onPress={onPress}
        />
      ))}
    </fieldset>
  );
}

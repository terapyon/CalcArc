import type { BinOpName, DisplayState } from "../../calc";
import styles from "./Display.module.css";

const OP_SYMBOL: Record<BinOpName, string> = {
  Add: "+",
  Sub: "−",
  Mul: "×",
  Div: "÷",
};

export interface DisplayProps {
  display: DisplayState;
}

export function Display({ display }: DisplayProps) {
  const pending = `${"(".repeat(display.pendingDepth)}${
    display.pendingOp ? OP_SYMBOL[display.pendingOp] : ""
  }`;

  return (
    <section className={styles.display}>
      <div className={styles.status}>
        <span
          data-testid="display-angle"
          role="status"
          aria-label="角度の単位"
          aria-live="polite"
        >
          {display.angle === "Deg" ? "DEG" : "RAD"}
        </span>
        <span
          data-testid="display-pending"
          role="status"
          aria-label="計算の途中経過"
          aria-live="off"
        >
          {pending}
        </span>
        <span
          data-testid="display-form"
          role="status"
          aria-label="表示形式"
          aria-live="off"
        >
          {display.form === "Polar" ? "∠" : ""}
        </span>
      </div>
      <output
        className={styles.main}
        data-testid="display-main"
        // 結果が変わったことを読み上げる。polite なので操作を妨げない。
        aria-live="polite"
        {...(display.error ? { "data-error": display.error } : {})}
      >
        {display.main}
      </output>
    </section>
  );
}

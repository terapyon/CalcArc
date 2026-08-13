import type { BinOpName, DisplayState } from "../../calc";
import { Readout } from "../Readout/Readout";

const OP_SYMBOL: Record<BinOpName, string> = {
  Add: "+",
  Sub: "−",
  Mul: "×",
  Div: "÷",
};

export interface DisplayProps {
  display: DisplayState;
}

/**
 * Scientific の表示。`DisplayState` を `Readout` の文字列に写すだけの層で、
 * 記号の選び方など Scientific 固有の意味はここに残る(設計書 §6)。
 */
export function Display({ display }: DisplayProps) {
  const pending = `${"(".repeat(display.pendingDepth)}${
    display.pendingOp ? OP_SYMBOL[display.pendingOp] : ""
  }`;

  return (
    <Readout
      echo={display.echo}
      main={display.main}
      error={display.error}
      status={[
        {
          testId: "display-angle",
          ariaLabel: "角度の単位",
          text: display.angle === "Deg" ? "DEG" : "RAD",
          live: "polite",
        },
        {
          testId: "display-pending",
          ariaLabel: "計算の途中経過",
          text: pending,
        },
        {
          testId: "display-form",
          ariaLabel: "表示形式",
          text: display.form === "Polar" ? "∠" : "",
        },
      ]}
    />
  );
}

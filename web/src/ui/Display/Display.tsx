import type { BinOpName, DisplayState } from "../../calc";
import { Readout } from "../Readout/Readout";

const OP_SYMBOL: Record<BinOpName, string> = {
  Add: "+",
  Sub: "−",
  Mul: "×",
  Div: "÷",
  Pow: "^",
  Npr: "P",
  Ncr: "C",
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
      // Scientific は式を**名前なしの 1 件**で渡す。名前が無いので見た目は
      // 変わらない(設計書 §2)。空のときは 1 件も渡さない——行の場所は
      // Readout 側が確保する。
      entries={
        display.echo === ""
          ? []
          : [{ label: "", value: display.echo, active: true }]
      }
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
          testId: "display-notation",
          ariaLabel: "数の表記",
          text: display.notation === "Eng" ? "ENG" : "",
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

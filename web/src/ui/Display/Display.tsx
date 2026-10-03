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
  /**
   * **打鍵の綴り**（1.2、入力経歴の設計書 §2）。**渡されたらこれを出す。**
   *
   * **engine の `display.echo` は「畳んだスタックの形」**で（`30 sin × 2` は
   * `0.5 × 2`）、**`=` で空になる**。**利用者が見たいのは打った通りで、
   * `=` のあとも残ること**なので、**表示が読む先をこちらへ替えた。**
   * **engine の挙動は変えていない**——`echo` はいまも同じものを返す。
   */
  trail?: string;
  /**
   * **その行に付ける角度の印**（`"DEG"` / `"RAD"` / 付けないときは `""`）。
   * **モードで描いた行にだけ付く**（入力経歴の設計書 §4.1.2）。
   * **行の頭に出す**——`Readout` の「項目名」の場所である。
   */
  trailAngle?: string;
}

/**
 * Scientific の表示。`DisplayState` を `Readout` の文字列に写すだけの層で、
 * 記号の選び方など Scientific 固有の意味はここに残る(設計書 §6)。
 */
export function Display({ display, trail, trailAngle }: DisplayProps) {
  // **渡されなければ、いままでどおり engine の `echo`**（ほかの面はこちら）。
  const line = trail ?? display.echo;
  const pending = `${"(".repeat(display.pendingDepth)}${
    display.pendingOp ? OP_SYMBOL[display.pendingOp] : ""
  }`;

  return (
    <Readout
      // Scientific は式を**名前なしの 1 件**で渡す。名前が無いので見た目は
      // 変わらない(設計書 §2)。空のときは 1 件も渡さない——行の場所は
      // Readout 側が確保する。
      entries={
        line === ""
          ? []
          : [{ label: trailAngle ?? "", value: line, active: true }]
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

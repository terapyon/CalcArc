import { expect, test } from "@playwright/test";
import { parseDisplay } from "./display";

// 入力は Task 2 Step 2 で実測した表示文字列そのもの
// (docs/corpus-measurements.md)。ブリーフに書かれていた "1.4142135624" は
// 想像の値で、実測は "1.414213562"(有効数字 10 桁)だったのでそちらを使う。
test("plain decimals are read back", () => {
  expect(parseDisplay("3")).toBe(3);
  // 意図的に Math.SQRT2 ではなく表示の丸め値そのもの(有効数字 10 桁)と比較する。
  // Math.SQRT2 は 1.4142135623730951 で値が違い、置き換えると
  // 「表示文字列が丸められている」という前提が検証できなくなる。
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 上記のとおり意図的
  expect(parseDisplay("1.414213562")).toBe(1.414213562);
});

test("a negative sign is read", () => {
  // "-5"(ASCII)は「負の数」の探りで実際に観測した表示そのもの
  // (docs/corpus-measurements.md)。U+2212(数学用マイナス)は観測して
  // いないため、対応するテストも実装も置かない(レビュー修正ラウンド 1)。
  // 実測されたら、そのときに実測付きで足す。
  expect(parseDisplay("-5")).toBe(-5);
});

test("a display that is not a number is refused loudly", () => {
  // "j2" は「負数の平方根」の探りで実際に観測した表示(4 ± √ → sqrt(-4))。
  // CalcArc 独自の複素数表記であり、Number() で読める実数ではない。
  // 黙って NaN を返すと、比較が「誤差の範囲外」ではなく「常に不一致」に
  // 化けて原因が見えなくなる。
  expect(() => parseDisplay("j2")).toThrow();
});

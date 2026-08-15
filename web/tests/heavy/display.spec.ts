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

test("everything Number() would helpfully accept is refused", () => {
  // 敵対者レビュー(2026-08-15)が実測した「Number() が親切に解してしまう」
  // 入力。以前の実装はこれを全部黙って通していた。
  //
  // **空文字列が 0 になることが一番重い。** あらゆるキー列に空の表示を返す
  // 偽ハーネスに対して、同値ケース(左右の表示が一致することだけを主張する)
  // が 2000 件すべて通ってしまう。表示が壊れたことをこの層が検出できない
  // という意味なので、ここで固定する。
  expect(() => parseDisplay("")).toThrow();
  expect(() => parseDisplay(" ")).toThrow();
  expect(() => parseDisplay("\n")).toThrow();
  expect(() => parseDisplay(" 5 ")).toThrow();
  // 基数接頭辞。電卓は 16 進も 2 進も表示しない。
  expect(() => parseDisplay("0x10")).toThrow();
  expect(() => parseDisplay("0b101")).toThrow();
  expect(() => parseDisplay("0o17")).toThrow();
  // 正号。電卓は正の数に符号を付けない。
  expect(() => parseDisplay("+5")).toThrow();
  // 数でないもの。
  expect(() => parseDisplay("Infinity")).toThrow();
  expect(() => parseDisplay("-Infinity")).toThrow();
  expect(() => parseDisplay("NaN")).toThrow();
  // 小数点だけ・小数部が空。電卓の実測にこの形は無い。
  expect(() => parseDisplay(".5")).toThrow();
  expect(() => parseDisplay("5.")).toThrow();
  // 大文字の指数と、指数部の無い e。
  expect(() => parseDisplay("1E3")).toThrow();
  expect(() => parseDisplay("1e")).toThrow();
});

test("the exponent form the display could reach is read", () => {
  // 段階 2 のコーパスは指数表記を一度も踏んでいない(|値| が 1e-6 〜 1e9)。
  // 書式として許してあるのは、段階 3 で入ったときに「書式が読めない」で
  // 落ちるより素直に読めた方がよいためである。読めた値が正しいかは
  // 呼び出し側が判定する。
  expect(parseDisplay("1.234567891e+15")).toBe(1.234567891e15);
  expect(parseDisplay("-1.234567891e-15")).toBe(-1.234567891e-15);
  expect(parseDisplay("1e12")).toBe(1e12);
});

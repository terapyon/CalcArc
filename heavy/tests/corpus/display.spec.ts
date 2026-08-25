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
  // どちらも実際に観測した表示である。黙って NaN を返すと、比較が
  // 「誤差の範囲外」ではなく「常に不一致」に化けて原因が見えなくなる。
  //
  // "Math ERROR" は負数の平方根(4 ± √)の探りで観測した表示。
  // **2026-08-16 の main 取り込みで "2j" から変わった**(engine が
  // DomainError を返すようになった)。エラー表示のほうが、この層が
  // 拒むべきものの代表として射程が広い。
  expect(() => parseDisplay("Math ERROR")).toThrow();
  // "2j" は `j` `2` と打つと出る CalcArc 独自の複素数表記。**この表示自体は
  // 今も観測される**——変わったのは「負数の平方根の答えとして出るか」だけで、
  // 実数の書式でないことは変わらない。
  expect(() => parseDisplay("2j")).toThrow();
});

test("thousands separators are read, in the places the engine puts them", () => {
  // 2026-08-16 の main 取り込みで `format_real` が整数部を 3 桁ごとに
  // 区切るようになった。実測: `9 9 9 9 9 9 9 9 9 9 eq` → "9,999,999,999"。
  expect(parseDisplay("9,999,999,999")).toBe(9999999999);
  expect(parseDisplay("1,000")).toBe(1000);
  expect(parseDisplay("-1,234,567")).toBe(-1234567);
  // 区切りは整数部だけ。小数部はそのまま(実測: 1,234.5678)。
  expect(parseDisplay("1,234.5678")).toBe(1234.5678);
  // 4 桁未満は区切られない。区切りを必須にしていないこともここで固定する。
  expect(parseDisplay("999")).toBe(999);
});

test("a comma in a place the engine never puts one is refused", () => {
  // **これがカンマ対応の要である。** 単に `replace(/,/g, "")` で外すと、
  // 下の 4 つが全部通ってしまい、**区切り位置の壊れをこの層が二度と
  // 検出できなくなる**。コーパスの目的が独立検証である以上、書式として
  // 妥当であることを確かめてから外す。
  //
  // この test を赤くする編集: display.ts の REAL_DISPLAY を
  // `/^-?[\d,]+(?:\.\d+)?$/` のような「カンマをどこでも許す」形に緩める。
  expect(() => parseDisplay("1,2,3")).toThrow(); // 群が 3 桁でない
  expect(() => parseDisplay("1,23,456")).toThrow(); // 途中の群が 2 桁
  expect(() => parseDisplay("1,2345")).toThrow(); // 群が 4 桁
  expect(() => parseDisplay(",123")).toThrow(); // 先頭がカンマ
  expect(() => parseDisplay("1.234,5")).toThrow(); // 小数部にカンマ
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

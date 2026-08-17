import { expect, test } from "@playwright/test";
import {
  magnitude,
  parseComplexDisplay,
  parsePolarDisplay,
  zeroComponentsAgree,
} from "./complex";
import { classify, classifyComplex, loadShards } from "./corpus";
import { parseDisplay } from "./display";

/**
 * 複素数の読み方と比べ方（段階 J）。
 *
 * **ここは engine を一度も呼ばない。** 確かめるのは「規則そのもの」で、
 * 規則が緩めば engine の欠陥が見えなくなる場所を名指しする。
 */

const TOLERANCE = { abs: 5e-10, rel: 5e-10 };

test("the rectangular forms the calculator actually displays are read back", () => {
  // どれも実測（2026-08-17、heavy-harness 経由）で観測した表示である。
  expect(parseComplexDisplay("j2")).toEqual({ re: 0, im: 2 });
  expect(parseComplexDisplay("-j2")).toEqual({ re: 0, im: -2 });
  expect(parseComplexDisplay("3+j4")).toEqual({ re: 3, im: 4 });
  expect(parseComplexDisplay("3-j4")).toEqual({ re: 3, im: -4 });
  expect(parseComplexDisplay("2.2-j0.4")).toEqual({ re: 2.2, im: -0.4 });
  expect(parseComplexDisplay("-892.636+j575.81")).toEqual({
    re: -892.636,
    im: 575.81,
  });
  // 虚部が 0 なら実数として出る（`j0` とは出ない）。
  expect(parseComplexDisplay("-4")).toEqual({ re: -4, im: 0 });
  // 3 桁区切りも指数表記も、実部と虚部のどちらにも来る。
  expect(parseComplexDisplay("j1,363,193")).toEqual({ re: 0, im: 1363193 });
  expect(parseComplexDisplay("76,164,165.42-j508,221,023.6")).toEqual({
    re: 76164165.42,
    im: -508221023.6,
  });
  expect(parseComplexDisplay("3+j4e3")).toEqual({ re: 3, im: 4000 });
});

test("the polar display is not read as a rectangular one", () => {
  // **これを許すと `▸∠` の押し忘れが検出できなくなる。** 半径を実部として
  // 読んでしまい、角度を捨てて「だいたい合っている」に化ける。
  expect(() => parseComplexDisplay("5 ∠ 53.13010235")).toThrow(/rectangular/);
  expect(parsePolarDisplay("5 ∠ 53.13010235")).toEqual({
    r: 5,
    theta: 53.13010235,
  });
  expect(parsePolarDisplay("1 ∠ 180")).toEqual({ r: 1, theta: 180 });
  expect(parsePolarDisplay("2 ∠ -90")).toEqual({ r: 2, theta: -90 });
  // 逆向きも塞ぐ。直交形式を極形式として読ませない。
  expect(() => parsePolarDisplay("3+j4")).toThrow(/polar/);
});

test("things that are not displays of this calculator are refused", () => {
  // `parseDisplay` が守っている線と同じ。**空文字列が 0 になる**ような
  // 親切さを入れると、表示が壊れたことをこの層が検出できなくなる。
  for (const bad of [
    "",
    " ",
    "j",
    "+j4",
    "3+j",
    "j-2",
    "3 + j4",
    "NaN",
    "j∞",
  ]) {
    expect(() => parseComplexDisplay(bad), JSON.stringify(bad)).toThrow();
  }
});

test("every real the strict reader accepts, the complex reader reads the same", () => {
  // **書式を二重に書いていることの見張り。** `complex.ts` は実数の正規表現を
  // 部分として持ち直しており、片方だけ直す事故が起きうる。実際のコーパスの
  // 表示ではなく、両者が受け付ける形を突き合わせる。
  const reals = [
    "0",
    "-4",
    "0.5",
    "-0.0001",
    "1,234.5678",
    "9,999,999,999",
    "1e10",
    "-1e-10",
    "1.23456789e300",
  ];
  for (const text of reals) {
    expect(parseComplexDisplay(text), text).toEqual({
      re: parseDisplay(text),
      im: 0,
    });
  }
});

test("magnitude of a real is exactly Math.abs, so existing verdicts cannot move", () => {
  // **設計書 §6 が「はずで済ませない」と書いた点である。**
  //
  // `classify` は `classifyComplex` に委譲するようになった。既存 21379 件の
  // 判定が 1 件も動かないことは、「虚部 0 なら距離は |実部|」が**厳密に**
  // 成り立つことに掛かっている。`Math.hypot` は正しく丸められる保証を
  // 持たないので、そこを通さない。
  const values = [
    0,
    1,
    -1,
    0.1,
    1e-300,
    1e300,
    5e-324,
    1.7976931348623157e308,
    1 / 3,
    -12345.6789,
  ];
  for (const x of values) {
    expect(magnitude(x, 0), `magnitude(${x}, 0)`).toBe(Math.abs(x));
  }
});

test("classify and classifyComplex agree on every real case in the corpus", () => {
  // 上のテストは `magnitude` だけを見る。こちらは**判定そのもの**を、
  // 実際のコーパスの期待値で突き合わせる——実データで動かないことを示す。
  let compared = 0;
  for (const { shard } of loadShards()) {
    for (const testCase of shard.cases) {
      if (testCase.kind !== "value" || testCase.expect.im !== 0) {
        continue;
      }
      const expected = testCase.expect.re;
      // 期待値ちょうど、少し外れた値、大きく外れた値の 3 点で見る。
      for (const actual of [
        expected,
        expected * (1 + 3e-10),
        expected * (1 + 1e-6),
      ]) {
        const real = classify(actual, expected, shard.tolerance);
        const complex = classifyComplex(
          { re: actual, im: 0 },
          { re: expected, im: 0 },
          shard.tolerance,
        );
        expect(complex, testCase.id).toEqual(real);
        compared += 1;
      }
    }
  }
  // **比較の回数を実測して下限を置く。** 0 件でも `toEqual` は 1 度も
  // 呼ばれず緑になる——このブランチで 5 回踏んだ形である。
  expect(
    compared,
    "no real value case was compared, so this test asserted nothing",
  ).toBeGreaterThan(10000);
});

test("a component that should be zero is not allowed to appear", () => {
  // **複素平面上の距離だけでは塞げない穴。** 実部が大きく虚部が 0 のとき、
  // 虚部に小さなゴミが生えても距離はほとんど動かない。
  const expected = { re: 1e10, im: 0 };
  const withJunk = { re: 1e10, im: 1 };
  // 距離で見れば相対 1e-10——表示分解能の内側で、通ってしまう。
  expect(magnitude(0, 1) / magnitude(1e10, 0)).toBeLessThan(TOLERANCE.rel);
  expect(zeroComponentsAgree(withJunk, expected)).toBe(false);
  expect(classifyComplex(withJunk, expected, TOLERANCE).passed).toBe(false);
  // 逆向きも塞ぐ。あるはずの成分が消えた場合。
  expect(zeroComponentsAgree({ re: 1, im: 0 }, { re: 1, im: 2 })).toBe(true);
  expect(
    classifyComplex({ re: 1, im: 0 }, { re: 1, im: 2 }, TOLERANCE).passed,
  ).toBe(false);
});

test("the distance is measured in the complex plane, not per component", () => {
  // 純虚数は実部の相対誤差が定義できない。距離なら定義できる。
  const expected = { re: 0, im: 2 };
  expect(classifyComplex({ re: 0, im: 2 }, expected, TOLERANCE).passed).toBe(
    true,
  );
  expect(
    classifyComplex({ re: 0, im: 2 * (1 + 3e-10) }, expected, TOLERANCE).passed,
  ).toBe(true);
  expect(
    classifyComplex({ re: 0, im: 2 * (1 + 1e-6) }, expected, TOLERANCE).passed,
  ).toBe(false);
  // 実部と虚部が両方ずれる場合、距離は両方を合わせて見る。
  const both = { re: 3 + 3e-6, im: 4 + 4e-6 };
  const verdict = classifyComplex(both, { re: 3, im: 4 }, TOLERANCE);
  expect(verdict.passed).toBe(false);
  expect(verdict.relativeError).toBeCloseTo(1e-6, 12);
});

test("the complex shards actually carry non-real expectations", () => {
  // **虚部を比べる仕掛けを足しても、虚部を持つケースが無ければ何も確かめない。**
  const complexCases = loadShards()
    .filter(({ name }) => name.startsWith("complex-"))
    .flatMap(({ shard }) => shard.cases)
    .filter((c) => c.kind === "value" && c.expect.im !== 0);
  expect(
    complexCases.length,
    "no case with a non-zero imaginary part is present, so widening the " +
      "comparison to the imaginary axis verified nothing",
  ).toBeGreaterThan(1000);
});

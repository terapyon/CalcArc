/**
 * 複素数の表示を読み、複素数として比べる（段階 J）。
 *
 * **`parseDisplay` を広げない。** あれは実数の書式だけを受け付ける関数で、
 * 狭いことに価値がある——実数しか出ないはずのシャードで電卓が `j2` を
 * 表示するようになったら、あそこで落ちてほしい。広げるとその番人が消える。
 *
 * だから読み手を 2 つ持ち、**期待値が複素数のときだけ**こちらを使う。
 */

/**
 * 実数 1 つの書式。`display.ts` の `REAL_DISPLAY` と同じ形だが、
 * **こちらは部分として埋め込むため文字列で持つ。**
 *
 * 二重に書いていることは承知している。片方だけ直す事故を防ぐため、
 * `complex-rules.spec.ts` が「`parseDisplay` が受ける実数はこちらでも
 * 同じ値に読める」ことを実データで突き合わせる。
 */
const REAL_BODY = String.raw`-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:e[+-]?\d+)?`;
/** 虚部の大きさ。**符号は `j` の前に付く**ので、ここには含めない。 */
const MAGNITUDE = String.raw`(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:e[+-]?\d+)?`;

const PURE_REAL = new RegExp(`^(${REAL_BODY})$`);
/** `j2` / `-j2`。実部を表示しない形。 */
const PURE_IMAGINARY = new RegExp(`^(-?)j(${MAGNITUDE})$`);
/** `3+j4` / `2.2-j0.4`。**`j` は数の前**に置かれる。 */
const RECTANGULAR = new RegExp(`^(${REAL_BODY})([+-])j(${MAGNITUDE})$`);
/** `5 ∠ 53.13010235`。**半径と角度の間は空白付きの `∠`**（実測 2026-08-17）。 */
const POLAR = new RegExp(`^(${REAL_BODY}) ∠ (${REAL_BODY})$`);

export interface ComplexValue {
  re: number;
  im: number;
}

function toNumber(text: string): number {
  // 書式は呼び出し元の正規表現が既に検証している。カンマだけ外す。
  const value = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    throw new Error(`complex: cannot read ${JSON.stringify(text)} as a number`);
  }
  return value;
}

/**
 * 直交形式の表示を複素数として読む。
 *
 * 受け付けるのは実数 1 つ・純虚数・実部と虚部の組の 3 つだけである。
 * 極形式（`5 ∠ 53`）は**わざと受け付けない**——`polar_toggle` を押した表示を
 * 直交形式のつもりで読むと、半径を実部として比べてしまい、
 * **押し忘れが検出できなくなる**。
 */
export function parseComplexDisplay(main: string): ComplexValue {
  if (typeof main === "string") {
    const real = PURE_REAL.exec(main);
    if (real?.[1] !== undefined) {
      return { re: toNumber(real[1]), im: 0 };
    }
    const imaginary = PURE_IMAGINARY.exec(main);
    if (imaginary?.[2] !== undefined) {
      const sign = imaginary[1] === "-" ? -1 : 1;
      return { re: 0, im: sign * toNumber(imaginary[2]) };
    }
    const rect = RECTANGULAR.exec(main);
    if (rect?.[1] !== undefined && rect[3] !== undefined) {
      const sign = rect[2] === "-" ? -1 : 1;
      return { re: toNumber(rect[1]), im: sign * toNumber(rect[3]) };
    }
  }
  throw new Error(
    `complex: ${JSON.stringify(main)} is not a rectangular complex number in ` +
      "the format this calculator displays (a real, 'j<magnitude>' with an " +
      "optional leading '-', or '<real><+|->j<magnitude>')",
  );
}

/** 極形式の表示を `(半径, 角度)` として読む。 */
export function parsePolarDisplay(main: string): { r: number; theta: number } {
  const match = typeof main === "string" ? POLAR.exec(main) : null;
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(
      `complex: ${JSON.stringify(main)} is not a polar display of the form ` +
        '"<radius> ∠ <angle>"',
    );
  }
  return { r: toNumber(match[1]), theta: toNumber(match[2]) };
}

/**
 * 複素平面上の距離。
 *
 * **虚部が両方 0 のときは実部の絶対値そのもの**を返す。`Math.hypot` に
 * 通さないのは、あれが正しく丸められる保証を持たないためである——既存
 * 21379 件の判定が「複素数に広げたら 1 件だけ変わった」という形で
 * 動くのを避ける（設計書 2026-08-17-complex §6 が「はずで済ませない」と
 * 書いた点）。`complex-rules.spec.ts` がこの同一性を検査する。
 */
export function magnitude(re: number, im: number): number {
  if (im === 0) {
    return Math.abs(re);
  }
  if (re === 0) {
    return Math.abs(im);
  }
  return Math.hypot(re, im);
}

/**
 * 成分ごとに「期待が 0 なら実測も厳密に 0」を要求するか。
 *
 * **複素平面上の距離だけでは、小さい成分の誤りが見えない。** 実部が 1e10、
 * 虚部が 1e-5 のとき、虚部が丸ごと間違っていても距離は 1e-15 しか動かず、
 * 表示分解能(5e-10)の内側に収まって通ってしまう。
 *
 * いちばん重い形——**あるはずの成分が消える・無いはずの成分が生える**——は
 * 「期待が 0 なら実測も 0」で塞げる。距離の判定と両方を課す。
 */
export function zeroComponentsAgree(
  actual: ComplexValue,
  expected: ComplexValue,
): boolean {
  if (expected.re === 0 && actual.re !== 0) {
    return false;
  }
  return !(expected.im === 0 && actual.im !== 0);
}

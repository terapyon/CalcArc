import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvertCalc } from "../../convert";
// トークンの一覧は WASM を触らない `types.ts` から取る——ラッパー本体
// (`../../convert`)は下でまるごと差し替えるので、そちらから取ると
// 実物の綴りではなくモックを見ることになる(TransferPanel.test.tsx と同じ)。
import type {
  ConvertCategoryToken,
  ConvertResult,
  ConvertUnitToken,
} from "../../convert/types";
import { CONVERT_UNIT_TOKENS } from "../../convert/types";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (TransferPanel.test.tsx / DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../convert", () => ({
  initConvert: vi.fn(),
}));

import { initConvert } from "../../convert";
import { UNIT_LABELS, unitsOf } from "../Keypad/convert";
import { UnitPanel } from "./UnitPanel";

/**
 * コアに渡った引数の記録。**渡していること**そのものを主張するために要る
 * ——画面のラベル(`°C`)ではなくトークン(`degc`)が渡ることは、結果の数字
 * からは分からない。
 */
const calls: {
  value: string;
  category: string;
  from: string;
  to: string;
}[] = [];

/**
 * 基準単位あたりの係数と切片。**コアの移植ではない**——`Rational` ではなく
 * f64 で、丸めも 10 桁に落とすだけである(CLAUDE.md「参照実装を Rust の移植に
 * しない」と同じ理由で、ここは**呼び出しの配線を確かめるスタブ**であって
 * golden の代わりではない)。換算の正しさは
 * `crates/calcarc-core/tests/convert_golden.rs` と `testdata/convert.json`
 * が持つ。
 */
const FACTOR: Record<ConvertUnitToken, number> = {
  nm: 1e-9,
  um: 1e-6,
  mm: 1e-3,
  cm: 1e-2,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
  nmi: 1852,
  mg: 1e-6,
  g: 1e-3,
  kg: 1,
  t: 1000,
  lb: 0.45359237,
  oz: 0.45359237 / 16,
  st: 0.45359237 * 14,
  k: 1,
  degc: 1,
  degf: 5 / 9,
};

const OFFSET: Record<ConvertUnitToken, number> = {
  nm: 0,
  um: 0,
  mm: 0,
  cm: 0,
  m: 0,
  km: 0,
  in: 0,
  ft: 0,
  yd: 0,
  mi: 0,
  nmi: 0,
  mg: 0,
  g: 0,
  kg: 0,
  t: 0,
  lb: 0,
  oz: 0,
  st: 0,
  k: 0,
  degc: 273.15,
  degf: 45967 / 180,
};

function isUnit(token: string): token is ConvertUnitToken {
  return (CONVERT_UNIT_TOKENS as readonly string[]).includes(token);
}

/**
 * 打った文字列を数にする。**コアの式評価器の移植ではない**——括弧を受けず、
 * 優先順位も 2 段しか持たない。計画の裁定 2 が固定した表
 * (`-5-12 → -17`、`-1+1 → 0`、`-5*12 → -60`)だけは同じに読む。
 */
function evaluate(value: string): number | null {
  if (!/^-?\d+(\.\d+)?([+\-*/]\d+(\.\d+)?)*$/.test(value)) return null;
  const negative = value.startsWith("-");
  const parts = (negative ? value.slice(1) : value).split(/([+\-*/])/);
  // 掛け算・割り算を先に畳み、足し算・引き算を左から適用する。
  const terms: number[] = [];
  const adders: string[] = [];
  let term = Number(parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i] ?? "";
    const operand = Number(parts[i + 1] ?? "");
    if (op === "*") term *= operand;
    else if (op === "/") term /= operand;
    else {
      terms.push(term);
      adders.push(op);
      term = operand;
    }
  }
  terms.push(term);
  // **符号は先頭の項に付く**(計画の裁定 2)。全体を反転すると `-5-12` が +7 になる。
  let acc = (terms[0] ?? 0) * (negative ? -1 : 1);
  adders.forEach((op, index) => {
    const operand = terms[index + 1] ?? 0;
    acc = op === "+" ? acc + operand : acc - operand;
  });
  return acc;
}

/** 有効数字 10 桁 + 3 桁区切り。**指数表記は持たない**(このスタブが打つ値に出ない)。 */
function format(value: number): string {
  const rounded = Number(value.toPrecision(10));
  const [integer = "0", fraction] = Math.abs(rounded).toString().split(".");
  const sign = rounded < 0 ? "-" : "";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

function convertStub(
  value: string,
  category: string,
  from: string,
  to: string,
): ConvertResult {
  calls.push({ value, category, from, to });
  // **知らない綴りは SyntaxError**(コアの `Unit::from_token` と同じ)。画面の
  // ラベル(`°C`)を渡したら、ここで落ちる。
  if (!isUnit(from) || !isUnit(to)) return { text: null, error: "SyntaxError" };
  const parsed = evaluate(value);
  if (parsed === null) return { text: null, error: "SyntaxError" };
  const base = parsed * FACTOR[from] + OFFSET[from];
  return { text: format((base - OFFSET[to]) / FACTOR[to]), error: null };
}

function stubCalc(): ConvertCalc {
  return {
    convert: convertStub,
    // 単位面の並びはキー集合(`Keypad/convert.ts`)が持つので、パネルはこれを
    // 呼ばない。**呼ばれたら失敗させて検知する**(TransferPanel.test.tsx と同じ)。
    units: vi.fn(() => {
      throw new Error("stubCalc.units is not wired in this test");
    }),
  };
}

/** ボタン名は `web/src/ui/Keypad/convert.ts` の `ariaLabel` そのもの。 */
const FIELD = {
  value: "値を入力",
  from: "変換元の単位を選ぶ",
  to: "変換先の単位を選ぶ",
} as const;
const SWAP = "変換元と変換先を入れ替える";
const SIGN = "符号を変える";
const DOT = "小数点";
const AC = "この項目を消去";
const EQ = "計算する";

/** 単位キーの読み上げ名は**日本語**である(`convert.ts` の `UNIT_ARIA_LABELS`)。 */
const SPOKEN = {
  km: "キロメートル",
  mi: "マイル",
  mm: "ミリメートル",
  in: "インチ",
  kg: "キログラム",
  lb: "ポンド",
  degc: "摂氏",
  degf: "華氏",
  k: "ケルビン",
} as const;

async function renderPanel(
  category: ConvertCategoryToken = "length",
  calc: ConvertCalc = stubCalc(),
) {
  vi.mocked(initConvert).mockResolvedValue(calc);
  const view = render(<UnitPanel category={category} />);
  await screen.findByRole("button", { name: FIELD.value });
  return view;
}

async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

beforeEach(() => {
  calls.length = 0;
});

describe("UnitPanel（単位換算の盤面）", () => {
  it("converts a hundred kilometres into miles", async () => {
    // **既定は km → mi**(Task 11 の裁定)。単位キーを 1 度も押さずに出る
    // ことで、既定が「たまたま同じ表示」ではなく実際に計算へ渡っている
    // ことも同時に見る。
    await renderPanel();
    await press(["1", "0", "0"]);
    expect(main()).toHaveTextContent("62.13711922 mi");
    expect(screen.getByTestId("convert-result")).toHaveTextContent(
      "100 km = 62.13711922 mi",
    );
    expect(echo()).toHaveTextContent("変換元 km");
    expect(echo()).toHaveTextContent("変換先 mi");
  });

  it("hands the core the lowercase tokens, not the labels", async () => {
    // 画面は `°C`・`°F` と書くが、コアが受けるのは `degc`・`degf` である
    // (計画の裁定 1)。**綴りを取り違えるとコアは黙って SyntaxError を返す**
    // ので、渡した文字列そのものを見る。
    await renderPanel("temperature");
    await press(["2", "5"]);
    await press([FIELD.from, SPOKEN.degc]);
    await press([FIELD.to, SPOKEN.degf]);
    const last = calls.at(-1);
    expect(last, "calc.convert was never called").toBeDefined();
    expect(last).toEqual({
      value: "25",
      category: "temperature",
      from: "degc",
      to: "degf",
    });
  });

  it("swaps the two units and keeps the value", async () => {
    // spec §4.2。**⇅ は入力値を残す。** 100 mi は 160.9344 km なので、
    // 入れ替わったことと値が残ったことが 1 つの数で見える。
    await renderPanel();
    await press(["1", "0", "0"]);
    await press([SWAP]);
    expect(echo()).toHaveTextContent("値 100");
    expect(echo()).toHaveTextContent("変換元 mi");
    expect(echo()).toHaveTextContent("変換先 km");
    expect(main()).toHaveTextContent("160.9344 km");
  });

  it("lets the value be an expression", async () => {
    // spec §4.3: `5*12` と打って inch を選べば 60 inch = 5 ft。
    await renderPanel();
    await press(["5", "掛ける", "1", "2"]);
    await press([FIELD.from, SPOKEN.in]);
    await press([FIELD.to, "フィート"]);
    expect(calls.at(-1)?.value).toBe("5*12");
    expect(main()).toHaveTextContent("5 ft");
  });

  it("types the fixed point of the two temperature scales", async () => {
    // **spec §6 が名指しした不動点。** `±` を押して `40` を打ち、°C → °F で
    // `-40` が出る。**これが打てないなら、core と golden が緑でも盤面から
    // 到達不能である**(計画の裁定 3)——`units/entry.ts` は空の式に `-` を
    // 置けないので、符号はパネルが持つ。
    await renderPanel("temperature");
    await press([SIGN, "4", "0"]);
    expect(echo()).toHaveTextContent("値 -40");
    expect(calls.at(-1)?.value).toBe("-40");
    expect(main()).toHaveTextContent("-40 °F");
  });

  it("reads a typed minus as the sign of the first term, not of the whole", async () => {
    // **計画の裁定 2 の訂正。** `-5-12` は −17 であって +7 ではない
    // ——先頭の `-` を剥がして全体を反転すると −(5−12) = +7 になる。
    // **`-5*12` では判別できない**(2 つの解釈が一致する)。
    await renderPanel();
    await press(["5", "引く", "1", "2", SIGN]);
    await press([FIELD.to, SPOKEN.km]);
    expect(calls.at(-1)?.value).toBe("-5-12");
    expect(main()).toHaveTextContent("-17 km");
  });

  it("keeps the sign when the two units are swapped", async () => {
    // spec §4.2: ⇅ は入力値をそのまま残す。**符号も値の一部である。**
    await renderPanel();
    await press([SIGN, "1", "0", "0"]);
    expect(main()).toHaveTextContent("-62.13711922 mi");
    await press([SWAP]);
    expect(echo()).toHaveTextContent("値 -100");
    expect(main()).toHaveTextContent("-160.9344 km");
  });

  it("AC clears the sign as well as the digits", async () => {
    // **符号だけが生き残ると、次に打った値が黙って負になる。** 消えたことは
    // 「表示に `-` が無い」だけでは足りない——打ち直して確かめる。
    await renderPanel();
    await press([SIGN, "4", "0"]);
    expect(echo()).toHaveTextContent("値 -40");
    await press([AC]);
    await press(["5"]);
    expect(echo()).toHaveTextContent("値 5");
    expect(echo()).not.toHaveTextContent("値 -5");
    expect(calls.at(-1)?.value).toBe("5");
  });

  it("AC empties the value and puts the units back to their defaults", async () => {
    // AC はいま打っている項目を最初に戻す(DataScale / Transfer と同じ規律。
    // 読み上げ名も「この項目を消去」である)。
    await renderPanel();
    await press(["1", "0", "0"]);
    await press([AC]);
    expect(echo()).not.toHaveTextContent("値 100");
    expect(screen.queryByTestId("convert-result")).toBeNull();

    await press([FIELD.from, SPOKEN.mm]);
    expect(echo()).toHaveTextContent("変換元 mm");
    await press([AC]);
    expect(echo()).toHaveTextContent("変換元 km");

    await press([FIELD.to, SPOKEN.km]);
    expect(echo()).toHaveTextContent("変換先 km");
    await press([AC]);
    expect(echo()).toHaveTextContent("変換先 mi");
  });

  it("shows an error instead of a number when the value is not a value", async () => {
    // **式が壊れていたら、そこで止めて言う。** 黙って中立に戻ると、打った人は
    // 何も起きない画面を見ることになる。
    await renderPanel();
    await press(["5", "掛ける"]);
    expect(main()).toHaveTextContent("Math ERROR");
    expect(main()).toHaveAttribute("data-error", "SyntaxError");
    expect(screen.queryByTestId("convert-result")).toBeNull();
  });

  it("says nothing until a value is typed", async () => {
    await renderPanel();
    expect(main()).toHaveTextContent("");
    expect(screen.queryByTestId("convert-result")).toBeNull();
    // **`±` だけでは値にならない。** 空の入力に符号を付けてコアへ渡すと
    // `-` 単体が SyntaxError になり、何も打っていない画面にエラーが出る。
    await press([SIGN]);
    expect(main()).toHaveTextContent("");
    expect(calls, "an empty value was handed to the core").toHaveLength(0);
  });

  it("settles the expression into the value when = is pressed", async () => {
    // Finance の `=` と同じ(`FinancePanel.tsx` の `settle`)——式をその場で
    // 評価して項目の値にする。**畳むものが無ければ押せない。**
    await renderPanel();
    await press(["5", "掛ける", "1", "2"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 60");
    expect(calls.at(-1)?.value).toBe("60");
    expect(screen.getByRole("button", { name: EQ })).toBeDisabled();
  });

  it("names every unit key of the category it is showing", async () => {
    // **3 カテゴリ 21 単位が、押せて表示に出ること。** 件数を `toBe` で
    // 固定する——ループだけだと、単位面が空になった日も緑になる。
    let seen = 0;
    for (const category of ["length", "mass", "temperature"] as const) {
      const { unmount } = await renderPanel(category);
      await press([FIELD.from]);
      const units = unitsOf(category);
      const keys = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-token^="unit:"]'),
      );
      // **並びは境界の並びである**(`convert/types.ts`)。押す前に突き合わせる。
      expect(keys.map((key) => key.dataset.token)).toEqual(
        units.map((unit) => `unit:${unit}`),
      );
      for (const [index, unit] of units.entries()) {
        const key = keys[index];
        if (key === undefined) throw new Error(`${unit} のキーが無い`);
        // 読み上げ名は日本語(`m` を「エム」と読ませない)。
        expect(key.getAttribute("aria-label")).not.toMatch(/^[ -~]+$/);
        await userEvent.click(key);
        expect(echo(), `${unit} を押しても表示に出ない`).toHaveTextContent(
          `変換元 ${UNIT_LABELS[unit]}`,
        );
        seen += 1;
      }
      unmount();
    }
    expect(seen, "no unit key was ever pressed").toBe(
      CONVERT_UNIT_TOKENS.length,
    );
  });

  it("types 25.4, which is one inch in millimetres", async () => {
    // **spec §3.2 の定義値がそのまま打てること。** 小数点キーが無いと、
    // 換算器がいちばん名指しする値が盤面から到達不能になる。
    await renderPanel();
    await press(["2", "5", DOT, "4"]);
    await press([FIELD.from, SPOKEN.mm]);
    await press([FIELD.to, SPOKEN.in]);
    expect(calls.at(-1)?.value).toBe("25.4");
    expect(main()).toHaveTextContent("1 in");
  });

  it("types 0.45359237, which is one pound in kilogrammes", async () => {
    // 先頭の `0` の後ろに小数点が置けること(`0.` → `0.4`)。
    await renderPanel("mass");
    await press(["0", DOT, "4", "5", "3", "5", "9", "2", "3", "7"]);
    await press([FIELD.from, SPOKEN.kg]);
    await press([FIELD.to, SPOKEN.lb]);
    expect(calls.at(-1)?.value).toBe("0.45359237");
    expect(main()).toHaveTextContent("1 lb");
  });

  it("types 273.15, which is the ice point in kelvin", async () => {
    await renderPanel("temperature");
    await press(["2", "7", "3", DOT, "1", "5"]);
    await press([FIELD.from, SPOKEN.k]);
    await press([FIELD.to, SPOKEN.degc]);
    expect(calls.at(-1)?.value).toBe("273.15");
    expect(main()).toHaveTextContent("0 °C");
  });
});

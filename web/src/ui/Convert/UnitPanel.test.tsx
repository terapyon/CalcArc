import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvertCalc } from "../../convert";
// トークンの一覧は WASM を触らない `types.ts` から取る——ラッパー本体
// (`../../convert`)は下でまるごと差し替えるので、そちらから取ると
// 実物の綴りではなくモックを見ることになる(TransferPanel.test.tsx と同じ)。
import type {
  ConvertCategoryId,
  ConvertResult,
  ConvertUnitToken,
} from "../../convert/types";
import {
  CONVERT_CATEGORY_IDS,
  CONVERT_CATEGORY_TOKENS,
  CONVERT_UNIT_TOKENS,
} from "../../convert/types";
import type {
  CurrencyConvertResult,
  CurrencyRateSet,
  CurrencyToken,
} from "../../currency/types";
import { CURRENCY_TOKENS } from "../../currency/types";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (TransferPanel.test.tsx / DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../convert", () => ({
  initConvert: vi.fn(),
}));

// **`Provider` と `Cache` を差し替えて回す**(spec §8)。jsdom には
// IndexedDB もネットワークも無く、**本物を呼べば通信が出る**。
vi.mock("../../currency/cache", () => ({
  readRates: vi.fn(),
  writeRates: vi.fn(),
}));

// **`provider.ts` は丸ごと差し替えない。** `PROVIDER_ATTRIBUTION` は
// **プロバイダの文言そのもの**(spec §2.1 実装時義務 3)で、テストが自分で
// 書き写したらそれは検査ではなくなる——差し替えるのは `fetch` を持つ
// `exchangeRateApi` だけである。
vi.mock("../../currency/provider", async (original) => {
  const actual = await original<typeof import("../../currency/provider")>();
  return { ...actual, exchangeRateApi: { getLatestRates: vi.fn() } };
});

import { initConvert } from "../../convert";
import { readRates, writeRates } from "../../currency/cache";
import { exchangeRateApi, PROVIDER_ATTRIBUTION } from "../../currency/provider";
import { CURRENCY_LABELS, UNIT_LABELS, unitsOf } from "../Keypad/convert";
import { UnitPanel } from "./UnitPanel";
import { resetRateFetchGuard } from "./useCurrencyRates";

/** `navigator.onLine` は jsdom では読み取り専用のゲッタである。 */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

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
 *
 * **意図的に部分表である**(U-2)。63 単位ぶんの係数をここに書き写すと、web に
 * 換算表がもう 1 つ生えて、コアとずれても誰も気づかない。**このスタブが
 * 知らない単位で換算を呼んだら、黙って通さず落とす**(`affine()`)——
 * 検査が知らないうちに別の値を見ていることのほうが怖い。
 */
const FACTOR: Partial<Record<ConvertUnitToken, number>> = {
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

const OFFSET: Partial<Record<ConvertUnitToken, number>> = {
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

/** 上の部分表を引く。**持っていない単位は落とす**(黙って 0 を返さない)。 */
function affine(unit: ConvertUnitToken): { factor: number; offset: number } {
  const factor = FACTOR[unit];
  const offset = OFFSET[unit];
  if (factor === undefined || offset === undefined) {
    throw new Error(`${unit} はこのスタブが係数を持たない単位である`);
  }
  return { factor, offset };
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
  const source = affine(from);
  const target = affine(to);
  const base = parsed * source.factor + source.offset;
  return {
    text: format((base - target.offset) / target.factor),
    error: null,
  };
}

/**
 * 為替換算の呼び出し記録。**レートまで控える**——盤面が
 * `validate` を通したレート表から起こした文字列を渡していることは、
 * 表示された数字からは分からない。
 */
const currencyCalls: {
  value: string;
  from: string;
  to: string;
  fromRate: string;
  toRate: string;
}[] = [];

/** ISO 4217 の小数桁。**部分表ではなく 16 通貨ぶん**(spec §3.1)。 */
const DECIMALS: Record<CurrencyToken, number> = {
  jpy: 0,
  krw: 0,
  vnd: 0,
  usd: 2,
  eur: 2,
  gbp: 2,
  chf: 2,
  cny: 2,
  thb: 2,
  sgd: 2,
  hkd: 2,
  twd: 2,
  aud: 2,
  cad: 2,
  inr: 2,
  brl: 2,
};

function isCurrencyToken(token: string): token is CurrencyToken {
  return (CURRENCY_TOKENS as readonly string[]).includes(token);
}

/**
 * 為替換算のスタブ。**コアの移植ではない**——`Rational` ではなく `f64` で、
 * 丸めも `toFixed` に任せている(CLAUDE.md「参照実装を Rust の移植にしない」と
 * 同じ理由で、これは**呼び出しの配線を確かめるスタブ**である)。換算と丸めの
 * 正しさは `crates/calcarc-core/tests/currency_golden.rs` と
 * `testdata/currency.json` が持つ。
 */
function convertCurrencyStub(
  value: string,
  from: string,
  to: string,
  fromRate: string,
  toRate: string,
): CurrencyConvertResult {
  currencyCalls.push({ value, from, to, fromRate, toRate });
  // **知らない綴りは SyntaxError**(コアの `Currency::from_token` と同じ)。
  // 画面のラベル(`USD`)を渡したら、ここで落ちる。
  if (!isCurrencyToken(from) || !isCurrencyToken(to)) {
    return { text: null, error: "SyntaxError" };
  }
  const parsed = evaluate(value);
  if (parsed === null) return { text: null, error: "SyntaxError" };
  const source = Number(fromRate);
  if (source === 0) return { text: null, error: "DivisionByZero" };
  const amount = (parsed / source) * Number(toRate);
  const fixed = amount.toFixed(DECIMALS[to]);
  const [integer = "0", fraction] = fixed.replace(/^-/, "").split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return {
    text: `${fixed.startsWith("-") ? "-" : ""}${grouped}${
      fraction === undefined ? "" : `.${fraction}`
    }`,
    error: null,
  };
}

function stubCalc(): ConvertCalc {
  return {
    convert: convertStub,
    convertCurrency: convertCurrencyStub,
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
  category: ConvertCategoryId = "length",
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
  currencyCalls.length = 0;
  vi.mocked(readRates).mockReset().mockResolvedValue(null);
  vi.mocked(writeRates).mockReset().mockResolvedValue(undefined);
  vi.mocked(exchangeRateApi.getLatestRates)
    .mockReset()
    .mockRejectedValue(new Error("this test did not wire a provider"));
  // **取得の抑制はモジュールに載っている**(同一セッションで 1 回だけ)。
  // 畳まないと、2 本目のテストが 1 本目の「もう試した」を引き継ぐ。
  resetRateFetchGuard();
  setOnline(true);
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

  it("keeps `=` disabled while the expression cannot be evaluated", async () => {
    // レビュー(round 1, Important 1)の実測: `5 ×` は畳むもの(演算子)は
    // あるので `hasOperator` では押せてしまうが、`settled()` は式が閉じて
    // いないので null を返す。**押せて何も起きないキーを作らない**という
    // Task 11 の方針どおり、この状態で `=` は disabled でなければならない。
    await renderPanel();
    await press(["5", "掛ける"]);
    expect(screen.getByRole("button", { name: EQ })).toBeDisabled();
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
    // 評価して項目の値にする。**評価できなければ(`settled() === null`)押せない。**
    await renderPanel();
    await press(["5", "掛ける", "1", "2"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 60");
    expect(calls.at(-1)?.value).toBe("60");
    // 畳んだあとの「60」も演算子は無いが評価はできる(同じ単位への恒等変換)
    // ので、`settled()` は null を返さない。FinancePanel の `settle` も
    // 演算子の有無ではなく評価できるかで判定しており、settle 後の `=` を
    // 無効化してはいない——**もう一度押しても値は変わらないので害が無い**。
    expect(screen.getByRole("button", { name: EQ })).not.toBeDisabled();
  });

  it("names every unit key of the category it is showing", async () => {
    // **7 カテゴリ 63 単位が、押せて表示に出ること。** 件数を `toBe` で
    // 固定する——ループだけだと、単位面が空になった日も緑になる。
    let seen = 0;
    for (const category of CONVERT_CATEGORY_TOKENS) {
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

/** レート表 1 枚。**値は文字列**(spec §2.1)——`number` にした時点で誤差が入る。 */
function rateSet(
  rates: Record<string, string>,
  when: { date: string; fetchedAt: string },
): CurrencyRateSet {
  return {
    baseCurrency: "USD",
    date: when.date,
    fetchedAt: when.fetchedAt,
    provider: "https://www.exchangerate-api.com",
    rates,
  };
}

const FULL_RATES: Record<string, string> = Object.fromEntries(
  CURRENCY_TOKENS.map((token, index) => [
    token.toUpperCase(),
    // 1 通貨ごとに違う値。**全部 1 にすると、鍵を取り違えても答が変わらない。**
    `${index + 1}.5`,
  ]),
);

/** いま。**取りに行かない側**(24 時間以内)。 */
const fresh = () => ({
  date: "2026-08-14",
  fetchedAt: new Date().toISOString(),
});

/** 24 時間より前。**背後で取りに行く側**。 */
const stale = () => ({ date: "2026-08-01", fetchedAt: "2026-08-01T00:00:00Z" });

const panel = () => screen.getByRole("region", { name: "単位変換" });

/** レート日付の行が、盤面の何番目の子か。**「同じ場所」を数で主張する。** */
function rateRowIndex(): number {
  return Array.from(panel().children).indexOf(
    screen.getByTestId("currency-rate"),
  );
}

describe("UnitPanel（為替の盤面）", () => {
  it("puts the rate date in the same place in every state", async () => {
    // **spec §5・§0.0-3。** 古いときだけ出すと、**出ていないことが「新しい」の
    // 意味になり**、読み手がそれを学習しなければならない。**5 つの状態で、
    // 同じ場所に同じ形で出る**ことを見る。
    const seen: { where: string; index: number; text: string }[] = [];

    for (const [where, wire] of [
      [
        "新しいキャッシュ",
        async () => {
          vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, fresh()));
        },
      ],
      [
        "古いキャッシュ（取得は成功）",
        async () => {
          vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, stale()));
          vi.mocked(exchangeRateApi.getLatestRates).mockResolvedValue(
            rateSet(FULL_RATES, { date: "2026-08-20", fetchedAt: "x" }),
          );
        },
      ],
      [
        "オフライン",
        async () => {
          setOnline(false);
          vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, stale()));
        },
      ],
      [
        "取得に失敗",
        async () => {
          vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, stale()));
          vi.mocked(exchangeRateApi.getLatestRates).mockRejectedValue(
            new Error("offline"),
          );
        },
      ],
      [
        "キャッシュ無し",
        async () => {
          vi.mocked(readRates).mockResolvedValue(null);
          setOnline(false);
        },
      ],
    ] as const) {
      await wire();
      const { unmount } = await renderPanel("currency");
      // 状態が落ち着くまで待つ。**待たずに測ると、どの状態も「読み込み中」を
      // 測ることになる。**
      await waitFor(() => {
        expect(
          screen.queryByTestId("currency-none") ??
            screen.getByTestId("convert-field"),
        ).toBeInTheDocument();
      });
      seen.push({
        where,
        index: rateRowIndex(),
        text: screen.getByTestId("currency-rate-date").textContent ?? "",
      });
      unmount();
      resetRateFetchGuard();
      setOnline(true);
    }

    expect(seen).toHaveLength(5);
    // **同じ場所**——盤面の中の位置が 1 通りに揃う。
    expect(new Set(seen.map((s) => s.index)).size, JSON.stringify(seen)).toBe(
      1,
    );
    // **番兵**: 測れていなければ -1 で 1 通りに揃ってしまう。
    expect(seen[0]?.index).toBeGreaterThanOrEqual(0);
    // **同じ形**——キャッシュがある 4 つは日付、無い 1 つは印。
    // 新しいキャッシュはそのまま、古いキャッシュは背後の取得で日付が進む。
    expect(seen.slice(0, 2).map((s) => s.text)).toEqual([
      "Rate: 2026-08-14",
      "Rate: 2026-08-20",
    ]);
    expect(seen[2]?.text).toBe("Rate: 2026-08-01");
    expect(seen[3]?.text).toBe("Rate: 2026-08-01");
    expect(seen[4]?.text).toBe("Rate: —");
    for (const state of seen) expect(state.text).toMatch(/^Rate: /);
  });

  it("disables the key of every currency the rate table does not carry", async () => {
    // **spec §7。** 押せないキーは押せないように見せる(`Key` が `:disabled` で
    // 薄くする)。**決めるのは `validate` が通した `rates` の鍵だけ**である
    // ——`CURRENCY_TOKENS` から起こすと、**落ちたはずの通貨が押せてしまう**。
    vi.mocked(readRates).mockResolvedValue(
      rateSet(
        {
          USD: "1",
          JPY: "155.23",
          EUR: "0.92",
          // **10 進として読めない** → `validate` がこの 1 通貨だけ落とす(§4.3)。
          GBP: "1e-3",
          // **面に無い通貨** → 落とす。
          XYZ: "3",
        },
        fresh(),
      ),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");
    await press([FIELD.from]);

    const keys = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-token^="unit:"]'),
    );
    expect(keys).toHaveLength(CURRENCY_TOKENS.length);
    const enabled = keys.filter((key) => !key.disabled);
    const disabled = keys.filter((key) => key.disabled);
    // **件数で主張する。** 3 通貨だけが残る——`GBP` は綴りが読めず、
    // `XYZ` は面に無い。
    expect(enabled.map((key) => key.dataset.token)).toEqual([
      "unit:jpy",
      "unit:usd",
      "unit:eur",
    ]);
    expect(disabled).toHaveLength(CURRENCY_TOKENS.length - 3);
    expect(
      keys.find((key) => key.dataset.token === "unit:gbp")?.disabled,
      "読めないレートの通貨が押せてしまっている",
    ).toBe(true);
  });

  it("guides instead of erroring when there is no cache", async () => {
    // **spec §5。** キャッシュ無しは**エラーではなく案内**である。
    vi.mocked(readRates).mockResolvedValue(null);
    setOnline(false);
    await renderPanel("currency");
    const notice = await screen.findByTestId("currency-none");
    expect(notice).toHaveTextContent(
      "為替レートがありません。インターネットに接続して取得してください。",
    );
    // **エラーの色でも役でもない。**
    expect(notice).toHaveAttribute("role", "note");
    expect(screen.queryByRole("alert")).toBeNull();

    // **換算結果の欄が出ない。** 値を打っても、レートが無ければ何も出せない。
    await press(["1", "0", "0"]);
    expect(screen.queryByTestId("convert-result")).toBeNull();
    expect(main()).toHaveTextContent("");
    expect(currencyCalls, "レートが無いのにコアを呼んでいる").toHaveLength(0);
    // レート表が無いので、**16 通貨すべてが押せない**。
    await press([FIELD.from]);
    const keys = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-token^="unit:"]'),
    );
    expect(keys.filter((key) => key.disabled)).toHaveLength(
      CURRENCY_TOKENS.length,
    );
  });

  it("notices going offline while the panel is already open", async () => {
    // **オフラインは開いた瞬間の値ではない**(spec §5 は「端末がオフライン」と
    // 書いており、いつ測るかは書いていない)。電車に入る、機内モードに切り替える
    // ——**盤面を開いたまま落ちる**ほうが、開く前から落ちているより普通である。
    //
    // ここまで、この状態は**一度も見られていなかった**: `deps.online()` を
    // 効果の中で 1 度読むだけで、`online`/`offline` の購読が web 全体に
    // 1 つも無かった。**キャッシュがあるので換算は続く**——変わるのは
    // 「いま出している数は取り直せない」と伝えるかどうかだけである。
    setOnline(true);
    vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, fresh()));
    await renderPanel("currency");
    await screen.findByTestId("currency-rate-date");
    expect(screen.queryByTestId("currency-offline")).toBeNull();

    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByTestId("currency-offline")).toBeVisible();

    // **戻ったら消える。** 片道だけ直すと、機内モードを解いた人に
    // 「オフライン」が残り続ける。
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("currency-offline")).toBeNull();
    });
  });

  it("shows the attribution the provider requires", async () => {
    // **spec §2.1 実装時義務 3: 出さない選択肢は無い。** 文言とリンクは
    // `provider.ts` の `PROVIDER_ATTRIBUTION`(プロバイダのドキュメントが
    // 指定したもの)から取る——ここで書き写したら検査にならない。
    vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, fresh()));
    await renderPanel("currency");
    const link = await screen.findByTestId("currency-attribution");
    expect(link).toHaveTextContent(PROVIDER_ATTRIBUTION.text);
    expect(link).toHaveAttribute("href", PROVIDER_ATTRIBUTION.href);
    // **レート日付の行の隣**(spec §7 が予約した置き場)。
    expect(screen.getByTestId("currency-rate")).toContainElement(link);
  });

  it("hands the core the rates it read, not the labels", async () => {
    // 画面は `USD`・`JPY` と書くが、コアが受けるのは `usd`・`jpy` と
    // **10 進の文字列のままのレート**である(spec §2.1・§3)。
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");
    await press(["1", "0", "0"]);
    expect(currencyCalls.at(-1)).toEqual({
      value: "100",
      from: "usd",
      to: "jpy",
      fromRate: "1",
      toRate: "155.23",
    });
    // JPY は小数桁 0(spec §3.1)。
    expect(main()).toHaveTextContent("15,523 JPY");
    expect(screen.getByTestId("convert-result")).toHaveTextContent(
      "100 USD = 15,523 JPY",
    );
    expect(echo()).toHaveTextContent(`変換元 ${CURRENCY_LABELS.usd}`);
  });

  it("does not round the typed value into the currency's decimals", async () => {
    // **`=` は式を数にするだけである。** 着地通貨の桁で丸めると、JPY を
    // 選んで `12.5` と打った人の**入力が書き換わる**。
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");
    await press(["2", "5", "割る", "2"]);
    await press([EQ]);
    // **12.5 のままである。** `convertCurrency` で畳んでいたら、JPY の
    // 小数桁 0 で丸められて `13` になる。
    expect(echo()).toHaveTextContent("値 12.5");
    expect(calls.at(-1)?.value).toBe("12.5");
  });

  it("asks the provider once per session, even when the fetch fails", async () => {
    // **Task 6 の申し送り。** `decide` は 1 回きりの判断で、`refresh: true` を
    // 受けて失敗したあと再描画のたびに呼ぶと**毎回取りに行く**。抑制は
    // 盤面側が持つ——**マウントより長く生きる必要がある**(`ConvertPanel` は
    // カテゴリごとに `key` を与えて盤面を作り直す)。
    vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, stale()));
    vi.mocked(exchangeRateApi.getLatestRates).mockRejectedValue(
      new Error("offline"),
    );
    const first = await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-01");
    await waitFor(() =>
      expect(exchangeRateApi.getLatestRates).toHaveBeenCalledTimes(1),
    );
    first.unmount();

    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-01");
    // **開き直しても取りに行かない。** 失敗は致命的でなく(§5)、古いレートの
    // まま換算が続く。
    expect(exchangeRateApi.getLatestRates).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRates)).not.toHaveBeenCalled();
  });

  it("touches neither the network nor the cache from the other seven categories", async () => {
    // **spec §0.0-2: 起動時に通信しない。** ネットワークは Currency を開いた
    // あとの話である。**「呼ばれない」を主張するテストは、スパイが実際に
    // 配線されていることも同時に主張する**——配線されていなければ 0 回で
    // 緑になる(この検査の最後の 2 行がそれである)。
    vi.mocked(readRates).mockResolvedValue(rateSet(FULL_RATES, fresh()));
    let opened = 0;
    for (const category of CONVERT_CATEGORY_IDS) {
      if (category === "currency") continue;
      // **値は打たない。** この検査が見るのは「開いただけで通信するか」で
      // あり、換算のスタブは 7 カテゴリぶんの係数を持っていない。
      const { unmount } = await renderPanel(category);
      unmount();
      opened += 1;
    }
    expect(opened).toBe(7);
    expect(readRates).not.toHaveBeenCalled();
    expect(exchangeRateApi.getLatestRates).not.toHaveBeenCalled();

    // **スパイが配線されている**ことの証拠。為替を開けば読みに行く。
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");
    expect(readRates).toHaveBeenCalledTimes(1);
  });
});

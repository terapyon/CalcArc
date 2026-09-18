import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrencyRateSet } from "../../currency/types";
import { UnitPanel } from "./UnitPanel";
import { resetRateFetchGuard } from "./useCurrencyRates";

// 実物の wasm を通す(0.9.2 設計書 §4.3)。`UnitPanel.test.tsx` の偽物の算数では、`=` が
// 桁を落とすかどうかが見えない——落としていたのは wasm の境界の書式だったからである。
// **wasm の `init`(fetch で読む)だけを、ファイルから同期で読む `initSync` に差し替える。**
// 包み(`initConvert`)は本物のまま通す。
vi.mock("../../wasm/calcarc_wasm.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../wasm/calcarc_wasm.js")>();
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const bytes = readFileSync(
    join(process.cwd(), "src/wasm/calcarc_wasm_bg.wasm"),
  );
  return {
    ...actual,
    default: async () => actual.initSync({ module: bytes }),
  };
});

// **`Provider` と `Cache` を差し替えて回す**(spec §8)。jsdom には
// IndexedDB もネットワークも無く、**本物を呼べば通信が出る**。ここで
// 実物にするのは Convert(wasm)だけで、為替のキャッシュ・取得は
// `UnitPanel.test.tsx` と同じ理由でスタブのままにする。
vi.mock("../../currency/cache", () => ({
  readRates: vi.fn(),
  writeRates: vi.fn(),
}));
vi.mock("../../currency/provider", async (original) => {
  const actual = await original<typeof import("../../currency/provider")>();
  return { ...actual, exchangeRateApi: { getLatestRates: vi.fn() } };
});

import { readRates, writeRates } from "../../currency/cache";
import { exchangeRateApi } from "../../currency/provider";

/** `navigator.onLine` は jsdom では読み取り専用のゲッタである。 */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

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

/**
 * いま。**取りに行かない側**(24 時間以内、`UnitPanel.test.tsx` の同名の
 * ヘルパーと同じ)。`fetchedAt` を固定した日付にすると、`decide()`
 * (`currency/provider.ts:215`)が「24 時間より古い」と読んで背後で
 * 取得を試み、`exchangeRateApi.getLatestRates` の reject が
 * 意図しない `act()` 警告の種になる——ここは為替の桁の検査で、
 * 取得の背後経路を検査対象にしない。
 */
const fresh = () => ({
  date: "2026-08-14",
  fetchedAt: new Date().toISOString(),
});

async function renderPanel(category: "length" | "currency" = "length") {
  const view = render(<UnitPanel category={category} />);
  await screen.findByRole("button", { name: FIELD.value });
  return view;
}

async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

/** 値の文字列を数字キーの列にする(`.` は小数点キー)。 */
function digitsOf(value: string): string[] {
  return Array.from(value, (ch) => (ch === "." ? DOT : ch));
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

const FIELD = {
  value: "値を入力",
  from: "変換元の単位を選ぶ",
  to: "変換先の単位を選ぶ",
} as const;
const DOT = "小数点";
const EQ = "計算する";
const SIGN = "符号を変える";
const ZEROS3 = "3桁のゼロ";
const DEL = "1文字消去";
const AC = "この項目を消去";

beforeEach(() => {
  vi.mocked(readRates).mockReset().mockResolvedValue(null);
  vi.mocked(writeRates).mockReset().mockResolvedValue(undefined);
  vi.mocked(exchangeRateApi.getLatestRates)
    .mockReset()
    .mockRejectedValue(new Error("this test did not wire a provider"));
  resetRateFetchGuard();
  setOnline(true);
});

describe("UnitPanel（実物の wasm、0.9.2 設計書 §4.3の監査例）", () => {
  it("keeps a repeating fraction exact, then folds it back to zero", async () => {
    // km→mi が既定(Task 11 の裁定)。`1 ÷ 3 =` は 10 進に丸めると
    // 0.3333333333 になる——ここでは既約分数 `1/3` のまま値の欄に戻る
    // ことを見る。
    await renderPanel("length");
    await press(["1", "割る", "3"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 1/3");

    // 続けて `× 3 − 1` は、コアが `/` を `×`・`÷` と同じ段で左から畳むので
    // `1/3 × 3 - 1 = 0`。分数のまま次の演算子を受け取れることの確認。
    await press(["掛ける", "3", "引く", "1"]);
    expect(main()).toHaveTextContent("0 mi");
  });

  it("starts a new value when a digit follows the answer", async () => {
    // **`=` の答えのあとに打った最初の数字は、新しい入力を始める**
    // (0.9.3 設計書 §4.5、利用者の裁定 2026-09-17)。
    //
    // 0.9.2 までは答えの末尾に足されて **`1/35`** になっていた——`fromSettled` が
    // digits で終わる Entry を作り、`pushDigit` が末尾の digits に追記するためである。
    // **関数電卓の「`=` のあとは新しい計算」(engine_table の S6)と同じ形にそろえる。**
    await renderPanel("length");
    await press(["1", "割る", "3"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 1/3");

    await press(["5"]);
    expect(echo()).toHaveTextContent("値 5");
  });

  it("only the keys that would drop the answer start a new value", async () => {
    // **画面の数を捨てるキーは新しい入力を始め、手元の値に掛かるキーは続く**
    // (0.9.3 設計書 §4.5 の表)。**0.9.2 の「数を黙って捨てるキーを拒む」と同じ線**である。
    await renderPanel("length");
    await press(["1", "割る", "3"]);
    await press([EQ]);

    // `.` は新しい入力を始める。**`0.` から始まる**——空から始めると
    // `pushDot` が何も足せない(打ちかけの数が無いと `.` は落ちる)。
    await press([DOT]);
    expect(echo()).toHaveTextContent("値 0.");

    // `+/−` は**続き**である。答えの符号を変えるだけで、値を捨てない。
    await press(["1", "割る", "3"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 1/3");
    await press([SIGN]);
    expect(echo()).toHaveTextContent("値 -1/3");
  });

  it("★ 再現: 負の答えのあとの新しい入力に、符号が持ち越される（F14）", async () => {
    // **利用者の実測 2026-09-18（出荷済みの 0.9.3）**: `1 − 2 =` で −1 を出し、
    // 続けて `5` を打つと **−5** になる（**正しくは 5**）。
    //
    // **D-3（0.9.3 §4.5）の副作用である**——`base` が空にするのは `entry` だけで、
    // **符号は別の state（`negative`）に居るので残る**。`typed` は
    // `-` を先頭に合成するので、**新しい値に前の答えの符号が付く**。
    await renderPanel("length");
    await press(["1", "引く", "2"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 -1");

    await press(["5"]);
    expect(echo()).toHaveTextContent("値 5");
  });

  // **合格条件は利用者の指定である**(2026-09-18): **正・ゼロ・負の答え ×
  // 数字・`.`・`000`・演算子・`+/−`・DEL・AC**、**入力欄だけでなく換算結果の行も**、
  // **為替にも回帰**。**表で回す**——1 本ずつ書くと、組み合わせのどれかが抜ける。
  //
  // **★ ただし、表は「踏んだつもり」を作りやすい**（1e の指摘、2026-09-18。
  // **私の最初の版が実際にそうなっていた**）。**1 つの `it` に 2 つの升を
  // 詰めたら、前半が残した入力が後半の頭に付き**、`0.52 − 1 =` という
  // **別の式**になっていた——**3 行とも「負の答えのあと」を測っており、
  // 正 × `000`・ゼロ × `000` は 1 度も踏まれていなかった。**
  // **行の名前は、升の中身を保証しない。**
  //
  // **だから 2 つ置いた**: **升ごとに画面を作り直す**ことと、
  // **新しい値のキーを押す前に「いまその答えが出ている」と主張する**こと。
  // **後者が、踏んだつもりを赤にする。**
  const ANSWERS = [
    { name: "正", keys: ["2", "引く", "1"], shown: "値 1" },
    { name: "ゼロ", keys: ["1", "引く", "1"], shown: "値 0" },
    { name: "負", keys: ["1", "引く", "2"], shown: "値 -1" },
  ] as const;

  for (const answer of ANSWERS) {
    it(`${answer.name}の答えのあと、数字は符号ごと新しい値になる`, async () => {
      await renderPanel("length");
      await press([...answer.keys, EQ]);
      expect(echo()).toHaveTextContent(answer.shown);

      await press(["5"]);
      // **入力欄**——前の答えの符号が残らない。
      expect(echo()).toHaveTextContent("値 5");
      // **換算結果の行も見る**(利用者の指定)。`5 km` は正の距離である。
      expect(main()).toHaveTextContent("3.106855961 mi");
      expect(main().textContent ?? "").not.toContain("-");
    });

    it(`${answer.name}の答えのあと、\`.\` は符号ごと新しい値になる`, async () => {
      await renderPanel("length");
      await press([...answer.keys, EQ]);
      // **★ 升を踏んだことを、先に主張する**（下の註）。
      expect(echo()).toHaveTextContent(answer.shown);

      await press([DOT, "5"]);
      expect(echo()).toHaveTextContent("値 0.5");
      expect(main().textContent ?? "").not.toContain("-");
    });

    it(`${answer.name}の答えのあと、\`000\` は符号ごと新しい値になる`, async () => {
      // **`.` と同じ `it` に入れない**——**前半が残した `0.5` が次の列の頭に
      // 付き、`0.52 − 1 =` のような別の式になる**（1e の実測 2026-09-18。
      // 下の註）。**画面を作り直して、升を 1 つだけ踏む。**
      await renderPanel("length");
      await press([...answer.keys, EQ]);
      expect(echo()).toHaveTextContent(answer.shown);

      await press([ZEROS3]);
      // **`000` は空から打つと `0` になる**(先頭のゼロは畳まれる。
      // 0.9.3 以前からの振る舞いで、この枝では変えていない)。
      // **ここで見たいのは符号のほう**——`-0` にならないこと。
      expect(echo()).toHaveTextContent("値 0");
      expect(main().textContent ?? "").not.toContain("-");
    });
  }

  it("負の答えの続きを打つキーは、符号を捨てない", async () => {
    // **一律に消さない**——**新しい値を始めるキーだけ**である
    // (`convert/entry.ts` の `startsNewValue` の表)。
    await renderPanel("length");

    // 演算子は続き: `-1 + 5 =` は 4。
    await press(["1", "引く", "2", EQ]);
    await press(["足す", "5", EQ]);
    expect(echo()).toHaveTextContent("値 4");

    // `+/−` は続き: 答えの符号を反転するだけ。
    await press([AC, "1", "引く", "2", EQ]);
    expect(echo()).toHaveTextContent("値 -1");
    await press([SIGN]);
    expect(echo()).toHaveTextContent("値 1");

    // DEL は続き: 数字を削っても符号は残る。
    await press([AC, "1", "引く", "1", "2", EQ]);
    expect(echo()).toHaveTextContent("値 -11");
    await press([DEL]);
    expect(echo()).toHaveTextContent("値 -1");
  });

  it("AC は符号も一緒に捨てる", async () => {
    await renderPanel("length");
    await press(["1", "引く", "2", EQ]);
    expect(echo()).toHaveTextContent("値 -1");
    await press([AC]);
    await press(["5"]);
    expect(echo()).toHaveTextContent("値 5");
    expect(main().textContent ?? "").not.toContain("-");
  });

  it("為替でも同じ——負の答えのあとの数字は符号を持ち越さない", async () => {
    // **同じ `UnitPanel` の同じ state** である(旗が違うだけ)。**それでも
    // 別に見る**——**共通経路だからこそ、片方でしか踏まない形を見落とす。**
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await press(["1", "引く", "2", EQ]);
    expect(echo()).toHaveTextContent("値 -1");
    await press(["5"]);
    expect(echo()).toHaveTextContent("値 5");
    expect(main().textContent ?? "").not.toContain("-");
  });

  it("settles a negative fraction, sign and all", async () => {
    // `fromSettled` は符号なしの答えしか受けない(`convert/entry.ts`)ので、
    // `UnitPanel.tsx` の `eq` ケースは先頭の `-` を剥がしてから渡し、符号は
    // `negative` state へ移す(`:305-306`)。**分数でもこの受け渡しが保つ**
    // ことを見る。
    await renderPanel("length");
    await press(["1", "割る", "3", SIGN]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 -1/3");
    expect(main()).toHaveTextContent("-0.2071237307 mi");
  });

  it("does not round a terminating decimal at any length", async () => {
    await renderPanel("length");
    await press(digitsOf("0.123456789012"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 0.123456789012");
  });

  it("keeps a value just under 1e10 exact", async () => {
    await renderPanel("length");
    await press(digitsOf("9999999999.4"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 9999999999.4");
  });

  it("settles a value at 1e10 and above, where = used to do nothing", async () => {
    // **以前はここで `=` が効かなかった**(外部監査 F3)——表示用の 10 桁の
    // 文字列(指数表記 `1.23456789e10`)は「打ち直せない形」の判定に
    // 引っかかり、`settled()` が null を返して `=` が disabled のまま
    // 押せなかった。**押せることも主張する**——「押しても変わらない」だけ
    // では、disabled のまま何も起きなかった場合と見分けが付かない。
    await renderPanel("length");
    await press(digitsOf("12345678901.5"));
    expect(screen.getByRole("button", { name: EQ })).not.toBeDisabled();
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 12345678901.5");
  });

  it("does not round the settled value into the landing currency's decimals", async () => {
    // JPY(小数桁 0)を着地に選んでも、`=` は打った桁を丸めない
    // (`UnitPanel.test.tsx` の偽物の同名の検査と対になる、実物での確認)。
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(digitsOf("12.5"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 12.5");
  });

  it("does not round a long decimal in currency mode either", async () => {
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(digitsOf("0.123456789012"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 0.123456789012");
  });

  // **フェーズ 1(いま): 直す前の赤を撮る。コアには触っていない。**
  // `web/src/wasm/` は直す前のコアから建っている(Task 6 ブリーフ §4)ので、
  // この 2 行はこの時点で FAIL する——それが狙いである。
  it("evaluates an inexact division in currency mode, instead of stranding in Math ERROR", async () => {
    // **`settle` は式を受けるが、為替の読み手(`parse_decimal`)は受けない**
    // ——`100/7` は割り切れないので `settle_expression` は `100/7` という
    // 既約分数のまま値の欄に書き戻すが、`convertCurrency` はその文字列を
    // 「金額」として読めず `SyntaxError` になる。値の欄は書き換わるのに
    // 答えの行が Math ERROR の袋小路になる、というのがこの枝が生んだ欠陥
    // (Task 6 ブリーフ「なぜ」)。**`÷` キーは Entry に `/` を書く**ので、
    // コアに届く文字列は `100/7` である。
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(["1", "0", "0", "割る", "7"]);
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 100/7");
    // **答えの行も見る。** 既存の 2 つの為替の検査は値の欄しか見ておらず、
    // だから今回の欠陥(Math ERROR の袋小路)が見えなかった(Task 6 ブリーフ §3)。
    expect(main()).toHaveTextContent("2,218 JPY");
  });

  it("shows a live amount before = is pressed too, once the reader can evaluate the expression", async () => {
    // **`=` を押す前から答えの行が出る**ことの番人(Task 6 ブリーフ §3)。
    // 単位側は式のまま `shown` を計算するので `=` を待たずに答えが出るが、
    // 為替は `parse_decimal` が式を受けないせいで、演算子を打った時点で
    // 答えの行が Math ERROR に落ちる——「前からあった変な動き」である。
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }, fresh()),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(["1", "0", "0", "割る", "7"]);
    // **`=` はまだ押していない。**
    expect(main()).toHaveTextContent("2,218 JPY");
  });
});

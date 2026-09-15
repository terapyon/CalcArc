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
function rateSet(rates: Record<string, string>): CurrencyRateSet {
  return {
    baseCurrency: "USD",
    date: "2026-08-14",
    fetchedAt: "2026-08-14T00:00:00.000Z",
    provider: "https://www.exchangerate-api.com",
    rates,
  };
}

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
      rateSet({ USD: "1", JPY: "155.23" }),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(digitsOf("12.5"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 12.5");
  });

  it("does not round a long decimal in currency mode either", async () => {
    vi.mocked(readRates).mockResolvedValue(
      rateSet({ USD: "1", JPY: "155.23" }),
    );
    await renderPanel("currency");
    await screen.findByText("Rate: 2026-08-14");

    await press(digitsOf("0.123456789012"));
    await press([EQ]);
    expect(echo()).toHaveTextContent("値 0.123456789012");
  });
});

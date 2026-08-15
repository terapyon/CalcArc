import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LoanCalc } from "../../loan";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../loan", () => ({
  initLoan: vi.fn(),
}));

// 式の評価器も WASM なので、ラッパーごと差し替える。**単位を解釈するのは
// コア**(設計書 訂正 2)なので、ここでは打った文字列から数字だけを拾う
// 簡易版で足りる——値の正しさは golden が見る。
vi.mock("../../expr", () => ({
  initExpr: () =>
    Promise.resolve({
      integer: (text: string, max: string) => {
        const units: Record<string, bigint> = {
          億: 10n ** 8n,
          万: 10n ** 4n,
          G: 10n ** 9n,
          M: 10n ** 6n,
          K: 10n ** 3n,
          年: 12n,
          月: 1n,
        };
        // 項ごとに単位を展開し、`+` だけ足す（経路の確認に足りる分だけ）。
        let value = 0n;
        for (const term of text.split("+")) {
          let total = 0n;
          let digits = "";
          for (const ch of term) {
            if (/\d/.test(ch)) digits += ch;
            else if (units[ch] !== undefined) {
              total += BigInt(digits || "0") * (units[ch] as bigint);
              digits = "";
            } else return { value: null, error: "SyntaxError" };
          }
          value += total + BigInt(digits || "0");
        }
        if (text === "") return { value: null, error: null };
        // **上限は着地に効く**(設計書 §5)。超えたら Overflow で、値は出ない。
        if (value > BigInt(max)) return { value: null, error: "Overflow" };
        return { value: value.toString(), error: null };
      },
      percent: (text: string) => ({ value: text, error: null }),
    }),
}));

import { initLoan } from "../../loan";
import { LoanPanel } from "./LoanPanel";

function stubCalc(overrides: Partial<LoanCalc> = {}): LoanCalc {
  return {
    forward: vi.fn().mockReturnValue({
      monthlyPayment: "91855",
      totalPayment: "38579007",
      totalInterest: "8579007",
      finalPayment: "91762",
      rowsPaid: 420,
      error: null,
    }),
    principal: vi.fn().mockReturnValue({
      principal: "27761211",
      totalPayment: "35699999",
      totalInterest: "7938788",
      finalPayment: "84999",
      rowsPaid: 420,
      error: null,
    }),
    term: vi.fn().mockReturnValue({
      months: 420,
      totalPayment: "38579007",
      totalInterest: "8579007",
      finalPayment: "91762",
      error: null,
    }),
    bonusForward: vi.fn().mockReturnValue({
      monthlyPayment: "73484",
      bonusPayment: "276219",
      bonusRows: 70,
      totalPayment: "38600000",
      totalInterest: "8600000",
      monthlyFinalPayment: "46013",
      bonusFinalPayment: "276227",
      error: null,
    }),
    bonusPrincipal: vi.fn().mockReturnValue({
      monthlyPrincipal: "26128204",
      bonusPrincipal: "5430487",
      totalPrincipal: "31558691",
      totalPayment: "40599999",
      totalInterest: "9041302",
      error: null,
    }),
    ...overrides,
  };
}

async function renderPanel(calc: LoanCalc = stubCalc()) {
  vi.mocked(initLoan).mockResolvedValue(calc);
  render(<LoanPanel />);
  // 読み込みの解決を待ってから抜ける。待たずに終わると、後続のテスト実行中に
  // act() 外の state 更新が起きて警告が出る。
  await screen.findByRole("button", { name: "借入額を入力" });
  return calc;
}

/** アクセシブルネームでキーを押す。 */
async function press(names: string[]) {
  for (const name of names) {
    await userEvent.click(screen.getByRole("button", { name }));
  }
}

const echo = () => screen.getByTestId("display-echo");
const main = () => screen.getByTestId("display-main");

/** 住宅基準例: 3000万 / 1.5% / 420 か月(golden の値)。 */
async function fillHousingExample() {
  await press([
    "借入額を入力",
    "3",
    "0",
    "0",
    "0",
    "万",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "返済期間を入力",
    "4",
    "2",
    "0",
  ]);
}

describe("LoanPanel（電卓）", () => {
  it("names the panel and its sections in Japanese", async () => {
    await renderPanel();
    expect(
      screen.getByRole("region", { name: "金融計算" }),
    ).toBeInTheDocument();
    for (const name of ["求めるもの", "入力する項目", "数字と演算のキー"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });

  it("types into the active field and shows it in the echo", async () => {
    await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万"]);
    expect(echo()).toHaveTextContent("借入額 3000万円");
  });

  it("keeps each field's entry when the active field changes", async () => {
    await renderPanel();
    await press([
      "借入額を入力",
      "3",
      "0",
      "0",
      "0",
      "万",
      "年利を入力",
      "1",
      "小数点",
      "5",
    ]);
    expect(echo()).toHaveTextContent("年利 1.5%");
    // 項目を戻すと、その項目に入っている値が echo に出る(設計書 §7)。
    await press(["借入額を入力"]);
    expect(echo()).toHaveTextContent("借入額 3000万円");
  });

  it("computes once the fields the mode needs are filled", async () => {
    const calc = await renderPanel();
    await fillHousingExample();
    await waitFor(() => {
      expect(main()).toHaveTextContent("91,855 円");
    });
    // コアへ渡るのは素の数字列(カンマも単位も無い)。
    expect(calc.forward).toHaveBeenLastCalledWith("30000000", "1.5", 420, "0");
  });

  it("closes the keys a field cannot take", async () => {
    await renderPanel();
    await press(["年利を入力"]);
    expect(screen.getByRole("button", { name: "万" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3桁のゼロ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "小数点" })).toBeEnabled();

    await press(["借入額を入力"]);
    expect(screen.getByRole("button", { name: "小数点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3桁のゼロ" })).toBeEnabled();

    await press(["返済期間を入力"]);
    expect(screen.getByRole("button", { name: "小数点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "万" })).toBeDisabled();
  });

  it("closes the unit keys until a digit is there, and after a smaller unit", async () => {
    await renderPanel();
    await press(["借入額を入力"]);
    expect(screen.getByRole("button", { name: "万" })).toBeDisabled();
    await press(["3", "0", "0", "0"]);
    expect(screen.getByRole("button", { name: "万" })).toBeEnabled();
    await press(["万"]);
    // 万 のあとに 億 は無い(設計書 §5)。押せない。
    expect(screen.getByRole("button", { name: "億" })).toBeDisabled();
  });

  it("marks the mode and the active field as pressed", async () => {
    await renderPanel();
    expect(
      screen.getByRole("button", { name: "月々の返済額を求める" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "借入額を入力" }),
    ).toHaveAttribute("aria-pressed", "true");
    await press(["借入可能額を求める"]);
    expect(
      screen.getByRole("button", { name: "借入可能額を求める" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("does not make the digits look like toggles", async () => {
    // 数字キーに aria-pressed が付くと、読み上げが全キーをトグルとして扱う。
    await renderPanel();
    expect(screen.getByRole("button", { name: "7" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("closes the field the mode is solving for", async () => {
    await renderPanel();
    // 月額モードでは月々の返済額が答なので、項目としては押せない。
    expect(
      screen.getByRole("button", { name: "月々の返済額を入力" }),
    ).toBeDisabled();
    await press(["借入可能額を求める"]);
    expect(
      screen.getByRole("button", { name: "月々の返済額を入力" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "借入額を入力" })).toBeDisabled();
  });

  it("offers the residual only in the payment mode", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: "残価を入力" })).toBeEnabled();
    await press(["借入可能額を求める"]);
    expect(screen.getByRole("button", { name: "残価を入力" })).toBeDisabled();
    await press(["返済期間を求める"]);
    expect(screen.getByRole("button", { name: "残価を入力" })).toBeDisabled();
  });

  it("closes the bonus in the term mode", async () => {
    await renderPanel();
    await press(["返済期間を求める"]);
    expect(
      screen.getByRole("button", { name: /ボーナス.*を入力/ }),
    ).toBeDisabled();
  });

  it("keeps the residual and the bonus from being used together", async () => {
    await renderPanel();
    await press(["残価を入力", "1", "2", "0", "0", "万"]);
    expect(
      screen.getByRole("button", { name: "ボーナス返済分（元本）を入力" }),
    ).toBeDisabled();
  });

  it("does not let a residual from another mode block the bonus", async () => {
    // 排他は月額モードだけ(設計書 §6)。借入可能額モードでは残価は計算に
    // 使われないので、残っている値でボーナスタブを塞がない。ここが退行
    // すると、モードを行き来した人だけがボーナスを打てなくなる。
    await renderPanel();
    await press(["残価を入力", "1", "2", "0", "0", "万"]);
    expect(
      screen.getByRole("button", { name: "ボーナス返済分（元本）を入力" }),
    ).toBeDisabled();

    await press(["借入可能額を求める"]);
    expect(
      screen.getByRole("button", { name: "ボーナス回の返済額を入力" }),
    ).toBeEnabled();
  });

  it("keeps the bonus meanings apart", async () => {
    // モードで意味が変わる欄。値を混ぜない(設計書 §6)。
    await renderPanel();
    await press(["ボーナス返済分（元本）を入力", "6", "0", "0", "万"]);
    expect(echo()).toHaveTextContent("600万");

    await press(["借入可能額を求める"]);
    // 借入可能額モードのボーナスは「回の返済額」で、まだ空。
    await press(["ボーナス回の返済額を入力"]);
    expect(echo()).toHaveTextContent("ボーナス回の返済額");
    expect(echo()).not.toHaveTextContent("600万");
  });

  it("walks back one stage at a time with DEL", async () => {
    await renderPanel();
    await press(["借入額を入力", "1", "億", "2", "0", "0", "0"]);
    expect(echo()).toHaveTextContent("1億2000");
    await press(["1文字消去"]);
    expect(echo()).toHaveTextContent("1億200");
    await press(["1文字消去", "1文字消去", "1文字消去", "1文字消去"]);
    expect(echo()).toHaveTextContent("借入額 1円");
  });

  it("clears only the active field with AC", async () => {
    await renderPanel();
    await press([
      "借入額を入力",
      "3",
      "0",
      "0",
      "0",
      "万",
      "年利を入力",
      "1",
      "小数点",
      "5",
      "この項目を消去",
    ]);
    expect(echo()).toHaveTextContent("年利");
    expect(echo()).not.toHaveTextContent("1.5");
    await press(["借入額を入力"]);
    expect(echo()).toHaveTextContent("3000万");
  });

  it("stays neutral until the mode has what it needs", async () => {
    const calc = await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万"]);
    expect(main()).toBeEmptyDOMElement();
    expect(calc.forward).not.toHaveBeenCalled();
  });

  it("moves the active field off one the new mode cannot take", async () => {
    // 残価は借入可能額モードでは受けない。active が残ったままだと、無効な
    // タブが押下状態のまま「残価を入力中」と名乗り、打鍵が計算に使われない
    // 欄に落ちる。
    await renderPanel();
    await press(["残価を入力"]);
    expect(screen.getByTestId("loan-field")).toHaveTextContent("残価を入力中");

    await press(["借入可能額を求める"]);
    const residual = screen.getByRole("button", { name: "残価を入力" });
    expect(residual).toBeDisabled();
    expect(residual).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("loan-field")).not.toHaveTextContent(
      "残価を入力中",
    );
  });

  it("moves off the bonus when the term mode closes it", async () => {
    await renderPanel();
    await press(["ボーナス返済分（元本）を入力"]);
    await press(["返済期間を求める"]);
    const bonus = screen.getByRole("button", { name: /ボーナス.*を入力/ });
    expect(bonus).toBeDisabled();
    expect(bonus).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps an out-of-range term from producing an answer", async () => {
    // **上限は打鍵ではなく着地に効く**(設計書 §5)。以前は 4 桁で打ち止めに
    // していたが、単位が入ると `9999年9999` のように**打鍵は短くても合成後が
    // 大きい**形が作れる。いまは打った通りに出したうえで、定義域を超えた値は
    // コアが Overflow にし、答えが出ない——u32 で折り返してもっともらしい
    // 誤答が出る経路が閉じている。
    await renderPanel();
    await press(["借入額を入力", "3", "0", "0", "0", "万"]);
    await press(["年利を入力", "1", "小数点", "5"]);
    await press(["返済期間を入力", "1", "2", "3", "4", "5", "6"]);
    expect(echo()).toHaveTextContent("期間 123456か月");
    // 1200 を超えるので着地しない = 答えは出ない。
    expect(main()).toBeEmpty();
  });

  it("puts the answer on the main line and the breakdown below", async () => {
    await renderPanel();
    await fillHousingExample();
    await waitFor(() => {
      expect(main()).toHaveTextContent("91,855 円");
    });
    const breakdown = screen.getByTestId("loan-breakdown");
    expect(breakdown).toHaveTextContent("総支払額");
    expect(breakdown).toHaveTextContent("38,579,007 円");
    expect(breakdown).toHaveTextContent("総利息");
    // 主表示は 1 本(内訳は下。設計書 §7)。
    expect(main()).not.toHaveTextContent("総支払額");
  });

  it("names the mode and the active field in the status line", async () => {
    await renderPanel();
    expect(screen.getByTestId("loan-mode")).toHaveTextContent("月額を求める");
    expect(screen.getByTestId("loan-field")).toHaveTextContent(
      "借入額を入力中",
    );
    await press(["年利を入力"]);
    expect(screen.getByTestId("loan-field")).toHaveTextContent("年利を入力中");
  });

  it("keeps the disclaimer on screen and off the alert channel", async () => {
    // 決定的概算であることの但し書きは常設(M6 設計書 §0)。
    await renderPanel();
    expect(
      screen.getByText(/金融機関の計算方法により異なります/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error from the core on the main line", async () => {
    const calc = await renderPanel(
      stubCalc({
        term: vi.fn().mockReturnValue({
          months: null,
          totalPayment: null,
          totalInterest: null,
          finalPayment: null,
          error: "SyntaxError",
        }),
      }),
    );
    await press([
      "返済期間を求める",
      "借入額を入力",
      "1",
      "0",
      "0",
      "万",
      "年利を入力",
      "1",
      "2",
      "月々の返済額を入力",
      "1",
      "万",
    ]);
    await waitFor(() => {
      expect(main()).toHaveTextContent("Math ERROR");
    });
    expect(main()).toHaveAttribute("data-error", "SyntaxError");
    expect(calc.term).toHaveBeenCalled();
  });

  it("shows the residual as the final payment when there is one", async () => {
    const calc = await renderPanel(
      stubCalc({
        forward: vi.fn().mockReturnValue({
          monthlyPayment: "37536",
          totalPayment: "3414605",
          totalInterest: "414605",
          finalPayment: "1200000",
          rowsPaid: 60,
          error: null,
        }),
      }),
    );
    await press([
      "借入額を入力",
      "3",
      "0",
      "0",
      "万",
      "年利を入力",
      "3",
      "小数点",
      "9",
      "返済期間を入力",
      "6",
      "0",
      "残価を入力",
      "1",
      "2",
      "0",
      "万",
    ]);
    await waitFor(() => {
      expect(main()).toHaveTextContent("37,536 円");
    });
    expect(screen.getByTestId("loan-breakdown")).toHaveTextContent(
      "最終回（残価）",
    );
    expect(calc.forward).toHaveBeenLastCalledWith(
      "3000000",
      "3.9",
      60,
      "1200000",
    );
  });

  it("says so when the calculation engine cannot be loaded", async () => {
    vi.mocked(initLoan).mockRejectedValue(new Error("wasm unavailable"));
    render(<LoanPanel />);
    const alert = await screen.findByTestId("loan-load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("lays down three zeros, in every field", async () => {
    // **出口の検査**(設計書 §3)。以前は金額だけが 1 個しか入らなかった
    // ——同じイベントで 3 回書き、3 回とも同じ値を読んでいたためである。
    // いまは全項目が同じ機構なので、項目ごとに壊れることが無い。
    await renderPanel();
    await press(["借入額を入力", "3", "3桁のゼロ"]);
    expect(echo()).toHaveTextContent("借入額 3000円");
    await press(["返済期間を入力", "1", "3桁のゼロ"]);
    expect(echo()).toHaveTextContent("期間 1000か月");
  });

  it("types an expression and settles it with =", async () => {
    // 式はコアが評価する。単位も混ぜられる(裁定 Q13)。
    await renderPanel();
    await press([
      "借入額を入力",
      "3",
      "0",
      "0",
      "0",
      "万",
      "足す",
      "5",
      "0",
      "万",
    ]);
    expect(echo()).toHaveTextContent("借入額 3000万+50万円");
    await press(["計算する"]);
    expect(echo()).toHaveTextContent("借入額 30500000円");
  });
});

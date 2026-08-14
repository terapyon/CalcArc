import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LoanCalc } from "../../loan";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。
vi.mock("../../loan", () => ({
  initLoan: vi.fn(),
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
      screen.getByRole("region", { name: "ローン計算" }),
    ).toBeInTheDocument();
    for (const name of ["求めるもの", "入力する項目", "数字と単位のキー"]) {
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

  it("says so when the calculation engine cannot be loaded", async () => {
    vi.mocked(initLoan).mockRejectedValue(new Error("wasm unavailable"));
    render(<LoanPanel />);
    const alert = await screen.findByTestId("loan-load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

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
  await screen.findByLabelText("借入額");
  return calc;
}

describe("LoanPanel", () => {
  it("names the panel and its fields in Japanese", async () => {
    await renderPanel();
    expect(
      screen.getByRole("region", { name: "ローン計算" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("何を求めるか")).toBeInstanceOf(
      HTMLSelectElement,
    );
    for (const label of [
      "借入額",
      "年利(%)",
      "返済回数(月)",
      "月々の返済額",
      "残価",
      "ボーナス返済分(元本)",
    ]) {
      expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLInputElement);
    }
  });

  it("keeps the disclaimer on screen at all times, and not as an alert", async () => {
    // 設計書 §0: 決定的概算であることの但し書きは常設。
    await renderPanel();
    expect(
      screen.getByText(/金融機関の計算方法により異なります/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays neutral — no error, no result — while fields are empty", async () => {
    const calc = await renderPanel();
    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent("Math ERROR");
    expect(status).toBeEmptyDOMElement();
    expect(calc.forward).not.toHaveBeenCalled();
  });

  it("computes the monthly payment once the fields it needs are filled", async () => {
    const calc = await renderPanel();
    await userEvent.type(screen.getByLabelText("借入額"), "30000000");
    await userEvent.type(screen.getByLabelText("年利(%)"), "1.5");
    await userEvent.type(screen.getByLabelText("返済回数(月)"), "420");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("91,855 円");
    });
    expect(screen.getByRole("status")).toHaveTextContent("総利息");
    expect(calc.forward).toHaveBeenLastCalledWith("30000000", "1.5", 420, "0");
  });

  it("disables the field the chosen mode is solving for, keeping its value", async () => {
    await renderPanel();
    await userEvent.type(screen.getByLabelText("借入額"), "30000000");
    // 月額モードでは月々の返済額が答なので入力できない。
    expect(screen.getByLabelText("月々の返済額")).toBeDisabled();
    expect(screen.getByLabelText("借入額")).toBeEnabled();

    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "principal",
    );
    // 借入可能額モードでは借入額が答。値は消えない。
    expect(screen.getByLabelText("借入額")).toBeDisabled();
    expect(screen.getByLabelText("借入額")).toHaveValue("30000000");
    expect(screen.getByLabelText("月々の返済額")).toBeEnabled();
  });

  it("offers the residual only in the payment mode (design §3)", async () => {
    await renderPanel();
    expect(screen.getByLabelText("残価")).toBeEnabled();

    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "principal",
    );
    expect(screen.getByLabelText("残価")).toBeDisabled();
    expect(screen.getByLabelText("残価")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "term",
    );
    expect(screen.getByLabelText("残価")).toBeDisabled();
  });

  it("disables the bonus field in the term mode (design §4-a)", async () => {
    // 期間 × ボーナスは閉形式で解けないので M6 では扱わない。
    await renderPanel();
    expect(screen.getByLabelText("ボーナス返済分(元本)")).toBeEnabled();

    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "term",
    );
    const bonus = screen.getByLabelText("ボーナス返済分(元本)");
    expect(bonus).toBeDisabled();
    expect(bonus).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the residual and the bonus from being used together", async () => {
    // コアに「残価つきボーナス併用」のモデルが無い。片方を埋めると他方が閉じる。
    await renderPanel();
    await userEvent.type(screen.getByLabelText("残価"), "1200000");
    expect(screen.getByLabelText("ボーナス返済分(元本)")).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("残価"));
    expect(screen.getByLabelText("ボーナス返済分(元本)")).toBeEnabled();
    await userEvent.type(
      screen.getByLabelText("ボーナス返済分(元本)"),
      "6000000",
    );
    expect(screen.getByLabelText("残価")).toBeDisabled();
  });

  it("routes to the bonus calculation when a bonus amount is given", async () => {
    const calc = await renderPanel();
    await userEvent.type(screen.getByLabelText("借入額"), "30000000");
    await userEvent.type(screen.getByLabelText("年利(%)"), "1.5");
    await userEvent.type(screen.getByLabelText("返済回数(月)"), "420");
    await userEvent.type(
      screen.getByLabelText("ボーナス返済分(元本)"),
      "6000000",
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "ボーナス回の返済額",
      );
    });
    expect(calc.bonusForward).toHaveBeenLastCalledWith(
      "30000000",
      "6000000",
      "1.5",
      420,
    );
  });

  it("solves for the term when that is what is asked", async () => {
    const calc = await renderPanel();
    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "term",
    );
    await userEvent.type(screen.getByLabelText("借入額"), "30000000");
    await userEvent.type(screen.getByLabelText("年利(%)"), "1.5");
    await userEvent.type(screen.getByLabelText("月々の返済額"), "91855");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("420 か月");
    });
    expect(calc.term).toHaveBeenLastCalledWith("30000000", "1.5", "91855");
  });

  it("shows an error when the core reports one", async () => {
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
    await userEvent.selectOptions(
      screen.getByLabelText("何を求めるか"),
      "term",
    );
    await userEvent.type(screen.getByLabelText("借入額"), "1000000");
    await userEvent.type(screen.getByLabelText("年利(%)"), "12");
    await userEvent.type(screen.getByLabelText("月々の返済額"), "10000");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Math ERROR");
    });
    expect(
      screen.getByRole("status").querySelector("[data-error='SyntaxError']"),
    ).not.toBeNull();
    expect(calc.term).toHaveBeenCalled();
  });

  it("says so when the calculation engine cannot be loaded", async () => {
    vi.mocked(initLoan).mockRejectedValue(new Error("wasm unavailable"));
    render(<LoanPanel />);
    const alert = await screen.findByTestId("loan-load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

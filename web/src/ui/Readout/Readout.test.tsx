import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Readout } from "./Readout";

const status = [
  { testId: "display-angle", ariaLabel: "角度の単位", text: "DEG" },
];

describe("Readout", () => {
  it("shows the main value and the status items", () => {
    render(<Readout entries={[]} main="42" status={status} />);
    expect(screen.getByTestId("display-main")).toHaveTextContent("42");
    expect(
      screen.getByRole("status", { name: "角度の単位" }),
    ).toHaveTextContent("DEG");
  });

  it("keeps the echo line as a place even when there is no input", () => {
    render(<Readout entries={[]} main="0" status={status} />);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("");
  });

  it("shows a single unnamed entry the way Scientific always did", () => {
    // Scientific は式を 1 件で渡す。**名前が無いので見た目は変わらない**
    // ——ここが崩れると S2 のエコーが壊れる(設計書 §2)。
    render(
      <Readout
        entries={[{ label: "", value: "3 + 4 ×", active: true }]}
        main="4"
        status={status}
      />,
    );
    expect(screen.getByTestId("display-echo")).toHaveTextContent("3 + 4 ×");
    expect(screen.getByTestId("display-entries-done")).toBeEmptyDOMElement();
  });

  it("keeps the entered fields on screen, with the active one apart", () => {
    // 項目を切り替えても**計算根拠が消えない**(設計書 §2 の症状 2)。
    render(
      <Readout
        entries={[
          { label: "借入額", value: "3000万" },
          { label: "年利", value: "1.5", active: true },
          { label: "期間", value: "35年" },
        ]}
        main="91,855"
        status={status}
      />,
    );
    const active = screen.getByTestId("display-entry-active");
    expect(active).toHaveTextContent("年利 1.5");
    const done = screen.getByTestId("display-entries-done");
    expect(done).toHaveTextContent("借入額 3000万");
    expect(done).toHaveTextContent("期間 35年");
    // アクティブは入力済みの側に混ざらない。
    expect(done).not.toHaveTextContent("年利");
  });

  it("shows the label alone while the active field is empty", () => {
    render(
      <Readout
        entries={[{ label: "借入額", value: "", active: true }]}
        main=""
        status={status}
      />,
    );
    expect(screen.getByTestId("display-entry-active")).toHaveTextContent(
      "借入額",
    );
  });

  it("marks an error on the main value", () => {
    render(
      <Readout
        entries={[]}
        main="Math ERROR"
        error="DivisionByZero"
        status={status}
      />,
    );
    expect(screen.getByTestId("display-main")).toHaveAttribute(
      "data-error",
      "DivisionByZero",
    );
  });

  it("takes only strings — it knows nothing about the calculation core", () => {
    // Loan と Data Scale が同じ部品を使う(設計書 §6)。DisplayState を
    // 受け取らないことが、その再利用の条件である。
    render(
      <Readout
        entries={[{ label: "借入額", value: "3,000万円", active: true }]}
        main="91,855 円"
        status={[
          { testId: "display-mode", ariaLabel: "求めるもの", text: "月額" },
        ]}
      />,
    );
    expect(screen.getByTestId("display-main")).toHaveTextContent("91,855 円");
    expect(screen.getByTestId("display-echo")).toHaveTextContent("3,000万円");
  });
});

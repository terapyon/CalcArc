import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Readout } from "./Readout";

const status = [
  { testId: "display-angle", ariaLabel: "角度の単位", text: "DEG" },
];

describe("Readout", () => {
  it("shows the main value and the status items", () => {
    render(<Readout echo="" main="42" status={status} />);
    expect(screen.getByTestId("display-main")).toHaveTextContent("42");
    expect(
      screen.getByRole("status", { name: "角度の単位" }),
    ).toHaveTextContent("DEG");
  });

  it("keeps the echo line as a place even when empty", () => {
    // S1 では常に空。S2 が中身を入れる(設計書 §5)。場所が先に決まって
    // いれば、S2 は「無効を有効にする」だけで済む。
    render(<Readout echo="" main="0" status={status} />);
    expect(screen.getByTestId("display-echo")).toBeEmptyDOMElement();
  });

  it("shows the echo when it is given one", () => {
    render(<Readout echo="3 + 4 ×" main="4" status={status} />);
    expect(screen.getByTestId("display-echo")).toHaveTextContent("3 + 4 ×");
  });

  it("marks an error on the main value", () => {
    render(
      <Readout
        echo=""
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
        echo="3,000万円"
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

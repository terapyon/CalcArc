import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("names the app, its version and its author in one link", () => {
    // **1 行まるごとが 1 つのリンク**(0.2.0 設計書 §5)。小さい文字の上で
    // 標的を 2 つに割ると押し分けられない。
    render(<Footer />);
    const link = screen.getByRole("link", {
      name: `CalcArc ${__APP_VERSION__} @terapyon`,
    });
    expect(link).toHaveAttribute("href", "https://github.com/terapyon/CalcArc");
  });

  it("opens the repository without handing it the opener", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /CalcArc/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says the results carry no warranty", () => {
    render(<Footer />);
    expect(screen.getByTestId("footer-disclaimer")).toHaveTextContent(
      "計算結果は無保証です。重要な判断の根拠にしないでください。",
    );
  });
});

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// App が確かめたいのはハッシュから module を導いて出し分けることであって、
// 各パネルの中身(WASM 読み込みなど)ではない。パネルはそれぞれの
// テストファイルで検査済みなので、ここではスタブに差し替える。
vi.mock("./ui/ScientificPanel", () => ({
  ScientificPanel: () => <p data-testid="scientific-panel" />,
}));
vi.mock("./ui/DataScale/DataScalePanel", () => ({
  DataScalePanel: () => <p data-testid="datascale-panel" />,
}));
vi.mock("./ui/Loan/LoanPanel", () => ({
  LoanPanel: () => <p data-testid="loan-panel" />,
}));
vi.mock("./ui/UpdateToast/UpdateToast", () => ({
  UpdateToast: () => <p data-testid="update-toast" />,
}));

import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    // location.hash はテスト間で持ち越らないよう、毎回既定に戻す。
    window.location.hash = "";
  });

  it("carries the update toast in the shell, outside main", () => {
    render(<App />);
    const toast = screen.getByTestId("update-toast");
    expect(toast).toBeInTheDocument();
    // <main> はモジュールのもの。トーストはシェルのものなので外に置く。
    expect(screen.getByRole("main")).not.toContainElement(toast);
  });

  it("shows Scientific by default", () => {
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("shows Data Scale when the hash says so", () => {
    window.location.hash = "#data-scale";
    render(<App />);
    expect(screen.getByTestId("datascale-panel")).toBeInTheDocument();
  });

  it("shows Finance when the hash says so", () => {
    window.location.hash = "#finance";
    render(<App />);
    expect(screen.getByTestId("loan-panel")).toBeInTheDocument();
    // 1 モジュールだけが <main> に居ること(出し分けの取りこぼしを防ぐ)。
    expect(screen.queryByTestId("scientific-panel")).toBeNull();
    expect(screen.queryByTestId("datascale-panel")).toBeNull();
  });

  it("does not route the old #loan hash any more", () => {
    // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
    // 不明ハッシュの既定どおり Scientific に倒れる——これは仕様である。
    window.location.hash = "#loan";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("falls back to Scientific for a hash it does not know", () => {
    window.location.hash = "#nope";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });
});

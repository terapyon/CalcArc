import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// App が確かめたいのはハッシュから module を導いて出し分けることであって、
// 各パネルの中身(WASM 読み込みなど)ではない。パネルはそれぞれの
// テストファイルで検査済みなので、ここではスタブに差し替える。
vi.mock("./ui/ScientificPanel", () => ({
  ScientificPanel: () => <p data-testid="scientific-panel" />,
}));
vi.mock("./ui/Scale/ScalePanel", () => ({
  ScalePanel: () => <p data-testid="scale-panel" />,
}));
vi.mock("./ui/Convert/ConvertPanel", () => ({
  ConvertPanel: () => <p data-testid="convert-panel" />,
}));
vi.mock("./ui/Finance/FinancePanel", () => ({
  FinancePanel: () => <p data-testid="finance-panel" />,
}));
vi.mock("./ui/UpdateToast/UpdateToast", () => ({
  UpdateToast: () => <p data-testid="update-toast" />,
}));
vi.mock("./ui/Footer/Footer", () => ({
  Footer: () => <p data-testid="footer" />,
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

  it("carries the footer in the shell, outside main", () => {
    // トーストと同じ理屈——モジュールに属さないものはシェルが持つ。
    render(<App />);
    const footer = screen.getByTestId("footer");
    expect(footer).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toContainElement(footer);
  });

  it("shows Scientific by default", () => {
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("shows Data Scale when the hash says so", () => {
    window.location.hash = "#scale/data-scale";
    render(<App />);
    expect(screen.getByTestId("scale-panel")).toBeInTheDocument();
  });

  it("shows Scale for the llm category too", () => {
    // ScalePanel 自体がカテゴリを振り分ける。App が確かめるのは
    // module === "scale" のときに ScalePanel が出ることだけ。
    window.location.hash = "#scale/llm";
    render(<App />);
    expect(screen.getByTestId("scale-panel")).toBeInTheDocument();
  });

  it("shows the convert placeholder when the hash says so", () => {
    window.location.hash = "#convert";
    render(<App />);
    expect(screen.getByTestId("convert-panel")).toBeInTheDocument();
  });

  it("does not route the old #data-scale hash any more", () => {
    // **互換は作らない**(設計書 §1-4)。旧 #loan と同じ扱いである。
    window.location.hash = "#data-scale";
    render(<App />);
    expect(screen.getByTestId("scientific-panel")).toBeInTheDocument();
  });

  it("shows Finance when the hash says so", () => {
    window.location.hash = "#finance";
    render(<App />);
    expect(screen.getByTestId("finance-panel")).toBeInTheDocument();
    // 1 モジュールだけが <main> に居ること(出し分けの取りこぼしを防ぐ)。
    expect(screen.queryByTestId("scientific-panel")).toBeNull();
    expect(screen.queryByTestId("scale-panel")).toBeNull();
    expect(screen.queryByTestId("convert-panel")).toBeNull();
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

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

import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    // location.hash はテスト間で持ち越らないよう、毎回既定に戻す。
    window.location.hash = "";
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
});

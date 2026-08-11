import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom では WASM を読み込めないので、計算層ごと差し替える。
// ここで確かめたいのは App の分岐であって計算ではない。
vi.mock("./calc", () => ({ initCalc: vi.fn() }));

import { App } from "./App";
import { initCalc } from "./calc";

describe("App", () => {
  it("says so when the calculation engine cannot be loaded", async () => {
    // 読み込みに失敗したまま Loading の表示で固まると、利用者には
    // 「遅い」のか「壊れた」のか区別がつかない。
    vi.mocked(initCalc).mockRejectedValue(new Error("wasm unavailable"));
    render(<App />);
    const alert = await screen.findByTestId("load-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});

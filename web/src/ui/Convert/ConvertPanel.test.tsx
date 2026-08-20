import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// 器の検査に WASM は要らない。**解決しない Promise** を返して、盤面を
// 読み込み中のまま描かせる——盤面そのものは UnitPanel.test.tsx が見る。
vi.mock("../../convert", () => ({
  initConvert: () => new Promise(() => {}),
}));

import { ConvertPanel } from "./ConvertPanel";

const select = () => screen.getByRole("combobox", { name: "計算の種類" });
const echo = () => screen.getByTestId("display-echo");

describe("ConvertPanel", () => {
  it("lists every category exactly once", () => {
    render(<ConvertPanel category="length" />);
    const labels = Array.from(select().querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    // **件数を主張する。** ループだけだと、選択肢が 0 個になった日も緑になる。
    expect(labels).toEqual(["長さ", "質量", "温度"]);
  });

  it("shows the panel for the category in the route", () => {
    // **押せて何も起きない面を作らない。** 分岐が 3 つあるなら 3 つとも
    // 描いて確かめる——面の名前は 3 カテゴリで同じ(`単位変換`)なので、
    // 出ている単位で見分ける。
    const seen: string[] = [];
    for (const [category, from, to] of [
      ["length", "km", "mi"],
      ["mass", "kg", "lb"],
      ["temperature", "°C", "°F"],
    ] as const) {
      const { unmount } = render(<ConvertPanel category={category} />);
      expect(select()).toHaveValue(category);
      expect(screen.getByRole("region", { name: "単位変換" })).toBeVisible();
      expect(echo()).toHaveTextContent(`変換元 ${from}`);
      expect(echo()).toHaveTextContent(`変換先 ${to}`);
      seen.push(category);
      unmount();
    }
    expect(seen).toHaveLength(3);
  });

  it("falls back to length when the category is unknown", () => {
    // route が既定へ倒しているので null は来ないが、型の上では来る。
    render(<ConvertPanel category={null} />);
    expect(select()).toHaveValue("length");
    expect(echo()).toHaveTextContent("変換元 km");
  });

  it("moves the hash when the select changes", async () => {
    render(<ConvertPanel category="length" />);
    await userEvent.selectOptions(select(), "temperature");
    // **画面を直接差し替えない。** hash を書き、購読が state を更新する
    // (U-0 の「hash が唯一の出所」)。
    expect(window.location.hash).toBe("#convert/temperature");
  });

  it("no longer says 準備中", () => {
    render(<ConvertPanel category="length" />);
    expect(screen.queryByText(/準備中/)).not.toBeInTheDocument();
  });
});

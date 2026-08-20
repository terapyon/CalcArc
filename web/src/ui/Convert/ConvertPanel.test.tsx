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
    // **日英を併記する**(U-0 §9 の【変更 2026-08-20】)。末尾の
    // `データ量 Data Size` は、Scale の `データ量 Data Scale` と**日本語が
    // 同じ**である——英語が無いと 2 つの系統で同じ名前になる(U-2 §2)。
    expect(labels).toEqual([
      "長さ Length",
      "質量 Mass",
      "温度 Temperature",
      "面積 Area",
      "体積 Volume",
      "速さ Speed",
      "データ量 Data Size",
      // **U-4 の 8 つ目。** `route.ts` の `CONVERT_CATEGORIES` から起こる。
      "為替 Currency",
    ]);
  });

  it("shows the panel for the category in the route", () => {
    // **押せて何も起きない面を作らない。** 分岐が 8 つあるなら 8 つとも
    // 描いて確かめる——面の名前は全カテゴリで同じ(`単位変換`)なので、
    // 出ている単位で見分ける。**単位は `UnitPanel` の既定**である。
    const seen: string[] = [];
    for (const [category, from, to] of [
      ["length", "km", "mi"],
      ["mass", "kg", "lb"],
      ["temperature", "°C", "°F"],
      ["area", "坪", "m²"],
      ["volume", "L", "gal(US)"],
      ["speed", "km/h", "mph"],
      ["data-size", "GB", "GiB"],
      // **為替はレートが無くても既定の通貨を出す**(spec §0.0-4)。
      // レートが無いのは「換算できない」ことであって、面が消えることではない。
      ["currency", "USD", "JPY"],
    ] as const) {
      const { unmount } = render(<ConvertPanel category={category} />);
      expect(select()).toHaveValue(category);
      expect(screen.getByRole("region", { name: "単位変換" })).toBeVisible();
      expect(echo()).toHaveTextContent(`変換元 ${from}`);
      expect(echo()).toHaveTextContent(`変換先 ${to}`);
      seen.push(category);
      unmount();
    }
    expect(seen).toHaveLength(8);
  });

  it("falls back to length when the category is unknown", () => {
    // route が既定へ倒しているので null は来ないが、型の上では来る。
    render(<ConvertPanel category={null} />);
    expect(select()).toHaveValue("length");
    expect(echo()).toHaveTextContent("変換元 km");
  });

  it("rebuilds the board when the category changes, instead of carrying the old input over (key={current})", async () => {
    // レビュー(round 1, Important 2a)の実測: `<UnitPanel key={current}>` の
    // `key` を外すと、カテゴリを切り替えても盤面は作り直されず、前の
    // カテゴリの entry と単位を新しいカテゴリのものとして評価してしまう
    // ——実ブラウザでは「長さ→温度」で `Math ERROR` になる。**既存の巡回
    // 検査は毎回 unmount()/goto するので remount 経路を通らない**。ここは
    // 同じ `ConvertPanel` を rerender して、実際に区画を切り替える経路を
    // 通す。
    const { rerender } = render(<ConvertPanel category="length" />);
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    await userEvent.click(screen.getByRole("button", { name: "0" }));
    await userEvent.click(screen.getByRole("button", { name: "0" }));
    expect(echo()).toHaveTextContent("値 100");
    expect(echo()).toHaveTextContent("変換元 km");

    rerender(<ConvertPanel category="temperature" />);

    // 値も単位も、温度の盤面としてまっさらに作り直されていなければならない
    // ——`key` が無ければここで「値 100」と「変換元 km」が生き残る。
    expect(echo()).not.toHaveTextContent("100");
    expect(echo()).not.toHaveTextContent("変換元 km");
    expect(echo()).toHaveTextContent("変換元 °C");
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

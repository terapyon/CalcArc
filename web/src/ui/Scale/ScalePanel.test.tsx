import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScalePanel } from "./ScalePanel";

describe("ScalePanel", () => {
  it("shows the data scale panel for the default category", () => {
    render(<ScalePanel category="data-scale" />);
    expect(
      screen.getByRole("region", { name: "データスケール計算" }),
    ).toBeInTheDocument();
  });

  it("lists every category exactly once", () => {
    render(<ScalePanel category="data-scale" />);
    const select = screen.getByRole("combobox", { name: "計算の種類" });
    const labels = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    // **件数を主張する。** ループだけだと、選択肢が 0 個になった日も緑になる。
    // **日英を併記する**(U-0 §9 の【変更 2026-08-20】)。日本語だけに戻すと
    // Convert の `データ量`(単位換算)と見分けが付かなくなる。
    expect(labels).toEqual([
      "データ量 Data Scale",
      "LLM のメモリ LLM Memory",
      "データ転送 Data Transfer",
    ]);
  });

  it("moves the hash when the category changes", async () => {
    render(<ScalePanel category="data-scale" />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "計算の種類" }),
      "llm",
    );
    // **画面を直接差し替えない。** hash を書き、購読が state を更新する
    // (U-0 の「hash が唯一の出所」)。
    expect(window.location.hash).toBe("#scale/llm");
  });

  it("shows a different panel for each category", () => {
    // **押せて何も起きない面を作らない**(Global Constraints)。
    // 分岐が 3 つあるなら、3 つとも描いて確かめる——2 つを
    // 「たぶん同じ形だから」で飛ばすと、そこだけ観測されない面になる。
    const seen: string[] = [];
    for (const [category, name] of [
      ["data-scale", "データスケール計算"],
      ["llm", "LLM のメモリ計算"],
      ["transfer", "データ転送量計算"],
    ] as const) {
      const { unmount } = render(<ScalePanel category={category} />);
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
      seen.push(category);
      unmount();
    }
    expect(seen).toHaveLength(3);
  });
});

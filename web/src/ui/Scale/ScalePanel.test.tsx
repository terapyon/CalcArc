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
    expect(labels).toEqual(["データ量", "LLM のメモリ", "データ転送"]);
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
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Nav } from "./Nav";

describe("Nav", () => {
  it("names the nav landmark in Japanese, matching the rest of the UI", () => {
    // Display/Keypad/DataScalePanel のアクセシブルネームはすべて日本語
    // (「角度の単位」「電卓キーパッド」「データスケール計算」等)。ここだけ
    // 英語だと読み上げの言語が揃わない(Task 4 のレビューで固定された流儀)。
    render(<Nav current="scientific" />);
    expect(
      screen.getByRole("navigation", { name: "計算機の切り替え" }),
    ).toBeInTheDocument();
  });

  it("links to both modules by hash", () => {
    render(<Nav current="scientific" />);
    expect(screen.getByRole("link", { name: "Scientific" })).toHaveAttribute(
      "href",
      "#scientific",
    );
    expect(screen.getByRole("link", { name: "Data Scale" })).toHaveAttribute(
      "href",
      "#data-scale",
    );
  });

  it("marks only the current tab with aria-current", () => {
    render(<Nav current="data-scale" />);
    expect(screen.getByRole("link", { name: "Data Scale" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Scientific" }),
    ).not.toHaveAttribute("aria-current");
  });
});

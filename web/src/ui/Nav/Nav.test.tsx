import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Nav } from "./Nav";

describe("Nav", () => {
  it("names the nav landmark in Japanese, matching the rest of the UI", () => {
    render(<Nav current="scientific" />);
    expect(
      screen.getByRole("navigation", { name: "計算機の切り替え" }),
    ).toBeInTheDocument();
  });

  it("links to every module by hash", () => {
    render(<Nav current="scientific" />);
    expect(screen.getByRole("link", { name: "Scientific" })).toHaveAttribute(
      "href",
      "#scientific",
    );
    expect(screen.getByRole("link", { name: "Convert" })).toHaveAttribute(
      "href",
      "#convert",
    );
    // **既定カテゴリまで書く**(設計書 §3)。`#scale` にすると同じ画面に
    // 2 つの URL ができ、押した後の URL と深いリンクが食い違う。
    expect(screen.getByRole("link", { name: "Scale" })).toHaveAttribute(
      "href",
      "#scale/data-scale",
    );
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "href",
      "#finance",
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("marks only the current tab with aria-current", () => {
    render(<Nav current="finance" />);
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Scientific", "Convert", "Scale"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("marks the scale tab when that is the current one", () => {
    render(<Nav current="scale" />);
    expect(screen.getByRole("link", { name: "Scale" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Scientific" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the convert tab when that is the current one", () => {
    render(<Nav current="convert" />);
    expect(screen.getByRole("link", { name: "Convert" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

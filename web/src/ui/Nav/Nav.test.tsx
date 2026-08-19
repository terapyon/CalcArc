import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeFromHash } from "../../route";
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

  // Nav は自分の href 一覧を route.ts の一覧とは独立に持っている(型
  // `ModuleId` だけを共有する)。この 2 つがずれても typecheck・vitest・
  // E2E のどれも赤くならない箇所を、ここで往復させて塞ぐ——`routeFromHash`
  // に Nav の href を通し、往路(href の書き方)と復路(解決結果)の両方を
  // 固定する。**2 つ目の assertion(完全一致)が本丸**: 次の作業で
  // `convert` に既定カテゴリが付いた瞬間、`href: "#convert"` は設計書
  // §3 の「href は既定カテゴリまで書く」に違反する——そのとき赤くなるのは
  // ここだけである。
  it("round-trips every href through routeFromHash", () => {
    render(<Nav current="scientific" />);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    // 過不足なし: 4 本の href が解決する module の集合が ModuleId の 4 つ
    // と一致する(1 系統の抜け・重複のどちらも検出する)。
    const resolvedModules = hrefs.map((href) => routeFromHash(href).module);
    expect(new Set(resolvedModules)).toEqual(
      new Set(["scientific", "convert", "scale", "finance"]),
    );
    expect(resolvedModules).toHaveLength(4);

    // 完全一致: href 自体が "#" + module + (category ? "/" + category : "")
    // の形になっている(設計書 §3)。routeFromHash の解決結果が正しくても、
    // href の書き方が既定カテゴリを省いていれば同じ画面に 2 つの URL が
    // でき、これは module の一致だけでは検出できない。
    for (const href of hrefs) {
      const route = routeFromHash(href);
      const expected = `#${route.module}${route.category ? `/${route.category}` : ""}`;
      expect(href).toBe(expected);
    }
  });
});

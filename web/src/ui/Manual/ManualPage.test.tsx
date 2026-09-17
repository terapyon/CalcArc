import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pdfName } from "../../../scripts/manual/markdown";
import { MANUALS, ManualPage, manualPdfPath, RELEASE_URL } from "./ManualPage";

/** リポジトリの `docs/manual/`。**冊子の綴りの出どころ**である。 */
const manualSource = (file: string) =>
  readFileSync(
    join(import.meta.dirname, "../../../../docs/manual", file),
    "utf8",
  );

describe("ManualPage", () => {
  it("offers the three manuals, in the order the page means to show them", () => {
    render(<ManualPage />);
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(names).toEqual([
      "CalcArc 簡易マニュアル",
      "CalcArc 詳細マニュアル",
      "CalcArc Quick Guide",
      "この版の Release",
      "計算機に戻る",
    ]);
  });

  it("keeps every title tied to the manual's own heading", () => {
    // **表は手で書いてある**(`screenName.ts` と同じ理由)ので、出どころとの
    // 繋がりは機械が見張るしかない。**見出しを直した日に、画面だけ古いまま
    // 残ることを止める。**
    for (const manual of MANUALS) {
      const heading = manualSource(manual.source).split("\n")[0] ?? "";
      expect(heading).toBe(`# ${manual.title}`);
    }
    // **1 度も比較しなかった格子で緑にならない**ように、数を先に言う。
    expect(MANUALS).toHaveLength(3);
  });

  it("names each PDF the way the build names it", () => {
    // **綴りの出どころは `web/scripts/manual/markdown.ts` の `pdfName`**
    // である。**ここは写しなので、1 冊ずつ突き合わせる**——名前が食い違うと、
    // 配ってある PDF は在るのにリンクの先が 404 になる。
    for (const manual of MANUALS) {
      expect(manualPdfPath(manual.stem, "9.8.7")).toBe(
        `/manual/${pdfName(manual.source, "9.8.7")}`,
      );
    }
  });

  it("puts the PDFs under /manual/, where the Function answers", () => {
    // **`functions/manual/[[path]].js` は `/manual/` の下だけを受ける**
    // (経路で絞ってある)。ここが別の場所を指すと、**実体の無い PDF が
    // アプリの殻として 200 で返る**——利用者には「電卓が出た」と見える。
    render(<ManualPage />);
    for (const manual of MANUALS) {
      const link = screen.getByRole("link", { name: manual.title });
      expect(link).toHaveAttribute(
        "href",
        `/manual/calcarc-${__APP_VERSION__}-${manual.stem}.pdf`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("still says where the PDFs are when the deploy carried none", () => {
    // **緊急経路で配り直した版は PDF を持たない**(`docs/deploy.md`)。
    // **そのとき画面が壊れないこと**が要件で、**代わりの行き先が要る。**
    render(<ManualPage />);
    const release = screen.getByRole("link", { name: "この版の Release" });
    expect(release).toHaveAttribute("href", RELEASE_URL);
    expect(RELEASE_URL).toBe(
      `https://github.com/terapyon/CalcArc/releases/tag/v${__APP_VERSION__}`,
    );
  });

  it("offers the way back to the calculator", () => {
    render(<ManualPage />);
    expect(screen.getByRole("link", { name: "計算機に戻る" })).toHaveAttribute(
      "href",
      "#scientific",
    );
  });
});

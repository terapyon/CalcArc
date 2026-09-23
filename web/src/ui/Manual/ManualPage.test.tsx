/**
 * マニュアルを読む画面（0.9.6 設計書 §4）。
 *
 * **ここで見るのは「本文が画面に届くか」と「戻れるか」**である。
 * **読み上げの意味論は E2E**（jsdom はアクセシビリティツリーを組まない。CLAUDE.md）。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pdfName } from "../../../scripts/manual/markdown.ts";
import { MANUALS } from "../Footer/LinksPopup";
import { ManualPage } from "./ManualPage";

describe("ManualPage", () => {
  it("3 冊を選べて、既定は簡易マニュアルである", async () => {
    render(<ManualPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "CalcArc 簡易マニュアル" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    for (const title of [
      "CalcArc 簡易マニュアル",
      "CalcArc 詳細マニュアル",
      "CalcArc Quick Guide",
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("本文が画面の中に出る", async () => {
    // **PDF を開かずに読める**——これが 0.9.6 の目的そのものである
    // （iPhone のホーム画面アプリで、PDF は行き止まりだった）。
    render(<ManualPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /4 つのタブ/ }),
      ).toBeInTheDocument(),
    );
  });

  it("計算機に戻る道がある", async () => {
    render(<ManualPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "計算機に戻る" }),
      ).toHaveAttribute("href", "#scientific"),
    );
  });

  it("PDF は保存・印刷用の副経路として、サイトの中を指す", async () => {
    // **既定の読み口は画面**（設計書 §3 の第一原則）。**PDF はここから開く**
    // ——**行き先はサイトの中**（0.9.5 の GitHub Release 行きは取り消した）。
    render(<ManualPage />);
    const links = await screen.findAllByRole("link", { name: /PDF/ });
    expect(links).toHaveLength(3);
    // **綴りの出どころが 2 つあるので検査が繋ぐ**（0.9.5 に `Footer.test.tsx` へ
    // 置いた主張を、PDF がこの画面へ移ったので連れてきた）。**PDF を作る側の
    // `pdfName` と 1 冊ずつ突き合わせる**——食い違えば、配ってある PDF は在るのに
    // リンクの先が 404 になる。
    for (const manual of MANUALS) {
      expect(
        screen.getByRole("link", { name: `${manual.title}の PDF` }),
      ).toHaveAttribute(
        "href",
        `/manual/${pdfName(manual.source, __APP_VERSION__)}`,
      );
    }
    expect(MANUALS).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(
        /^\/manual\/calcarc-\d+\.\d+\.\d+-(quick-ja|detail-ja|quick-en)\.pdf$/,
      );
    }
  });
});

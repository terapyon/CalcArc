import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "./Footer";
import { LINKS, LINKS_POPUP_CLOSE, LINKS_POPUP_LABEL } from "./LinksPopup";

describe("Footer", () => {
  it("names the app and its version on the button that opens the links", () => {
    // **綴りは利用者の裁定である**(2026-09-17)——「CalcArc <版> について」。
    // **版数はビルド時に埋まる**ので、ここでも定数から組み立てる。
    // **`@terapyon` は下部から消えた**(リンク集の GitHub の項目に入った)。
    render(<Footer />);
    const button = screen.getByRole("button", {
      name: `CalcArc ${__APP_VERSION__} について`,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("@terapyon")).toBeNull();
  });

  it("says the results carry no warranty", () => {
    render(<Footer />);
    expect(screen.getByTestId("footer-disclaimer")).toHaveTextContent(
      "計算結果は無保証です。",
    );
  });

  it("opens the links, and says so", () => {
    render(<Footer />);
    const button = screen.getByRole("button", { name: /CalcArc/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    expect(
      screen.getByRole("dialog", { name: LINKS_POPUP_LABEL }),
    ).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the four links the user settled, in that order", () => {
    // **並びも綴りも利用者の裁定**(2026-09-12 と 2026-09-17)。**表から
    // 組み立てない**——組み立てると、表と期待値が同時に間違っても緑になる。
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(names).toEqual([
      "GitHub（@terapyon）",
      "マニュアル",
      "ライセンス",
      "検査結果",
    ]);
  });

  it("sends the manual link into the app, and the rest out of it", () => {
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    const manual = screen.getByRole("link", { name: "マニュアル" });
    expect(manual).toHaveAttribute("href", "#manual");
    // **アプリの中へ行くものに `target="_blank"` を付けない**——付けると、
    // 同じアプリがもう 1 枚開く。
    expect(manual).not.toHaveAttribute("target");
    for (const link of LINKS.filter((entry) => entry.external)) {
      const anchor = screen.getByRole("link", { name: link.label });
      expect(anchor).toHaveAttribute("href", link.href);
      // opener を渡さない(0.2.0 からの流儀)。
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    }
    // **1 度も比較しなかった格子で緑にならない**ように、数を先に言う。
    expect(LINKS.filter((entry) => entry.external)).toHaveLength(3);
  });

  it("points the evidence link at this version's release", () => {
    // **版数はビルド時に埋まる**ので、古い版の画面は古い Release を指す。
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    expect(screen.getByRole("link", { name: "検査結果" })).toHaveAttribute(
      "href",
      `https://github.com/terapyon/CalcArc/releases/tag/v${__APP_VERSION__}`,
    );
  });

  it("closes on the close button, and gives the focus back", () => {
    render(<Footer />);
    const button = screen.getByRole("button", { name: /CalcArc/ });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: LINKS_POPUP_CLOSE }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    // **焦点を戻す。** 戻さないと、消えた要素の所に読み上げの位置が残る。
    expect(document.activeElement).toBe(button);
  });

  it("closes on the backdrop, but not when the popup itself is pressed", () => {
    // **背面は指の近道である**(小さい画面で【閉じる】に届く前に迷わせない)。
    // **中身を押しても閉じない**——押した場所で見分けている(`LinksPopup.tsx`)。
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    if (backdrop) fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape, and keeps it away from AC", () => {
    // **裁定 #4(設計書 §2.5): リンク集が開いているときの Escape は、
    // リンク集を閉じるだけ。** `ac` は window の bubble 段で受けるので、
    // **capture 段で止まったこと**を伝播の有無で見る。
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    let reachedBubble = false;
    const spy = () => {
      reachedBubble = true;
    };
    window.addEventListener("keydown", spy);
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", spy);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reachedBubble).toBe(false);
  });

  it("closes when the hash takes the reader somewhere else", () => {
    // `#manual` を選んだら、**新しい画面の上にリンク集を残さない**。
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: /CalcArc/ }));
    fireEvent(window, new Event("hashchange"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

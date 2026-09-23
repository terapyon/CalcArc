/**
 * 画面で読むマニュアルの変換（0.9.6 設計書 §4.3・§4.4）。
 *
 * **PDF 用の `renderManual` は使えない**——あれの `image` renderer は `shot:` を
 * **追跡外の写真の URL** に差し替え、写真が無ければ投げる（`markdown.ts:330-345`）。
 * **画面には写真を出さない**（利用者の裁定ではなく監視役の裁定 Q3。
 * 「写真はリポジトリに置かない」という裁定 #1 を動かさないため）。
 *
 * **出荷するマニュアルの本文はここでは読まない**——読むのは `manual-markdown.test.ts`
 * と同じ流儀で、**fixture と、性質を言う短い入力**である。
 */
import { describe, expect, it } from "vitest";
import { renderForScreen } from "../../scripts/manual/screen.ts";

describe("画面で読むマニュアルの変換", () => {
  it("写真は出さないが、説明の文は残す", () => {
    // **alt は意味を持つ文である**——「画面: Convert（長さ。10 km を換算した
    // ところ）」は、本文がその前後で指している物の説明になっている。
    // **写真が無いからといって黙って落とすと、本文の流れが切れる。**
    // **これは実行役の選択で、利用者の裁定ではない**（0.9.6 設計書 §4.4）
    // ——**出荷の前に、利用者が実物で見て決める。**
    const html = renderForScreen(
      "![画面: Convert（10 km）](shot:tab-convert)\n",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("shot:");
    expect(html).toContain("画面: Convert（10 km）");
  });

  it("冊の題（最上位の見出し）は出さない", () => {
    // **画面の `<h1>` は画面名（「マニュアル」）で、`App` が 1 つだけ持つ**
    // ——本文にもう 1 つ入ると**ページに `<h1>` が 2 つ**になり、
    // `screen-identity.spec.ts` の「ちょうど 1 つ」が赤くなる（**実際に赤くなった**。
    // 2026-09-23、実ブラウザで発見）。**冊の題は、選んでいるボタンが言う。**
    const html = renderForScreen("# CalcArc 簡易マニュアル\n\n本文\n");
    expect(html).not.toContain("<h1");
    expect(html).toContain("<p>本文</p>");
  });

  it("shot: でない画像は投げる（PDF 側と同じ規律）", () => {
    // **`markdown.ts` の `image` renderer と同じ向き**。画面用に緩めない
    // ——**緩めた日に、外の URL を読みに行く画像が本文に入る。**
    expect(() =>
      renderForScreen("![x](https://example.invalid/a.png)"),
    ).toThrow();
  });

  it("見出しと本文を HTML にする", () => {
    const html = renderForScreen("## 1. 章\n\n本文\n");
    expect(html).toContain("<h2");
    expect(html).toContain("1. 章");
    expect(html).toContain("<p>本文</p>");
  });

  it("和文の途中の改行は詰める（PDF と同じ見え方）", () => {
    // `markdown.ts` の `joinCjkLines` を**共有する**——写すと、直した日に片方だけ直る。
    expect(renderForScreen("あいう\nえお\n")).toContain("あいうえお");
  });

  it("生の HTML は素通しせず、文字として出す", () => {
    // **素材は私たちが書いているが、変換器が素通しする経路は作らない。**
    const html = renderForScreen("<script>alert(1)</script>\n");
    expect(html).not.toContain("<script>");
  });
});

/**
 * 画面で読むマニュアル（0.9.6）。**PDF 用の `renderManual` とは別の変換である。**
 *
 * # なぜ別なのか
 *
 * `renderManual`（`markdown.ts:309`）の `image` renderer は **`shot:` を
 * 追跡外の写真（`web/manual-shots/`）の URL へ差し替え、写真が無ければ投げる**。
 * **画面には写真を出さない**（0.9.6 設計書 Q3。裁定 #1「写真はリポジトリに
 * 置かない」を動かさないため）ので、**あの renderer はそのまま使えない**
 * （レビュー役 calcarc-1e の注記、2026-09-23）。
 *
 * **写真の説明（alt）も出さない**（**利用者の裁定 2026-09-23**）。
 * 実行役は最初「説明の 1 行は残す」を選び、**差し戻せる 1 か所**にしてあった
 * ——**利用者が実物（簡易マニュアルの 2 章で 4 行続く所）を見て、落とすと決めた**。
 * 理由は「**写真が無い以上、説明だけ残っても読み手には空振り**」。
 *
 * # 共有しているもの・していないもの
 *
 * - **共有**: `joinCjkLines`（和文の改行の詰め方。写すと片方だけ直る日が来る）
 * - **していない**: 書体の `@font-face`・`PAGE_CSS`・`<!doctype html>` の殻。
 *   **あれは紙のための飾り**で、画面は製品の CSS の中に入る
 *
 * **素材は同じ `docs/manual/*.md`**（二重管理にしない。設計書 §3）。
 */

import { Marked, type Tokens } from "marked";
import { joinCjkLines } from "./markdown.ts";

/** `marked` が renderer を呼ぶときの `this`（`parser` を持つ）。 */
interface RendererThis {
  parser: { parseInline(tokens: Tokens.Generic[]): string };
}

/** 本文の HTML。**`<body>` の中身だけ**で、殻は付けない。 */
export function renderForScreen(markdown: string): string {
  const marked = new Marked({
    async: false,
    // **生の HTML を素通ししない。** 素材は私たちが書いているが、
    // **素通しする経路を 1 つ作れば、そこは見張りの外になる。**
    renderer: {
      html(): string {
        return "";
      },
      heading(this: RendererThis, { depth, tokens }: Tokens.Heading): string {
        // **最上位の見出し（冊の題）は出さない。** **画面の `<h1>` は画面名**
        // 「マニュアル」で、`App` が 1 つだけ持つ——**本文にもう 1 つ入ると
        // ページに `<h1>` が 2 つ**になり、見出しの階層が壊れる
        // （`screen-identity.spec.ts` の「ちょうど 1 つ」で実際に赤くなった）。
        // **冊の題は、選んでいるボタンが言う**（`ManualPage.tsx`）。
        if (depth === 1) return "";
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>`;
      },
      paragraph(this: RendererThis, { tokens }: Tokens.Paragraph): string {
        // **中身が無くなった段落は出さない。** 写真だけの行（`![…](shot:…)`）は
        // **段落 1 つに写真 1 つ**なので、写真を落とすと `<p></p>` が残る
        // ——**空の段落は、読み手には理由の無い空きに見える。**
        const body = this.parser.parseInline(tokens);
        return body.trim() === "" ? "" : `<p>${body}</p>`;
      },
      image({ href }: Tokens.Image) {
        // **`shot:` 以外は投げる**——**PDF 側と同じ規律**（`markdown.ts:333`）。
        // **画面用に緩めない**: 緩めた日に、外の URL を読みに行く画像が本文に入る。
        if (!href.startsWith("shot:")) {
          throw new Error(`shot: でない画像がある: ${href}`);
        }
        // **写真も、その説明の行も出さない**（**利用者の裁定 2026-09-23**。
        // 実物を見て決めた——**写真が無い以上、説明だけ残っても読み手には空振り**。
        // 簡易マニュアルの 2 章では「画面: …」の行が 4 本続いていた）。
        return "";
      },
    },
    walkTokens(token) {
      if (token.type === "text") {
        const text = token as Tokens.Text;
        text.text = joinCjkLines(text.text);
      }
    },
  });
  return marked.parse(markdown, { async: false });
}

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
 * **写真の説明（alt）は 1 行として残す。** 「画面: Convert（長さ。10 km を
 * 換算したところ）」のような文で、**本文がその前後で指している物の説明**である
 * ——**黙って落とすと流れが切れる。** **これは実行役の選択であって利用者の裁定では
 * ない**（設計書 §4.4）。**出荷の前に、利用者が実物を見て決める。**
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
      heading({ depth, text }: Tokens.Heading): string {
        // **最上位の見出し（冊の題）は出さない。** **画面の `<h1>` は画面名**
        // 「マニュアル」で、`App` が 1 つだけ持つ——**本文にもう 1 つ入ると
        // ページに `<h1>` が 2 つ**になり、見出しの階層が壊れる
        // （`screen-identity.spec.ts` の「ちょうど 1 つ」で実際に赤くなった）。
        // **冊の題は、選んでいるボタンが言う**（`ManualPage.tsx`）。
        if (depth === 1) return "";
        const body = marked.parseInline(text, { async: false });
        return `<h${depth}>${body}</h${depth}>`;
      },
      image({ href, text }: Tokens.Image) {
        // **`shot:` 以外は投げる**——**PDF 側と同じ規律**（`markdown.ts:333`）。
        // **画面用に緩めない**: 緩めた日に、外の URL を読みに行く画像が本文に入る。
        if (!href.startsWith("shot:")) {
          throw new Error(`shot: でない画像がある: ${href}`);
        }
        // **写真は出さない。説明の文だけを残す**（上の註）。
        return `<p class="shot-note">${escapeHtml(text)}</p>`;
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

/** `markdown.ts` の同名の関数と同じ規則。**あちらはモジュール外に出していない。** */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

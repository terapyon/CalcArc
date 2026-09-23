/**
 * 画面が読む 3 冊（0.9.6）。**ビルド時に `docs/manual/*.md` から作る。**
 *
 * **素材は PDF と同じ**（設計書 §3「素材は 1 つのまま」）。**実行時には
 * 1 行も変換しない**——`marked` は devDependency のままで、バンドルに入らない。
 */
import { describe, expect, it } from "vitest";
import { MANUAL_DIR, manualBooks } from "../../scripts/manual/books.ts";
import { EXPECTED_MANUALS, manualName, readManuals } from "./manuals";

describe("画面が読む 3 冊", () => {
  const books = manualBooks(MANUAL_DIR);
  const files = readManuals();

  it("冊は docs/manual の一覧と同じ（数も並びも）", () => {
    // **冊数の下限ではなく一覧そのもの**（`manuals.ts` と同じ流儀）
    // ——**4 冊目が紛れ込んでも赤くなる。**
    expect(files.map(manualName)).toEqual(EXPECTED_MANUALS);
    expect(books.map((book) => book.source)).toEqual(EXPECTED_MANUALS);
  });

  it("題は本文の最初の見出しから取る", () => {
    // **画面の綴りと本文の題が食い違わない。** リンク集の `MANUALS` の題も
    // 同じ文字列で、`Footer.test.tsx` がそちらを見ている。
    expect(books).toHaveLength(3);
    for (const book of books) {
      const file = files.find((manual) => manualName(manual) === book.source);
      expect(`# ${book.title}`).toBe(file?.text.split("\n")[0]);
    }
  });

  it("本文が入っていて、写真は 1 枚も無い", () => {
    expect(books).toHaveLength(3);
    for (const book of books) {
      expect(book.html, book.source).toContain("<h2");
      // **`<h1>` は画面が持つ**（本文には入れない。`manual-screen.test.ts`）。
      expect(book.html, book.source).not.toContain("<h1");
      expect(book.html, book.source).not.toContain("<img");
      expect(book.html, book.source).not.toContain("shot:");
      // **写真の説明の行も出さない**（利用者の裁定 2026-09-23）。
      expect(book.html, book.source).not.toContain("画面: Scientific");
      expect(book.html, book.source).not.toContain("<p></p>");
    }
  });

  it("章の題が全部そろっている（本文が途中で切れていない）", () => {
    // **「本文が画面に届いている」ことの番人**（設計書 §5 の 1）。
    // **素材が正で画面を直す向き**である。
    let compared = 0;
    for (const book of books) {
      const file = files.find((manual) => manualName(manual) === book.source);
      for (const line of (file?.text ?? "").split("\n")) {
        const chapter = /^##\s+(\d+\.\s+.+?)\s*$/.exec(line);
        if (chapter?.[1] === undefined) continue;
        expect(book.html, `${book.source}: ${chapter[1]}`).toContain(
          chapter[1],
        );
        compared += 1;
      }
    }
    // **1 度も比べずに緑にならない**ための床（7 + 10 + 7 の実数、2026-09-23）。
    expect(compared).toBe(24);
  });
});

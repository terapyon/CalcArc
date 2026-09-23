import { useEffect, useState } from "react";
import type { ManualBook } from "../../../scripts/manual/books.ts";
import { MANUALS, manualPdfUrl } from "../Footer/LinksPopup";
import styles from "./ManualPage.module.css";

/**
 * マニュアルを読む画面（0.9.6、利用者の裁定 2026-09-23）。
 *
 * # なぜ画面の中で読ませるのか
 *
 * **PDF を開く道は、iPhone のホーム画面アプリでは行き止まりになる**
 * ——**利用者の実機で 2 回確かめられた**: 0.9.4 は `Content-Disposition: attachment`
 * （本番で付いていた。監視役の `curl`）、0.9.5 は別の生成元（GitHub Release）。
 * **どちらも「端末が PDF をどう扱うか」に賭けていて、外れた。**
 * 利用者の言葉は「**PDF が開くが、閉じる・戻るのボタンが見当たらない**」。
 *
 * **だから既定の読み口を PDF にしない。** 本文はこの画面の中に出て、
 * **戻る手段は私たちの画面の中に在る**。
 *
 * # 本文はどこから来るか
 *
 * **ビルド時に `docs/manual/*.md` から作った HTML**（`vite.config.ts` の
 * `manualsPlugin` が `virtual:manuals` として渡す）。**実行時に変換しない**
 * ——`marked` は devDependency のままで、**バンドルに入らない**。
 *
 * **`import()` で読む**のは、**本体とは別の塊にするため**である（監視役の裁定
 * 2026-09-23）。**電卓を開くだけの人は読み込まない**（本文 3 冊は gz で約 24.7KB、
 * 本体 JS の gz の約 23%）。**precache には入る**ので、**オフラインでも読める**。
 *
 * # 本文を `innerHTML` で入れることについて
 *
 * **入れる HTML は私たちのリポジトリの `docs/manual/*.md` だけ**で、
 * **ビルド時に、生の HTML を落とす変換器を通している**
 * （`scripts/manual/screen.ts` の `html()` が空を返す）。
 * **外から来た文字列はここに来ない。**
 */
/**
 * 画面の中の綴り。**export してあるのは、マニュアルのキー名の番人が読むため**
 * （`tests/unit/manual-key-names.test.ts`。`Nav.tsx` の `MODULES`、
 * `LinksPopup.tsx` の `LINK_LABELS` と同じ流儀。0.9.3 の `MANUAL_LINK_LABELS`
 * がその先例である）。**冊の題は `MANUALS` が持つ**ので、ここには入れない。
 */
export const MANUAL_PAGE_LABELS = ["計算機に戻る"] as const;

export function ManualPage() {
  const [books, setBooks] = useState<readonly ManualBook[] | null>(null);
  const [stem, setStem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // **塊を分ける**ための動的 import（上の註）。**失敗しても画面は残す**
    // ——**戻る道が消えるのがいちばん困る**（それがこの画面の存在理由である）。
    import("virtual:manuals")
      .then((module) => {
        if (!alive) return;
        setBooks(module.default);
        // **既定は簡易マニュアル**（`MANUALS` の先頭。利用者の裁定の並び）。
        setStem(MANUALS[0]?.stem ?? null);
      })
      .catch(() => {
        if (alive) setBooks([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // **並びは利用者の裁定**（`MANUALS` の「短い日本語 → 詳しい日本語 → 英語」）。
  // **`manualBooks` はファイル名の順**（あちらは `EXPECTED_MANUALS` と
  // 突き合わせる一覧で、並べ替えると検査の意味が変わる）——**並べるのは画面の側**。
  const ordered = MANUALS.flatMap(
    (manual) => books?.filter((book) => book.stem === manual.stem) ?? [],
  );
  const current = ordered.find((book) => book.stem === stem) ?? null;

  return (
    <section className={styles.page} aria-label="マニュアル">
      {/* **戻る道は、読んでいる途中でも画面に在る**（利用者の裁定 2026-09-23）。
          **タブは貼り付かない**——`position: static` で、詳細マニュアル
          （390×844 でページ全体 32,869px）を少し下へ送ると**画面の外に出る**
          （2026-09-23 実測）。**利用者が 0.9.4・0.9.5 で困ったのは
          「閉じる・戻るのボタンが見当たらない」こと**なので、**下まで
          読まないと戻れない形にしない。**
          **代償は本文の上 44px**（390×844 で 5.2%）。**読み物の面は縦の予算を
          持たない**ので、電卓の 11 画面の検査には触れない。 */}
      <p className={styles.backBar}>
        <a className={styles.link} href="#scientific">
          {MANUAL_PAGE_LABELS[0]}
        </a>
      </p>
      {/* **冊を選ぶ。** タブの見た目にはするが、`role="tab"` は名乗らない
          ——**あれは中身を差し替える面の約束**（`aria-controls` と焦点の移動）で、
          **ここはそこまで作っていない**。**押せるボタンとして正しく読まれる**
          ほうを採る（読み上げの確かめは E2E）。 */}
      <div className={styles.books}>
        {ordered.map((book) => (
          <button
            key={book.stem}
            type="button"
            className={styles.book}
            aria-pressed={book.stem === stem}
            onClick={() => setStem(book.stem)}
          >
            {book.title}
          </button>
        ))}
      </div>

      {books === null && <p className={styles.state}>読み込んでいます…</p>}
      {books !== null && books.length === 0 && (
        // **本文が読めなくても、戻る道と PDF は残す**（下の 2 つは外に出ている）。
        <p className={styles.state}>
          本文を読み込めませんでした。下の PDF から読めます。
        </p>
      )}

      {current !== null && (
        <article
          className={styles.body}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 入るのはビルド時に docs/manual から作った HTML だけで、screen.ts が生の HTML を落としている（上の註）
          dangerouslySetInnerHTML={{ __html: current.html }}
        />
      )}

      <p className={styles.pdfs}>
        {ordered.map((book) => (
          <a
            key={book.stem}
            className={styles.pdf}
            href={manualPdfUrl(book.stem, __APP_VERSION__)}
            // **PDF は保存・印刷用の副経路**（利用者の裁定 Q2）。
            // **別の窓で開く**——**この画面を閉じさせない。**
            target="_blank"
            rel="noopener noreferrer"
          >
            {book.title}の PDF
          </a>
        ))}
      </p>
    </section>
  );
}

import { useEffect, useId, useRef } from "react";
import {
  ESCAPE_LAYER,
  escapeTakenAbove,
  openEscapeLayer,
} from "../escapeLayers";
import styles from "./LinksPopup.module.css";

/**
 * 下部から開くリンク集（0.9.3 設計書 §2.2、利用者の裁定 2026-09-17）。
 *
 * **下部には「開くボタン 1 つ」しか置かない。** 4 本を下部に並べると
 * **横に溢れる**——`footer.spec.ts` の 5 幅（430/390/375/360/320）の検査が
 * 見ている性質で、**下部が要る幅は 288px、320px の画面での余りは 32px**
 * である（2026-09-17 実測、Chromium。前後の表は `Footer.tsx` に在る）。
 * **項目 1 本でも「ライセンス」なら 4 文字ぶん増える**ので、4 本は入らない。
 *
 * **項目の綴りは利用者の裁定である**（2026-09-12 と 2026-09-17）。
 * 並びも裁定のとおり: GitHub（@terapyon）／マニュアル／ライセンス／検査結果。
 * **`@terapyon` はここに居る**——0.9.3 で下部の綴りが
 * 「CalcArc <版> について」になり、**作者名は下部から消えた**（利用者の裁定）。
 */

/**
 * 項目の綴りと行き先。**1 か所にしか無い**（`Footer.tsx` に写さない）。
 *
 * **export してあるのは、マニュアルのキー名の番人が読むため**
 * （`tests/unit/manual-key-names.test.ts` と同じ流儀。`Nav.tsx` の `MODULES`、
 * `UpdateToast.tsx` の `UPDATE_TOAST_LABELS` がその先例）。
 */
export const LINKS = [
  {
    id: "github",
    label: "GitHub（@terapyon）",
    href: "https://github.com/terapyon/CalcArc",
    external: true,
  },
  // **これだけが外へ出ない。** `#manual` はこのアプリの画面である（§2.2）。
  { id: "manual", label: "マニュアル", href: "#manual", external: false },
  {
    id: "license",
    label: "ライセンス",
    href: "https://github.com/terapyon/CalcArc/blob/main/LICENSE",
    external: true,
  },
  {
    // **その版の Release を指す**——添付されている証拠 3 点（各ジョブの結論・
    // 重量級の報告書・実際に配った `dist`）が、この版について何を確かめたかを
    // 持っている（`docs/deploy.md` の「リリースの証拠」）。
    // **版数はビルド時に埋まる**ので、古い版の画面は古い Release を指す。
    id: "evidence",
    label: "検査結果",
    href: `https://github.com/terapyon/CalcArc/releases/tag/v${__APP_VERSION__}`,
    external: true,
  },
] as const;

/** 閉じるボタンの文字。**更新のお知らせと同じ綴りにそろえる**（`UPDATE_TOAST_LABELS.close`）。 */
export const LINKS_POPUP_CLOSE = "閉じる";

/** ポップアップの名前。**読み上げはこれで引く。** */
export const LINKS_POPUP_LABEL = "リンク集";

export function LinksPopup({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // **開いているあいだ、Escape はここが受ける**（設計書 §2.5、裁定 #4）。
  // **更新のお知らせも `ac` も走らせない。** 順が決まる仕掛けは
  // `escapeLayers.ts` の註にある——**リスナを付けた順では決まらない。**
  useEffect(() => {
    const close = openEscapeLayer(ESCAPE_LAYER.links);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // **自分より上は無い**（いちばん上の層である）が、聞き方は下の層と
      // 同じにしておく——3 つ目を足した日に、ここだけ別の流儀にしない。
      if (escapeTakenAbove(ESCAPE_LAYER.links)) return;
      // capture 段で止める。`useKeyboard` の `Escape: "ac"` は window の
      // bubble 段なので、ここで止めれば決定的に届かない。
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      close();
    };
  }, [onClose]);

  // **`#manual` を選んだら閉じる。** あれだけがアプリの中へ行くので、
  // 閉じないと**新しい画面の上にリンク集が残る。**
  useEffect(() => {
    window.addEventListener("hashchange", onClose);
    return () => window.removeEventListener("hashchange", onClose);
  }, [onClose]);

  // **開いたらポップアップへ焦点を移す。** 移さないと、読み上げは下部の
  // ボタンの所に居たまま——「開いた」ことが分からない。
  // **閉じたときに戻す先は `Footer` が持つ**（開くボタンを知っているのは
  // あちらである）。
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    // **背面を押しても閉じる。** これが無いと、小さい画面では閉じるボタンに
    // 届く前に迷う。**キーボードの経路は Escape と【閉じる】が持っている**ので、
    // この `div` には role を付けない（押せる物として読み上げに出さない）。
    // biome-ignore lint/a11y/noStaticElementInteractions: キーボードの経路は Escape と【閉じる】が持つ。背面は指の近道で、読み上げには出さない
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className={styles.backdrop}
      // **背面そのものを押したときだけ閉じる。** 中身で受けて止める形
      // (`onClick={stopPropagation}`)は採らない——**中身は押す物ではない**のに
      // ハンドラが付き、lint の「click にはキーの経路も」に当たる。
      // **押された場所で見分ければ、中身に何も付けずに済む。**
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.popup}
      >
        <h2 id={titleId} className={styles.title}>
          {LINKS_POPUP_LABEL}
        </h2>
        <ul className={styles.list}>
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                className={styles.link}
                href={link.href}
                // PWA の standalone 起動でも外のブラウザで開く
                // （`Footer.tsx` に在った註と同じ理由）。**`#manual` は
                // アプリの中なので付けない。**
                {...(link.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.close} onClick={onClose}>
          {LINKS_POPUP_CLOSE}
        </button>
      </div>
    </div>
  );
}

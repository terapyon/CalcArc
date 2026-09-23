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
/** このリポジトリの Release。**PDF と【検査結果】が同じ所から組む。** */
const RELEASES = "https://github.com/terapyon/CalcArc/releases";

/**
 * 版から PDF の行き先を作る。**行き先を組むのはここ 1 か所だけ**である。
 *
 * **サイトの中を指す**（`functions/manual/[[path]].js` が配り、実体の無い
 * `.pdf` には 404 を返す）。**0.9.5 は GitHub Release の添付を指していたが、
 * 0.9.6 で戻した**（利用者の裁定 2026-09-23）。
 *
 * # なぜ戻したか（**実測 2 件。推測は 1 つも要らなくなった**）
 *
 * - **0.9.4**（サイト内＋`Content-Disposition: attachment`）: iPhone の
 *   ホーム画面アプリから開くと**窓ごと PDF に変わって戻れない**
 * - **0.9.5**（GitHub Release の添付＝別の生成元）: **内部のブラウザ表示から
 *   戻れない**。利用者の言葉は「**PDF が開くが、閉じる・戻るのボタンが
 *   見当たらない**」
 *
 * **どちらも「端末が PDF をどう扱うか」に賭けていて、2 回とも外れた。**
 * **0.9.6 は賭けをやめた**——**本文はアプリの中の画面（`#manual`）で読む**。
 * **PDF はそこから開く保存・印刷用の副経路**であり、**既定の読み口ではない。**
 *
 * **綴りは `web/scripts/manual/markdown.ts` の `pdfName` と同じ**
 * （`calcarc-<版>-<冊>.pdf`）。**写しなので検査が繋ぐ**——`Footer.test.tsx` が
 * `pdfName` の出力と 1 冊ずつ突き合わせる。
 */
export function manualPdfUrl(stem: string, version: string): string {
  return `/manual/calcarc-${version}-${stem}.pdf`;
}

/**
 * 冊子 3 つ。**綴りは `docs/manual/*.md` の見出しから取ってある**（写しなので
 * 検査が繋ぐ）。**順は「短い日本語 → 詳しい日本語 → 英語」**。
 *
 * **0.9.4 で `#manual` の画面をやめ、ここへ直接並べた**（利用者の裁定
 * 2026-09-18）——**画面を 1 つ増やさずに、同じ 3 冊へ届く**。
 */
export const MANUALS = [
  { stem: "quick-ja", source: "quick.ja.md", title: "CalcArc 簡易マニュアル" },
  {
    stem: "detail-ja",
    source: "detail.ja.md",
    title: "CalcArc 詳細マニュアル",
  },
  { stem: "quick-en", source: "quick.en.md", title: "CalcArc Quick Guide" },
] as const;

export const LINKS = [
  {
    id: "github",
    label: "GitHub（@terapyon）",
    href: "https://github.com/terapyon/CalcArc",
    external: true,
  },
  // **これだけが外へ出ない。** `#manual` はこのアプリの画面である。
  //
  // **0.9.3 の綴りと並びに戻した**（利用者の裁定 2026-09-23。綴りは
  // `git show 54adfd2^:web/src/ui/Footer/LinksPopup.tsx` の印字から写した）。
  // **0.9.4 は PDF 3 冊をここに並べていた**が、**0.9.6 で PDF はマニュアルの
  // 画面の中へ移った**（保存・印刷用の副経路）。**行き先の無い 3 行を残さない。**
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
    href: `${RELEASES}/tag/v${__APP_VERSION__}`,
    external: true,
  },
] as const;

/**
 * リンク集の項目の綴り。**マニュアルのキー名の番人が読む**
 * （`tests/unit/manual-key-names.test.ts`）。
 */
export const LINK_LABELS: readonly string[] = LINKS.map((link) => link.label);

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

  // **ハッシュが変わったら閉じる。** いまは中身が全部外向きなので**普段は
  // 起きない**が、**閉じ忘れたリンク集が新しい画面の上に残る**という壊れ方は
  // 安い保険で塞いでおく（タブを押して閉じた場合など）。
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
        {/* **群の区切り線は落とした**（0.9.6）——**あれは PDF 3 冊を
            1 つのまとまりに見せるため**で、**3 冊が画面の中へ移った**いま、
            分ける群が無い。 */}
        <ul className={styles.list}>
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                className={styles.link}
                href={link.href}
                // PWA の standalone 起動でも外のブラウザで開く
                // （`Footer.tsx` に在った註と同じ理由）。**6 本とも別の生成元
                // （GitHub）**で、PDF も 0.9.5 から GitHub の Release を指す
                // （`manualPdfUrl` の註に、実測と推測を分けて書いた）。
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

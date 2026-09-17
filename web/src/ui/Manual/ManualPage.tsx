import styles from "./ManualPage.module.css";

/**
 * マニュアルの画面（0.9.3 設計書 §2.2、`#manual`）。
 *
 * **タブではない。** `route.ts` の `MODULES` はタブの id で、ここを足すと
 * タブが 5 つになる——**リンク集から開く読み物**である（`PageId`）。
 *
 * ## PDF はどこから来るか
 *
 * **リリースの走行が作って、本番と一緒に配る**（`release.yml` の `Manuals` →
 * `deploy.yml` が `web/dist/manual/` に入れる）。**PDF が落ちたら本番も出ない**
 * ——利用者の裁定 2026-09-17。
 *
 * **ただし、無い版が 1 つだけ在りうる**: **緊急経路で配り直した版**
 * （`Deploy` を手で起動する迂回路。`docs/deploy.md` のロールバック）。
 * **あの走行には PDF の artifact が無い**ので、**この画面のリンクの先は
 * 404 になる**（`functions/manual/[[path]].js` がそう返す）。
 * **だからこの画面は PDF が無くても壊れない作りにしてある**——
 * **同じ中身は Release にも添付されている**ので、その行き先を必ず添える。
 *
 * ## Service Worker はこの要求を飲まない
 *
 * **PDF を開くのは navigation リクエスト**（新しいタブで開く）なので、
 * **放っておくと SW の navigation fallback がアプリの殻（`index.html`）を返す**
 * ——**Cloudflare の Function まで届かず、404 も本物の PDF も出せなくなる**。
 * **いまは当たらない**: `vite.config.ts` の `navigateFallbackDenylist` が
 * **拡張子を持つパスを除外している**（`/\.[^/]+$/`。元は `/ogp.png` のため）。
 *
 * **除外が狭まった日に気づけるように、番人を 1 段足した**（0.9.3）:
 * `web/scripts/check-sw.mjs` が**作った `sw.js` から除外を読み出し、
 * `/manual/calcarc-0.0.0-quick-ja.pdf` が実際に当たること**を見る。
 * **「denylist という字が在る」だけでは足りない**——中身が
 * `/^\/ogp\.png$/` に狭まっても、その検査は緑のままである。
 */

/** 版から PDF の名前を作る。**綴りの出どころは `web/scripts/manual/markdown.ts`
 * の `pdfName`**（`calcarc-<版>-<冊>.pdf`）。**写しなので検査が繋ぐ**
 * ——`ManualPage.test.tsx` が、あの関数の出力と 1 冊ずつ突き合わせる。 */
export function manualPdfPath(stem: string, version: string): string {
  return `/manual/calcarc-${version}-${stem}.pdf`;
}

/**
 * 冊子。**綴りは `docs/manual/*.md` の見出しから取ってある**（写しなので
 * 検査が繋ぐ。`screenName.ts` と同じ流儀）。
 *
 * **順は「短い日本語 → 詳しい日本語 → 英語」**である。
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

/**
 * この画面の押せるものの名前。**マニュアルのキー名の番人が読む**
 * （`tests/unit/manual-key-names.test.ts`。`Nav.tsx` の `MODULES` と同じ流儀）。
 *
 * **冊子の題は `MANUALS` から取る**ので、ここに写しは無い。
 */
export const MANUAL_LINK_LABELS: readonly string[] = [
  ...MANUALS.map((manual) => manual.title),
  "この版の Release",
  "計算機に戻る",
];

/** その版の Release。**リンク集の「検査結果」と同じ行き先**である。 */
export const RELEASE_URL = `https://github.com/terapyon/CalcArc/releases/tag/v${__APP_VERSION__}`;

export function ManualPage() {
  return (
    <section className={styles.page} aria-label="マニュアル">
      <p className={styles.lead}>
        この版（{__APP_VERSION__}）のマニュアルです。画面写真つきの PDF で、
        新しい窓で開きます。
      </p>
      <ul className={styles.list}>
        {MANUALS.map((manual) => (
          <li key={manual.stem}>
            <a
              className={styles.link}
              href={manualPdfPath(manual.stem, __APP_VERSION__)}
              // PDF は別の窓で開く。**この画面を閉じさせない**——戻ってくる
              // 先は計算機である。
              target="_blank"
              rel="noopener noreferrer"
            >
              {manual.title}
            </a>
          </li>
        ))}
      </ul>
      {/* **PDF が無い版が在りうることを、ここで言う**（上の註）。
          **「たぶん在ります」とは書かない**——在るかどうかは走行の種類で
          決まっていて、利用者にはその区別が見えない。**代わりの行き先を
          必ず添える**のがこの段落の仕事である。 */}
      <p className={styles.fallback}>
        開けないときは、
        <a
          className={styles.link}
          href={RELEASE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          この版の Release
        </a>
        に同じ PDF が添付されています。
      </p>
      <p>
        <a className={styles.link} href="#scientific">
          計算機に戻る
        </a>
      </p>
    </section>
  );
}

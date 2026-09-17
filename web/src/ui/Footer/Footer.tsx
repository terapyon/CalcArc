import { useCallback, useRef, useState } from "react";
import styles from "./Footer.module.css";
import { LinksPopup } from "./LinksPopup";

/**
 * シェルのフッタ。**モジュールに属さない**ので、`UpdateToast` と同じく
 * シェルが 1 つだけ持つ(0.2.0 設計書 §5)。3 パネルに 3 回書くと、片方
 * だけ直す事故が起きる。
 *
 * 版数はビルド時に埋まる(`vite.config.ts` の define)。WASM の
 * `core_version()` は非同期で、シェルは WASM を読まないため使えない。
 *
 * **0.9.3 で GitHub のリンクがボタンになった**(利用者の裁定 2026-09-17)。
 * 下部に置くのは**リンク集を開くボタン 1 つ**だけで、4 本の行き先は
 * ポップアップの中に入る(`LinksPopup.tsx`)——**4 本を下部に並べると
 * 横に溢れる**(設計書 §2.4)。
 * **`@terapyon` は下部から消え、リンク集の GitHub の項目に入った**
 * ——これも利用者の裁定である。
 *
 * **前後を測ってある**(2026-09-17、Chromium、`--project=mobile`):
 *
 * | | 下部の要る幅 | 下部の高さ | 複利の面の余白 390×844 / 360×800 |
 * |---|---|---|---|
 * | 前(`CalcArc 0.9.2 @terapyon`) | 302px | 33px | 33.31px / 22.28px |
 * | 後(`CalcArc 0.9.2 について`) | **288px** | 33px | 33.31px / 22.28px |
 *
 * **狭くなった**(14px)ので、**320px の画面での余りは 18px から 32px に増えた**。
 * **縦は 1px も動いていない**——`finance-layout.spec.ts` の 8px の予算は
 * そのままである。**版数の桁が増えれば幅も増える**が、いまの余り 32px は
 * 1 桁ぶんの余裕としては足りている(この綴りで 1 文字は最大 12px)。
 */

/** 下部のボタンの文字。**版数は綴りの中に入る**(利用者の裁定 2026-09-17)。 */
export function aboutLabel(version: string): string {
  return `CalcArc ${version} について`;
}

export function Footer() {
  const [open, setOpen] = useState(false);
  // **閉じたら、開いたボタンへ焦点を戻す。** 戻さないと、読み上げの位置が
  // 消えた要素の所に残り、次の Tab が画面の先頭からやり直しになる。
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <footer className={styles.footer}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.about}
        // **開いている状態を読み上げに出す。** ボタンの文字は変わらないので、
        // これが無いと「押したが何が起きたか分からない」ままになる。
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        {aboutLabel(__APP_VERSION__)}
      </button>
      {/* **【変更 2026-08-25】文言を縮めて字を大きくした**(8px → **12px**)。
          0.2.1 は逆に「文言は縮めず、フォントを落として 1 行に収める」を
          採っていたが、**8px は実機で読めなかった**(ユーザー報告)。
          **1 行に収めるという制約はやめた**——理由は `Footer.module.css` に
          ある(1 行かどうかはフォント次第で、当てにすると閾値の調整が
          終わらない)。**文言を短くしたのはそのまま残す**——短いほうが
          折り返しにくく、読み手の負担も軽い。
          **落とした文は「重要な判断の根拠にしないでください。」である。**
          一度は「無保証。重要な判断に使わないでください。」まで縮めたが、
          **あの文言だと幅の広いフォントの端末で 2 行になり**、2 行ぶんの 16px が
          **Finance の縦の余裕(17px しかない)をほぼ食い尽くした**
          ——`viewport-budget.spec.ts` の「いちばん高いタブに 8px 以上の余白」が
          CI で 3.3px になって落ちた。上余白や行間を削っても数 px しか戻らない。
          **短くしたのは、字の大きさと縦の予算を両方守るためである。**
          強いほうの言い回しは README と、Finance の画面内免責が持っている。
          **Finance の画面内免責とは役割が違う**(0.2.0 設計書 §5)。あちらは
          ローンの数字が決定的概算であること、こちらはツール全体が無保証で
          あること。両方残す。 */}
      {/* 区切りは視覚の都合。**読み上げに混ぜない**ので独立した要素にし、
          aria-hidden で読み上げから外す。 */}
      <span aria-hidden="true">・</span>
      <span className={styles.disclaimer} data-testid="footer-disclaimer">
        計算結果は無保証です。
      </span>
      {open && <LinksPopup onClose={close} />}
    </footer>
  );
}

import styles from "./Footer.module.css";

/**
 * シェルのフッタ。**モジュールに属さない**ので、`UpdateToast` と同じく
 * シェルが 1 つだけ持つ(0.2.0 設計書 §5)。3 パネルに 3 回書くと、片方
 * だけ直す事故が起きる。
 *
 * 版数はビルド時に埋まる(`vite.config.ts` の define)。WASM の
 * `core_version()` は非同期で、シェルは WASM を読まないため使えない。
 */
export function Footer() {
  return (
    <footer className={styles.footer}>
      <a
        className={styles.link}
        href="https://github.com/terapyon/CalcArc"
        // PWA の standalone 起動でも外のブラウザで開く。
        target="_blank"
        rel="noopener noreferrer"
      >
        CalcArc {__APP_VERSION__} @terapyon
      </a>
      {/* **1 行に収める**——2 行だと Finance が 390×844 に 3px 収まらなかった
          (実測)。文言は縮めず、フォントを落として収める(ユーザー裁定)。
          **Finance の画面内免責とは役割が違う**(0.2.0 設計書 §5)。あちらは
          ローンの数字が決定的概算であること、こちらはツール全体が無保証で
          あること。両方残す。 */}
      <span className={styles.disclaimer} data-testid="footer-disclaimer">
        ・計算結果は無保証です。重要な判断の根拠にしないでください。
      </span>
    </footer>
  );
}

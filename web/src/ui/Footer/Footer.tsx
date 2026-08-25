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
      {/* **【変更 2026-08-25】文言を縮めて字を大きくした**(8px → **11px**)。
          0.2.1 は逆に「文言は縮めず、フォントを落として 1 行に収める」を
          採っていたが、**8px は実機で読めなかった**(ユーザー報告)。
          **1 行に収めるという制約はやめた**——理由は `Footer.module.css` に
          ある(1 行かどうかはフォント次第で、当てにすると閾値の調整が
          終わらない)。**文言を短くしたのはそのまま残す**——短いほうが
          折り返しにくく、読み手の負担も軽い。
          **落とした文は「重要な判断の根拠にしないでください。」** で、
          「重要な判断に使わないでください。」が同じことを短く言っている。
          **Finance の画面内免責とは役割が違う**(0.2.0 設計書 §5)。あちらは
          ローンの数字が決定的概算であること、こちらはツール全体が無保証で
          あること。両方残す。 */}
      {/* 区切りは視覚の都合。**読み上げに混ぜない**ので独立した要素にし、
          aria-hidden で読み上げから外す。 */}
      <span aria-hidden="true">・</span>
      <span className={styles.disclaimer} data-testid="footer-disclaimer">
        無保証。重要な判断に使わないでください。
      </span>
    </footer>
  );
}

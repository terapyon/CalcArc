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
          (0.2.1 の実測)。
          **【変更 2026-08-25】文言を縮めて字を大きくした。** 0.2.1 では逆に
          「文言は縮めず、フォントを落として収める」を採ったが、**8px は実機で
          読めなかった**(ユーザー報告)。1 行を保ったまま上げられる上限は
          **元の文言で 8px、この文言で 11px** である(手元のフォントでの実測)。
          **実際に採ったのは 10px** ——上限のすぐ下に置くと、幅の広いフォントの
          端末で溢れる(`Footer.module.css` に経緯がある)。
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

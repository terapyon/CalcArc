import styles from "./ConvertPanel.module.css";

/**
 * Convert の中身が入るまでの置き場(設計書 §5)。
 *
 * **タブのリンクは生きている。** 押せば `#convert` に遷移し、この画面が出る
 * ——0.2.0 の予約スロット(押せるように見えて無反応)とは別物である。
 */
export function ConvertPanel() {
  return (
    <section aria-label="単位変換（準備中）" className={styles.panel}>
      <p className={styles.heading}>単位変換は準備中です。</p>
      <p className={styles.detail}>
        長さ・重さ・温度・通貨などの変換をここに置きます。
      </p>
    </section>
  );
}

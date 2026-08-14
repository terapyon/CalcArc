import styles from "./Readout.module.css";

export interface ReadoutStatus {
  testId: string;
  ariaLabel: string;
  text: string;
  live?: "polite" | "off";
}

export interface ReadoutProps {
  /** 上部の式エコー。空なら行は場所だけ残る(設計書 §5)。 */
  echo: string;
  main: string;
  error?: string | null;
  status: ReadoutStatus[];
}

/**
 * 上部表示。**計算コアに依存しない**——文字列だけを受け取る。
 *
 * Scientific / Loan / Data Scale が同じ部品を使う(設計書 §6)。モジュール
 * 固有の意味(演算子の記号、単位、丸め)は呼び出し側が文字列にしてから渡す。
 */
export function Readout({ echo, main, error, status }: ReadoutProps) {
  return (
    <section className={styles.readout}>
      <div className={styles.echo} data-testid="display-echo">
        {echo}
      </div>
      <div className={styles.status}>
        {status.map((item) => (
          <span
            key={item.testId}
            data-testid={item.testId}
            role="status"
            aria-label={item.ariaLabel}
            aria-live={item.live ?? "off"}
          >
            {item.text}
          </span>
        ))}
      </div>
      <output
        className={styles.main}
        data-testid="display-main"
        // 結果が変わったことを読み上げる。polite なので操作を妨げない。
        aria-live="polite"
        {...(error ? { "data-error": error } : {})}
      >
        {main}
      </output>
    </section>
  );
}

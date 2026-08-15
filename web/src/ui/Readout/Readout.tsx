import styles from "./Readout.module.css";

export interface ReadoutStatus {
  testId: string;
  ariaLabel: string;
  text: string;
  live?: "polite" | "off";
}

/**
 * 入力の 1 件。**アクティブかどうかは入力の事実であって、装飾の指定では
 * ない**(設計書 §2)——だから `size` や `role` のような見た目の指定を持たない。
 */
export interface ReadoutEntry {
  /** 項目名。Scientific のように名前が無い入力では空文字。 */
  label: string;
  /** 表示用に整形済みの値。**Readout は整形しない**。 */
  value: string;
  active?: boolean;
}

export interface ReadoutProps {
  /**
   * 入力の一覧。**打っている項目は大きく、入力済みは小さく画面に残す**
   * ——項目を切り替えても計算根拠が消えないようにするため(設計書 §2)。
   * 空なら行は場所だけ残る。
   */
  entries: ReadoutEntry[];
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
function text(entry: ReadoutEntry): string {
  if (entry.label === "") return entry.value;
  if (entry.value === "") return entry.label;
  return `${entry.label} ${entry.value}`;
}

export function Readout({ entries, main, error, status }: ReadoutProps) {
  const shown = entries.filter((e) => e.label !== "" || e.value !== "");
  const active = shown.find((e) => e.active);
  const done = shown.filter((e) => !e.active);

  return (
    <section className={styles.readout}>
      <div className={styles.echo} data-testid="display-echo">
        {active && (
          <div
            className={styles.entryActive}
            data-testid="display-entry-active"
          >
            {text(active)}
          </div>
        )}
        {done.length > 0 && (
          <div
            className={styles.entriesDone}
            data-testid="display-entries-done"
          >
            {done.map((entry) => (
              <span key={entry.label}>{text(entry)}</span>
            ))}
          </div>
        )}
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

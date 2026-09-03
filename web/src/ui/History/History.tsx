import type { HistoryEntry } from "../../history";
import styles from "./History.module.css";

export interface HistoryProps {
  entries: HistoryEntry[];
  onBack: () => void;
  onRecall: (entry: HistoryEntry) => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

/**
 * 履歴の一覧。**盤面を丸ごと置き換える画面**であって、パネルの内側に
 * 差し込む部品ではない(Task 9 ブリーフ)。表示するだけで、貯める側の
 * 規則(上限・並び順)は `web/src/history` が持つ。
 *
 * どこから開くか・押した後どう戻るかは Task 10(配線)の仕事なので、
 * ここでは `onBack` を呼ぶだけで、押した後の遷移には関わらない。
 */
export function History({
  entries,
  onBack,
  onRecall,
  onRemove,
  onClearAll,
}: HistoryProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {"< 戻る"}
        </button>
        <h2 className={styles.heading}>履歴</h2>
        {/* **空のときは出さない**(ユーザー裁定)。押せる物が無いなら
            ボタンも無い方が読み上げでの混乱が少ない。 */}
        {entries.length > 0 && (
          <button
            type="button"
            className={styles.clearAll}
            aria-label="すべて消す"
            onClick={onClearAll}
          >
            すべて消す
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className={styles.empty}>まだ履歴はありません</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry, index) => (
            // key は式ではなく添字。履歴は同じ式が何度も積まれ得るので、
            // 式を key にすると React が別の行を同一視しかねない。
            // biome-ignore lint/suspicious/noArrayIndexKey: 上のとおり
            <li key={index} className={styles.row}>
              {entry.error ? (
                // **§D-1 の例外(ユーザー裁定)。** エラーで終わった計算は
                // 入力へ戻す意味が無い(`Math ERROR` を再生しても計算に
                // ならない)ので、ここだけ <button> にしない。一覧には
                // 出すが、押しても何も起きない要素にする。
                <div className={styles.entry} data-error>
                  <span className={styles.expression}>{entry.expression}</span>
                  <span className={styles.answer}>{entry.answer}</span>
                  <span className={styles.angle}>{entry.angle}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.entry}
                  aria-label={`${entry.expression} = ${entry.answer} を入力に入れる`}
                  onClick={() => onRecall(entry)}
                >
                  <span className={styles.expression}>{entry.expression}</span>
                  {/*
                    未確定: 答が長いと数字が削除ボタンと同じ行で競り合う。
                    ここでは答の側を折り返し可・右寄せにして、削除ボタンの
                    幅だけ確保する素朴な対応にとどめている——凝った省略や
                    スクロールは実物のスクリーンショットで判断してから
                    決める(Task 9 ブリーフ「まだ決まっていない」)。
                  */}
                  <span className={styles.answer}>{entry.answer}</span>
                  <span className={styles.angle}>{entry.angle}</span>
                </button>
              )}
              <button
                type="button"
                className={styles.remove}
                aria-label={`${entry.expression} を削除`}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

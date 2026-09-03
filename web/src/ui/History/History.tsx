import type { HistoryEntry } from "../../history";
import styles from "./History.module.css";

export interface HistoryProps {
  entries: HistoryEntry[];
  onBack: () => void;
  onRecall: (entry: HistoryEntry) => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
  /**
   * その 1 件を入力に戻せるか。**判定は綴りを知っている側が持つ。**
   *
   * **`entry.error` とは別の軸**(Fix round 2 finding)。エラーで終わった
   * 計算(`Math ERROR`)も、成功したが答の綴りをキー列に写せない計算
   * (虚数・極形式・60 進)も、ここでは「押せない」の 1 点で同じに
   * 扱ってよい——しかし前者だけが `.entry[data-error]` の色を持つ。
   * 2 つの事実(「計算が失敗した」/「この答は入力に戻せない」)は別々の
   * 入力から決まり、混ぜない。
   */
  canRecall: (entry: HistoryEntry) => boolean;
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
  canRecall,
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
              {canRecall(entry) ? (
                <button
                  type="button"
                  className={styles.entry}
                  aria-label={`${entry.expression} = ${entry.answer} を入力に入れる`}
                  onClick={() => onRecall(entry)}
                  data-error={entry.error ? true : undefined}
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
              ) : (
                // **`<button>` にしないのは「押せないから」だけ**——
                // `canRecall` が false な理由は 2 通りある: エラーで
                // 終わった計算(`Math ERROR` を再生しても計算にならない、
                // §D-1)と、成功したが答の綴りをキー列に写せない計算
                // (虚数・極形式・60 進)。**色が付くのは前者だけ**
                // (`data-error` は `entry.error` だけを見る。Fix round 2
                // finding——「計算が失敗した」と「入力に戻せない」は
                // 別の事実で、後者を前者の色で見せると嘘になる)。
                <div
                  className={styles.entry}
                  data-error={entry.error ? true : undefined}
                >
                  <span className={styles.expression}>{entry.expression}</span>
                  <span className={styles.answer}>{entry.answer}</span>
                  <span className={styles.angle}>{entry.angle}</span>
                </div>
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

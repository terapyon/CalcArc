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
  /**
   * `Settings.history.enabled` の現在値。**この画面は状態を持たない**
   * ——読み書きは `ScientificPanel` が `loadSettings`/`updateSettings` で行い、
   * ここには結果だけが下りてくる(`web/src/ui/storage.ts` を掴むのはそこだけ、
   * という規律を保つ。Task 14)。
   */
  recordingEnabled: boolean;
  /**
   * トグルが押されたときの新しい値をそのまま伝える。**消す操作ではない**
   * ——切っても `entries` には触らない(設計書 §7「切ると消すは別」)。
   */
  onRecordingEnabledChange: (enabled: boolean) => void;
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
  recordingEnabled,
  onRecordingEnabledChange,
}: HistoryProps) {
  return (
    <div className={styles.screen}>
      {/* **全消しはここに置かない**(Fix round: 実機のスクリーンショットで
          判明した Finding B)。以前はここに `すべて消す` があったが、
          `戻る` の隣の危険色ボタンは押し間違いの経路になる。全消しは
          一覧の下に置く(設計書 `2026-09-03-history-design.md` §6 の表
          「全消し(一覧の下)」のとおり)。 */}
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {"< 戻る"}
        </button>
        <h2 className={styles.heading}>履歴</h2>
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
                  data-testid="history-entry"
                  aria-label={`${entry.expression} = ${entry.answer} を入力に入れる`}
                  onClick={() => onRecall(entry)}
                  data-error={entry.error ? true : undefined}
                >
                  {/*
                      Fix round(Finding A): 実機のスクリーンショットで、
                      式と答が同じ行・同じ書体・同じ大きさで隙間 8px
                      だけを挟んで並び、境目が読めなかった
                      (「90 sin 0.8939966636 Rad」が 1 続きに見えた)。
                      長い答だけの問題ではなかった——`3 sin 0.0523…` の
                      ような中程度の答でも衝突していた。ここでは式を
                      別の行に置き、答の行に見える `=` を挟んで、答自体
                      も太字にする——**どちらも省略しない**、行を分けて
                      境目を作る、という選び方にした。
                    */}
                  <span className={styles.expression}>{entry.expression}</span>
                  <span className={styles.result}>
                    <span className={styles.equals} aria-hidden="true">
                      =
                    </span>
                    <span className={styles.answer}>{entry.answer}</span>
                    <span className={styles.angle}>{entry.angle}</span>
                  </span>
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
                  data-testid="history-entry"
                  data-error={entry.error ? true : undefined}
                >
                  <span className={styles.expression}>{entry.expression}</span>
                  <span className={styles.result}>
                    <span className={styles.equals} aria-hidden="true">
                      =
                    </span>
                    <span className={styles.answer}>{entry.answer}</span>
                    <span className={styles.angle}>{entry.angle}</span>
                  </span>
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
      {/* **フッタは常に描く**(Task 14)。空のときは元々ここへ到達しなかった
          ——旧コードは `entries.length === 0` の分岐がここごと早期リターン
          していたので、「1 度も計算していないが記録は切りたい」利用者に
          全消し(消せる物が無い)は出さないが、トグル(いま入か切かを
          見せるだけ)は出す必要がある(ブリーフ)。 */}
      <div className={styles.footer}>
        {entries.length > 0 && (
          // 一覧の下(設計書どおり)。**見た目は控えめに**——`戻る` の隣に
          // あった危険色の塊はやめ、地の色に溶ける文字ボタンにする
          // (Fix round Finding B)。取り消せない操作ではあるので色は
          // `--error-fg` を残すが、面を塗らない。
          <div className={styles.clearAllRow}>
            <button
              type="button"
              className={styles.clearAll}
              aria-label="すべて消す"
              onClick={onClearAll}
            >
              すべて消す
            </button>
          </div>
        )}
        {/* **切る≠消す**(設計書 §7)。`すべて消す` の隣に置いて、
            文言でも 2 つを分ける——「記録する」と「消す」で動詞を変え、
            注記で「消えません」と明示する(ブリーフ「obvious that turning
            it off is not erasing」)。アクセシブルネームは状態に関わらず
            固定の文字列("今後の計算を記録する")——チェック状態は
            `checked` が持つので、名前を "オン"/"オフ" で切り替える必要が
            無い(そうすると E2E が状態ごとに違う名前を探すことになる)。 */}
        <div className={styles.recordingRow}>
          <label className={styles.recordingLabel}>
            <input
              type="checkbox"
              className={styles.recordingCheckbox}
              checked={recordingEnabled}
              onChange={(event) =>
                onRecordingEnabledChange(event.target.checked)
              }
            />
            今後の計算を記録する
          </label>
          <p className={styles.recordingNote}>
            オフにしても、すでに記録した履歴は消えません。
          </p>
        </div>
      </div>
    </div>
  );
}

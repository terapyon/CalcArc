import { useEffect, useState } from "react";
import { type ApplyUpdate, watchForUpdate } from "../../pwa";
import styles from "./UpdateToast.module.css";

/**
 * E2E 用の入口。**本番の挙動は変えない**——トーストを最初から見せるだけで、
 * ボタンの動きは同じである(実 SW の世代交代は自動テストで再現しない。
 * 設計書 §4)。
 */
function previewRequested(): boolean {
  return (
    new URLSearchParams(window.location.search).get("sw-toast") === "preview"
  );
}

export function UpdateToast() {
  const [waiting, setWaiting] = useState(previewRequested);
  const [apply, setApply] = useState<ApplyUpdate | null>(null);

  useEffect(() => {
    let cancelled = false;
    watchForUpdate(() => {
      if (!cancelled) setWaiting(true);
    }).then(
      (applyUpdate) => {
        // setState に関数を渡すと更新関数と解釈されるので包む。
        if (!cancelled) setApply(() => applyUpdate);
      },
      () => {
        // 登録できない環境では何も出さない。画面は壊さない。
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape で閉じる。トーストはフォーカスを取らないので、キーはどこで
  // 押されるか分からない——window で受ける(useKeyboard.ts と同じ流儀)。
  //
  // **capture 段で受けて止める。** `useKeyboard` の KEYBOARD_MAP は
  // `Escape: "ac"` なので、bubble で受けると閉じた瞬間に AC が走って計算が
  // 全部消える。capture は bubble のリスナより必ず先に走るので、開いている
  // あいだだけ Escape を飲み込めば衝突は決定的に消える。
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setWaiting(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [waiting]);

  return (
    /*
      **領域は常設である。中身だけが出入りする**(設計書 §6)。

      以前は `if (!waiting) return null` で、更新が来た瞬間に**領域と中身を
      同時に**挿入していた。**「在る」と「鳴る」は別**である——多くの読み上げは
      live 領域そのものが挿入された瞬間には鳴らず、**すでに在る領域の中身が
      変わったとき**に鳴る。鳴らせるには、先に在る必要がある。

      **手本は `Readout.tsx:69-90`**——条件付き return を持たず、空のまま
      領域を置く(番人は `eng-notation.spec.ts:34,58,88` の `toBeEmpty()`)。
      **新しい流儀を作らない。**

      **常設にするのは領域だけ。** メッセージとボタンは `waiting` のときだけ
      描く——**空のときにボタンが在ると、見えないものにフォーカスが入る。**

      **空のときの高さは 0 である。** `.toast` は `position: fixed` なので
      (`UpdateToast.module.css:2`)中身は通常フローから抜けており、外側の
      この `<div>` は縦を 1px も食わない。**見立てではなく実測である**
      ——`viewport-budget.spec.ts` の 13 route × 2 幅が緑であることで確かめた
      (Finance の余白は常設化の前後どちらも 16.3125px)。
    */
    <div
      role="status"
      aria-label="更新のお知らせ"
      // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
      aria-live="polite"
    >
      {waiting && (
        <div className={styles.toast}>
          <p className={styles.message}>
            新しいバージョンがあります。再読み込みすると入力中の内容は消えます。
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => apply?.()}
            >
              再読み込み
            </button>
            <button type="button" onClick={() => setWaiting(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

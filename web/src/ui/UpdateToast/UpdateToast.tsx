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

  if (!waiting) return null;

  return (
    <div
      className={styles.toast}
      role="status"
      aria-label="更新のお知らせ"
      // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
      aria-live="polite"
    >
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
  );
}

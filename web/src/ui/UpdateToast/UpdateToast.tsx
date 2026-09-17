import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type ApplyUpdate, watchForUpdate } from "../../pwa";
import { ESCAPE_LAYER, escapeTakenAbove } from "../escapeLayers";
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

/**
 * トーストのボタンの文字。**export してあるのは、マニュアルのキー名の番人が
 * 読むため**(`tests/unit/manual-key-names.test.ts`)。
 */
export const UPDATE_TOAST_LABELS = {
  reload: "再読み込み",
  close: "閉じる",
} as const;

/**
 * **閉じたあと、もう一度出すまでの間隔。60 分**(0.9.3 設計書 §3.3)。
 *
 * **裁定は「閉じても再び出す」**(利用者、2026-09-17)——**「閉じられなくする」は
 * 採らなかった**。【閉じる】も Escape もそのまま残る。
 *
 * **60 分はこの設計書の決めである。** 確認の間隔が 6 時間(`pwa/index.ts` の
 * `UPDATE_CHECK_INTERVAL_MS`)なので、**1 回の検知につき 6 時間で最大 5 回**。
 * **閉じた直後には出ない。** **実測の裏づけは無い**——邪魔かどうかは使ってみるまで
 * 分からない。**検査がこの値を綴っている**ので、変えれば差分に残る。
 */
export const TOAST_REPROMPT_MS = 60 * 60 * 1000;

export function UpdateToast() {
  const [waiting, setWaiting] = useState(previewRequested);
  const [apply, setApply] = useState<ApplyUpdate | null>(null);
  // **待機している版が在るか。** 閉じても落とさない——**再提示の判断に要る**。
  // `waiting` は「**いま出しているか**」だけを表す(0.9.3 設計書 §3.3)。
  const pendingRef = useRef(previewRequested());
  const repromptRef = useRef<number | null>(null);

  /**
   * 閉じる。**待機している版が在るなら、60 分後にもう一度出す約束をする。**
   *
   * **閉じる経路は 2 つある**(【閉じる】と Escape)——**どちらもここを通す**。
   * 片方だけに再提示を書くと、**もう片方が「閉じたら二度と出ない」経路になる**。
   */
  // **`useCallback` で包むのは、下の Escape の effect が依存に挙げるためである。**
  // 毎描画で作り直すと、**Escape の購読が描画のたびに張り直される**。
  // 中で触るのは ref と setState だけなので、依存は空でよい。
  const dismiss = useCallback(() => {
    setWaiting(false);
    if (!pendingRef.current) return;
    if (repromptRef.current !== null) window.clearTimeout(repromptRef.current);
    repromptRef.current = window.setTimeout(() => {
      repromptRef.current = null;
      setWaiting(true);
    }, TOAST_REPROMPT_MS);
  }, []);

  // 約束は画面が消えるときに捨てる(jsdom の警告と、外れた timer を残さない)。
  useEffect(
    () => () => {
      if (repromptRef.current !== null) {
        window.clearTimeout(repromptRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    watchForUpdate(() => {
      if (!cancelled) {
        // **待機している版が現れた。** 閉じられても、この事実は残る。
        pendingRef.current = true;
        setWaiting(true);
      }
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
  //
  // **上に層があるときは受けない**(0.9.3 設計書 §2.5、裁定 #4
  // 「リンク集が開いているときの Escape は、リンク集を閉じるだけ」)。
  // **リンク集も capture 段の window に付く**ので、**リスナの付いた順では
  // 決まらない**——`escapeLayers.ts` の註にその理由がある。
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (escapeTakenAbove(ESCAPE_LAYER.updateToast)) return;
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [waiting, dismiss]);

  // **お知らせが覆う下の帯のぶん、ページに空きを足す**(2026-09-12、利用者の
  // 裁定 (a)。門 1 の設計書 §1.5)。お知らせは下に固定され(`position: fixed`)、
  // それまでは**ページの下に空きを取っていなかった**——いちばん下までスクロール
  // しても最後の行がお知らせの下に残り、Safari の高さで 41〜66 個、390×844 でも
  // 5 個のキーが押せなかった(`short-screens.spec.ts` が測った)。
  //
  // - **高さは実物から測る。** 文言・書体・幅・`safe-area` で変わるので、数字を
  //   決め打ちしない。帯 = 見える高さ − お知らせの上端(下の余白 12px も含む)
  // - **足すのは 2 つ。** ページの下の空き(スクロールできる所を作る)と、
  //   根の `scroll-padding-bottom`(フォーカスや `scrollIntoView` が、キーを
  //   お知らせの下ではなく上に止める)
  // - **お知らせが出ていないときは何も変えない**——空きも余白も 0、要素も無い
  //   (予算の検査と README の写真の番人が、1px も変わっていないことを見る)
  const toastRef = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(0);

  useLayoutEffect(() => {
    if (!waiting) {
      setReserve(0);
      return;
    }
    const measure = () => {
      const rect = toastRef.current?.getBoundingClientRect();
      // 寸法の取れない環境(jsdom)では 0 のまま——空きを作らない。
      setReserve(
        rect && rect.height > 0 ? Math.ceil(window.innerHeight - rect.top) : 0,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [waiting]);

  useEffect(() => {
    if (reserve === 0) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${reserve}px`;
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, [reserve]);

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
      ——`viewport-budget.spec.ts` の 11 route × 2 幅が緑であることで確かめた
      (**13 ではない**。`#scale/llm` と `#convert/currency` は同ファイルに
      理由つきで巡回の外に置かれている)
      (Finance の余白は常設化の前後どちらも 16.3125px)。
    */
    <>
      <div
        role="status"
        aria-label="更新のお知らせ"
        // 更新は事故ではない。読み上げを割り込ませない(設計書 §2)。
        aria-live="polite"
      >
        {waiting && (
          <div ref={toastRef} className={styles.toast}>
            <p className={styles.message}>
              新しいバージョンがあります。再読み込みすると入力中の内容は消えます。
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => apply?.()}
              >
                {UPDATE_TOAST_LABELS.reload}
              </button>
              <button type="button" onClick={dismiss}>
                {UPDATE_TOAST_LABELS.close}
              </button>
            </div>
          </div>
        )}
      </div>
      {/* 空きは live 領域の外に置く——中身の出入りで読み上げが鳴らないように。 */}
      {reserve > 0 && <div aria-hidden="true" style={{ height: reserve }} />}
    </>
  );
}

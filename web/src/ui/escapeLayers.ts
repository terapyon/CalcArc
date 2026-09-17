/**
 * Escape を受け取る層（0.9.3 設計書 §2.5、裁定 #4）。
 *
 * **Escape の行き先が 3 つになった**——リンク集を閉じる／更新のお知らせを
 * 閉じる（`UpdateToast.tsx`）／`ac`（`useKeyboard.ts` の `KEYBOARD_MAP`）。
 * **裁定は「開いているもののうち、上の 1 つだけが受ける」**で、順は
 * **リンク集 → 更新のお知らせ → `ac`** である。
 *
 * ## なぜ `stopPropagation` だけでは決まらないか（**ここが要点**）
 *
 * 更新のお知らせは **window の capture 段**で Escape を飲む（`ac` は window の
 * bubble 段なので、capture で止めれば決定的に先を越せる）。**リンク集も
 * 同じ形にすると、両方が capture 段の window に付く**——**同じ要素・同じ段の
 * リスナは、付けた順に走る。**
 *
 * - お知らせが**先に出ていた**なら、お知らせのリスナが先に付いている
 *   → **Escape でお知らせも一緒に閉じる**（裁定に反する）
 * - `stopImmediatePropagation` でも同じである——**あれは「あとに付いた
 *   リスナ」しか止められない。**
 *
 * **だから順序に頼らない。** 開いている層をここに登録し、**各層は
 * 「自分より上が開いていないか」を見てから受ける。** リスナの付いた順と
 * 無関係に、受けるのは常に 1 つである。
 *
 * **`ac` はここに登録しない。** あれは「何も開いていないときの行き先」で
 * あって層ではない——上の層が capture 段で止めれば、bubble 段まで来ない。
 */

/**
 * 層の高さ。**大きいほど上**で、Escape を先に取る。
 *
 * **数は 2 つだけである**（リンク集と更新のお知らせ）。3 つ目を足すときは、
 * **裁定の順序（設計書 §2.5）に当てて位置を決める**こと。
 */
export const ESCAPE_LAYER = {
  /** 更新のお知らせ（`UpdateToast`）。 */
  updateToast: 1,
  /** リンク集（`LinksPopup`）。**いちばん上**。 */
  links: 2,
} as const;

export type EscapeLayer = (typeof ESCAPE_LAYER)[keyof typeof ESCAPE_LAYER];

/** いま開いている層。**同じ高さが 2 つ開くことは想定しない**（どちらも 1 つきり）。 */
const open = new Set<EscapeLayer>();

/**
 * 層を開く。**戻り値を呼ぶと閉じる**（`useEffect` の後始末にそのまま渡せる）。
 *
 * **閉じ忘れると、その層より下は Escape を受け取れなくなる**ので、
 * **開く側は必ず後始末で閉じる。**
 */
export function openEscapeLayer(layer: EscapeLayer): () => void {
  open.add(layer);
  return () => {
    open.delete(layer);
  };
}

/**
 * 自分より上の層が開いているか。**開いているなら、自分は Escape を受けない。**
 */
export function escapeTakenAbove(mine: EscapeLayer): boolean {
  for (const layer of open) {
    if (layer > mine) return true;
  }
  return false;
}

/** 検査のための後始末。**本番の経路からは呼ばない。** */
export function resetEscapeLayersForTest(): void {
  open.clear();
}

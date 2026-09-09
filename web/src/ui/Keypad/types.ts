import type { KeyVariant } from "../Key/Key";

/**
 * トークンを送らず、UI の操作を起こす面。
 *
 * **`kind` に相乗りさせない**——`kind` は「面を切り替えるキー自身」の意味で
 * 使っている。**データは「何を」だけを言い、「どう」は `Keypad` が持つ**
 * (`kind: "shift"` と同じ形。設計書 `2026-09-03-history-design.md` §9.3、
 * 計画 §A-1)。
 */
export type KeyAction = "history";

/** Shift の第 2 面で差し替わる内容。 */
export interface ShiftFace<T> {
  token: T | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
  /** 押すとトークンではなく操作が起きる。**`token` は null になる。** */
  action?: KeyAction;
}

export interface KeyDef<T> {
  /** 押したときに送るトークン。予約スロットは null(何も送らない)。 */
  token: T | null;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
  /** Shift 面での差し替え。無ければ面によらず同じ。 */
  shift?: ShiftFace<T>;
  /** 面を切り替えるキー自身。 */
  kind?: "shift";
  /** 押すとトークンではなく操作が起きる。**`token` は null になる。** */
  action?: KeyAction;
}

/**
 * キーパッドの 1 区画。列数と行の高さを持つ。
 *
 * Scientific は「関数列(半高・7 列)」と「メイングリッド(正方・5 列)」の
 * 2 区画で、Finance と Data Scale も同じ部品に自分のキー集合を渡す(S1 設計書 §6)。
 *
 * **トークンの型 T は呼び出し側が決める**(L 設計書 §4)。キーパッドは
 * 「押されたら T を返す」ことしか知らない——calc の語彙に縛られると、
 * UI の都合で計算コアの語彙を増やすことになる。
 */
export interface KeypadSection<T> {
  ariaLabel: string;
  columns: number;
  /**
   * 行の高さ。square = 正方、half = 半高(設計書 §4)、double = 半高の 2 倍。
   *
   * **double は 2 行のラベルを持つ行のためにある**(0.2.0 設計書 §8)。
   * 文字の大きさは half と同じで、器だけが倍になる。
   */
  height: "square" | "half" | "double";
  keys: KeyDef<T>[];
}

/**
 * キーが押せない理由。**押せる場合は `null`。**
 *
 * **2 つに分けるのは、利用者から見た絵が違うからである**（設計書
 * `2026-08-31-two-shades-of-off.md`）:
 *
 * - `"permanent"` —— **この盤面では、いかなる操作でも生き返らない。**
 *   予約スロット（`token === null`）と、計算しない盤面の演算子
 *   （`isDeadOperator`）がこれである
 * - `"transient"` —— **いつか生き返る。** 盤面の操作で戻るもの（数字を打てば
 *   演算子が押せる、等）と、**データの到着を待つもの**（通貨のレート表）を
 *   両方含む——**生き返る条件が操作かデータかは、利用者から見た絵を分けない。
 *   分けるのは「いつか生き返るか／永久に生き返らないか」である**
 *   （ユーザー裁定 2026-08-31）
 *
 * **`boolean` に戻さないこと。** 0.5.0 で「この盤面では永久に押せない」を
 * `disabled?: boolean`（＝条件が変われば押せる、の口）へ入れたために、
 * **散文の契約が黙って破れた**——**型で塞いである。**
 */
export type Offness = "permanent" | "transient";

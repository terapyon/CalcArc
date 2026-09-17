/**
 * URL のハッシュから、いま出すモジュールとカテゴリを導く。
 *
 * **React を import しない**(web/src/calc と同じ境界の流儀)。
 *
 * ハッシュは 2 段である(設計書 §3)——先頭が系統、2 番目がカテゴリ。
 * この形にしておくと、U-1 が `#convert/length` を足すときに
 * ここの構造は変わらず、下の表に行が増えるだけになる。
 * **U-1 で実際にそうなった**——増えたのは表の 2 行だけである。
 */

import { CONVERT_CATEGORY_IDS, type ConvertCategoryId } from "./convert/types";

export type ModuleId = "scientific" | "convert" | "scale" | "finance";

/**
 * タブではない画面（0.9.3 設計書 §2.2）。
 *
 * **`ModuleId` に足さない。** あれは**タブの id** であり、`Nav.tsx` の `MODULES` が
 * `Record<ModuleId, …>` なので、**足すとタブが 5 つになる**——`#manual` は
 * **リンク集から開く読み物**であって、計算機のタブではない。
 */
export type PageId = "manual";

export type Route = {
  module: ModuleId;
  category: string | null;
  /**
   * タブではない画面を出しているとき、その id。
   *
   * **`module` は残す**（`null` にしない）——**戻り先**である。`#manual` を
   * 閉じたときに戻る先があるし、`module` を `null` 許容にすると
   * **タブを読むすべての場所が `null` を扱うことになる**。
   * **タブの現在地を出さない**のは `App` の仕事で、`Nav` に `null` を渡す。
   *
   * **任意にしてある。** 必須にすると、`tests/promised-urls.ts` の URL の約束や
   * 画面名の検査まで、**この欄に意味を持たない側が `page: null` を書く**ことになる。
   * **タブの画面では「無い」で足りる。**
   */
  page?: PageId;
};

const MODULES: readonly ModuleId[] = [
  "scientific",
  "convert",
  "scale",
  "finance",
];

/** Scale 系統のカテゴリ。**表はここが唯一の出所**——盤面の `<select>` も
 * この配列から起こす(U-0 §3 の「同じ画面に 2 つの URL を作らない」)。 */
export const SCALE_CATEGORIES = ["data-scale", "llm", "transfer"] as const;

export type ScaleCategory = (typeof SCALE_CATEGORIES)[number];

/** Convert 系統のカテゴリ。**配列そのものは `convert/types.ts` が持つ**
 * ——あちらは Rust の `Category::ALL` と `token_parity.rs` が突き合わせる表で、
 * ここで綴りを写すと機械の検査が届かない 3 つ目の写しができる。ここは
 * SCALE_CATEGORIES と同じ名前で盤面へ渡すだけの別名である。
 *
 * **U-4 で 8 つになった。** 参照するのは `CONVERT_CATEGORY_IDS`(7 + 為替)で
 * あって `CONVERT_CATEGORY_TOKENS`(境界の 7)ではない——**`#convert/currency`
 * を既知のカテゴリにするのはここである**。 */
export const CONVERT_CATEGORIES = CONVERT_CATEGORY_IDS;

export type ConvertCategory = ConvertCategoryId;

/** 系統ごとに存在するカテゴリ。**U-1 で convert が 2 つ目の中身を持つ。** */
const CATEGORIES: Record<ModuleId, readonly string[]> = {
  scientific: [],
  convert: CONVERT_CATEGORIES,
  scale: SCALE_CATEGORIES,
  finance: [],
};

/** 系統ごとの既定カテゴリ。無い・知らないときはここへ倒す。 */
const DEFAULT_CATEGORY: Record<ModuleId, string | null> = {
  scientific: null,
  convert: "length",
  scale: "data-scale",
  finance: null,
};

function isModuleId(text: string): text is ModuleId {
  return (MODULES as readonly string[]).includes(text);
}

export function routeFromHash(hash: string): Route {
  const [head = "", category] = hash.replace(/^#/, "").split("/");
  // **タブではない画面を先に見る**(0.9.3 設計書 §2.2)。`isModuleId` の外に
  // 置くのは、**タブの一覧（`MODULES`）を増やさないため**である。
  // **`module` は既定のまま残す**——閉じたときの戻り先になる。
  if (head === "manual") {
    return { module: "scientific", category: null, page: "manual" };
  }
  // **知らない先頭は既定へ倒す。** 旧 `#data-scale` も `#loan` もここに
  // 落ちる——互換分岐は作らない(設計書 §1-4)。**これは 1.0 までの方針
  // である。** 1.0 のあとは `web/tests/promised-urls.ts` の URL が同じ画面を
  // 開き続ける約束なので(1.0 の門の設計書 §2.3、利用者の裁定 2026-09-10)、
  // そのどれかを消す・綴りを変えるなら、**古い URL を新しい画面へ向ける
  // 分岐をここに足す。**
  if (!isModuleId(head)) return { module: "scientific", category: null };
  const known = category !== undefined && CATEGORIES[head].includes(category);
  return { module: head, category: known ? category : DEFAULT_CATEGORY[head] };
}

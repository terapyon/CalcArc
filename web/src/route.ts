/**
 * URL のハッシュから、いま出すモジュールとカテゴリを導く。
 *
 * **React を import しない**(web/src/calc と同じ境界の流儀)。
 *
 * ハッシュは 2 段である(設計書 §3)——先頭が系統、2 番目がカテゴリ。
 * この形にしておくと、U-1 が `#convert/length` を足すときに
 * ここの構造は変わらず、下の表に行が増えるだけになる。
 */

export type ModuleId = "scientific" | "convert" | "scale" | "finance";

export type Route = { module: ModuleId; category: string | null };

const MODULES: readonly ModuleId[] = [
  "scientific",
  "convert",
  "scale",
  "finance",
];

/** 系統ごとに存在するカテゴリ。**U-0 では scale だけが中身を持つ。** */
const CATEGORIES: Record<ModuleId, readonly string[]> = {
  scientific: [],
  convert: [],
  scale: ["data-scale"],
  finance: [],
};

/** 系統ごとの既定カテゴリ。無い・知らないときはここへ倒す。 */
const DEFAULT_CATEGORY: Record<ModuleId, string | null> = {
  scientific: null,
  convert: null,
  scale: "data-scale",
  finance: null,
};

function isModuleId(text: string): text is ModuleId {
  return (MODULES as readonly string[]).includes(text);
}

export function routeFromHash(hash: string): Route {
  const [head, category] = hash.replace(/^#/, "").split("/");
  // **知らない先頭は既定へ倒す。** 旧 `#data-scale` も `#loan` もここに
  // 落ちる——互換分岐は作らない(設計書 §1-4)。
  if (!isModuleId(head)) return { module: "scientific", category: null };
  const known = category !== undefined && CATEGORIES[head].includes(category);
  return { module: head, category: known ? category : DEFAULT_CATEGORY[head] };
}

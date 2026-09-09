import { CONVERT_CATEGORY_IDS, type ConvertCategoryId } from "../convert/types";
import { type Route, SCALE_CATEGORIES, type ScaleCategory } from "../route";

/**
 * 画面の名前。**13 個を 1 か所で持つ**(設計書 §2)。
 *
 * **`route.ts` には置かない**(設計書 §2.1)。あのファイルの註は
 * 「**React を import しない**(`web/src/calc` と同じ境界の流儀)」であり、
 * UI の表示文字列を持たせると `route.ts` が `ui/Keypad/convert.ts` と
 * `ui/Scale/ScalePanel.tsx` を import することになる——**境界の向きが逆になる**。
 * 画面名は UI 層のものなので、置き場も `web/src/ui/` である。
 *
 * **表は手で書く**(設計書 §2.2)。`` `${CATEGORY_LABELS[id]}の換算` `` と
 * 組み立てる形も採れるが採らない——**利用者が承認したのは 13 個の綴りそのもの**
 * であって組み立て規則ではなく、組み立てにすると**承認された綴りがどこにも
 * 書かれていない**状態になる。代わりに**出どころとの繋がりを検査が見張る**
 * (`screenName.test.ts` の `toContain`)——`長さ` を改名した日に、画面名だけ
 * 古いまま残ることが無くなる。
 *
 * **`Record<…>` にするのは、カテゴリが増えたときに埋め忘れが typecheck で
 * 落ちるから**である(`Nav.tsx` の `MODULES` と `ScalePanel` の `LABELS` と
 * 同じ流儀)。11 個の網羅は型が持つので、数える必要があるのは
 * **「11 + 2 = 13」の 2 のほう**だけになる。
 */
export const SCREEN_NAMES: {
  scientific: string;
  finance: string;
  convert: Record<ConvertCategoryId, string>;
  scale: Record<ScaleCategory, string>;
} = {
  scientific: "関数電卓",
  convert: {
    length: "長さの換算",
    mass: "質量の換算",
    temperature: "温度の換算",
    area: "面積の換算",
    volume: "体積の換算",
    speed: "速さの換算",
    // **`データ量` は Scale の `data-scale` と衝突する**(U-2 §2)。
    // 画面には英語を混ぜたくないので、「換算」と「規模」でほどく。
    "data-size": "データ量の換算",
    currency: "為替の換算",
  },
  scale: {
    "data-scale": "データ量の規模",
    llm: "LLM のメモリ",
    transfer: "データ転送",
  },
  finance: "金融計算",
};

/** Convert の既知のカテゴリか。**`ScalePanel` の `isCategory` と同じ形**で受ける
 * ——`routeFromHash` が既定へ倒すので `null` も知らない綴りも通常は来ないが、
 * **型の上では来る**(`Route` の `category` は `string | null`)。 */
function isConvertCategory(text: string | null): text is ConvertCategoryId {
  return (CONVERT_CATEGORY_IDS as readonly string[]).includes(text ?? "");
}

/** Scale の既知のカテゴリか。上と同じ理由で置く。 */
function isScaleCategory(text: string | null): text is ScaleCategory {
  return (SCALE_CATEGORIES as readonly string[]).includes(text ?? "");
}

/**
 * いまの route の画面名。
 *
 * **落とし先は `route.ts` の `DEFAULT_CATEGORY` と同じ綴りにしてある**
 * ——`convert` は `length`、`scale` は `data-scale`。画面が既定のカテゴリを
 * 出しているときに、名前だけ別のものになることを避けるためである。
 */
export function screenName(route: Route): string {
  switch (route.module) {
    case "scientific":
      return SCREEN_NAMES.scientific;
    case "finance":
      return SCREEN_NAMES.finance;
    case "convert":
      return SCREEN_NAMES.convert[
        isConvertCategory(route.category) ? route.category : "length"
      ];
    case "scale":
      return SCREEN_NAMES.scale[
        isScaleCategory(route.category) ? route.category : "data-scale"
      ];
  }
}

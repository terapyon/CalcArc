import { describe, expect, it } from "vitest";
import { CONVERT_CATEGORY_IDS } from "../convert/types";
import { routeFromHash, SCALE_CATEGORIES } from "../route";
import { CATEGORY_LABELS } from "./Keypad/convert";
import { LABELS } from "./Scale/ScalePanel";
import { SCREEN_NAMES, screenName } from "./screenName";

describe("SCREEN_NAMES", () => {
  it("holds one name per screen, counted from the category tables", () => {
    // **数を導く。`13` と手で書かない**——カテゴリが増えた日に、この検査が
    // 「13 のまま緑」で通り過ぎてしまわないようにするためである。
    // 内訳は scientific 1 + convert 8 + scale 3 + finance 1。
    const expected =
      1 + CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1;
    const names = [
      SCREEN_NAMES.scientific,
      ...Object.values(SCREEN_NAMES.convert),
      ...Object.values(SCREEN_NAMES.scale),
      SCREEN_NAMES.finance,
    ];
    expect(names).toHaveLength(expected);
  });

  it("keeps every convert name tied to the label the keypad shows", () => {
    // **表は手で書いてある**(設計書 §2.2)ので、出どころとの繋がりは
    // 機械が見張るしかない。`CATEGORY_LABELS.length` を「長さ」から
    // 改名した日に、画面名だけ「長さの換算」で古いまま残ることを止める。
    for (const id of CONVERT_CATEGORY_IDS) {
      expect(SCREEN_NAMES.convert[id]).toContain(CATEGORY_LABELS[id]);
    }
    // **1 度も比較しなかった格子で緑になる**ことを防ぐ(空主張よけ)。
    expect(CONVERT_CATEGORY_IDS.length).toBeGreaterThan(0);
  });

  it("keeps every scale name tied to the label the panel shows", () => {
    // 上と同じ理由。Scale 側の出どころは `ScalePanel` の `LABELS`(日英併記)で、
    // 画面名が引き継ぐのは日本語のほうだけである。
    for (const id of SCALE_CATEGORIES) {
      expect(SCREEN_NAMES.scale[id]).toContain(LABELS[id].ja);
    }
    expect(SCALE_CATEGORIES.length).toBeGreaterThan(0);
  });
});

describe("screenName", () => {
  // **期待値は逐一書く**(設計書 §2.2)。表から組み立てると、実装と期待値が
  // 同時に間違っても緑になる——利用者が承認したのは 13 個の綴りそのものなので、
  // その綴りがテストにも 1 文字ずつ書かれている必要がある。
  it("names the scientific screen", () => {
    expect(screenName(routeFromHash("#scientific"))).toBe("関数電卓");
  });

  it("names all eight convert screens", () => {
    expect(screenName(routeFromHash("#convert/length"))).toBe("長さの換算");
    expect(screenName(routeFromHash("#convert/mass"))).toBe("質量の換算");
    expect(screenName(routeFromHash("#convert/temperature"))).toBe(
      "温度の換算",
    );
    expect(screenName(routeFromHash("#convert/area"))).toBe("面積の換算");
    expect(screenName(routeFromHash("#convert/volume"))).toBe("体積の換算");
    expect(screenName(routeFromHash("#convert/speed"))).toBe("速さの換算");
    expect(screenName(routeFromHash("#convert/data-size"))).toBe(
      "データ量の換算",
    );
    expect(screenName(routeFromHash("#convert/currency"))).toBe("為替の換算");
  });

  it("names all three scale screens", () => {
    // **`データ量` が 2 つある**(Convert の `data-size` と Scale の
    // `data-scale`。U-2 §2)。画面名は「換算」と「規模」でほどいており、
    // ここはその 2 つが本当に違う文字列であることも見ている。
    expect(screenName(routeFromHash("#scale/data-scale"))).toBe(
      "データ量の規模",
    );
    expect(screenName(routeFromHash("#scale/llm"))).toBe("LLM のメモリ");
    expect(screenName(routeFromHash("#scale/transfer"))).toBe("データ転送");
    expect(screenName(routeFromHash("#scale/data-scale"))).not.toBe(
      screenName(routeFromHash("#convert/data-size")),
    );
  });

  it("names the finance screen", () => {
    expect(screenName(routeFromHash("#finance"))).toBe("金融計算");
  });

  it("falls back to the default category's name when the route has none", () => {
    // `routeFromHash` が既定へ倒すのでこの形の route は通常は来ないが、
    // **`Route` の `category` は `string | null` なので型の上では来る**。
    // 落とし先は `route.ts` の `DEFAULT_CATEGORY` と同じ綴りにしてある。
    expect(screenName({ module: "convert", category: null })).toBe(
      "長さの換算",
    );
    expect(screenName({ module: "scale", category: null })).toBe(
      "データ量の規模",
    );
  });

  it("falls back the same way when the category is one it does not know", () => {
    expect(screenName({ module: "convert", category: "nope" })).toBe(
      "長さの換算",
    );
    expect(screenName({ module: "scale", category: "nope" })).toBe(
      "データ量の規模",
    );
  });
});

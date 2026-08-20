import { describe, expect, it } from "vitest";
import {
  CONVERT_CATEGORY_IDS,
  CONVERT_CATEGORY_TOKENS,
  CONVERT_UNIT_TOKENS,
} from "../../convert/types";
import { CURRENCY_TOKENS } from "../../currency/types";
import {
  CATEGORY_LABELS,
  CATEGORY_LABELS_EN,
  CONVERT_SECTIONS,
  CURRENCY_LABELS,
  faceUnitsOf,
  UNIT_LABELS,
  unitSections,
  unitsOf,
} from "./convert";

/** いま出ている面のキー(項目行の下)。 */
const face = (sections: ReturnType<typeof unitSections>) => {
  const section = sections[1];
  if (section === undefined) throw new Error("面が無い");
  return section;
};

const PAD = face(CONVERT_SECTIONS);

describe("Convert のキー集合", () => {
  it("names every unit of every category exactly once", () => {
    // **ラベル・読み上げ・トークンを手で 3 つ並べない。** いつか 1 つだけずれる。
    const named: string[] = [];
    for (const category of CONVERT_CATEGORY_TOKENS) {
      const keys = face(unitSections(category)).keys.filter((k) =>
        k.token?.startsWith("unit:"),
      );
      for (const key of keys) {
        const token = key.token?.replace("unit:", "");
        expect(CONVERT_UNIT_TOKENS).toContain(token);
        if (token !== undefined) named.push(token);
      }
    }
    // 1 つも余らず、1 つも欠けない(63)。**件数だけでは足りない**——
    // 1 つ重複して 1 つ欠けても件数は合う。中身も突き合わせる。
    expect(named).toHaveLength(CONVERT_UNIT_TOKENS.length);
    expect([...named].sort()).toEqual([...CONVERT_UNIT_TOKENS].sort());
  });

  it("keeps the units in the order the boundary returns them", () => {
    // `CONVERT_UNIT_TOKENS` は `Unit::ALL`(= `convert_units()` が返す順)と
    // 同じ順に保たれている。**盤面の並びは境界の並びである**(convert/types.ts)。
    let checked = 0;
    for (const category of CONVERT_CATEGORY_TOKENS) {
      const shown = face(unitSections(category)).keys.flatMap((k) =>
        k.token?.startsWith("unit:") ? [k.token.replace("unit:", "")] : [],
      );
      expect(shown).toEqual([...unitsOf(category)]);
      // 絞り込みではなく並びを見ている——`CONVERT_UNIT_TOKENS` の順で読める。
      expect(shown).toEqual(
        CONVERT_UNIT_TOKENS.filter((unit) => shown.includes(unit)),
      );
      expect(shown.length).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBe(7);
    expect(unitsOf("length")).toHaveLength(11);
    expect(unitsOf("mass")).toHaveLength(7);
    expect(unitsOf("temperature")).toHaveLength(3);
    // U-2 の 4 カテゴリ(spec §2 の表)。
    expect(unitsOf("area")).toHaveLength(11);
    expect(unitsOf("volume")).toHaveLength(15);
    expect(unitsOf("speed")).toHaveLength(4);
    expect(unitsOf("data-size")).toHaveLength(12);
  });

  it("puts DEL and AC in the same place on every face", () => {
    // **枠が動かないことは E2E が見る。** ここで見るのは定義の位置である。
    const faces = [
      PAD,
      ...CONVERT_CATEGORY_IDS.map((category) => face(unitSections(category))),
    ];
    let checked = 0;
    for (const f of faces) {
      expect(f.columns).toBe(5);
      expect(f.height).toBe("square");
      expect(f.keys[3]?.token).toBe("del");
      expect(f.keys[4]?.token).toBe("ac");
      checked += 1;
    }
    // **数字面 + 8 カテゴリ。** 為替の面も同じ位置に DEL と AC を持つ
    // ——2 行目以降が 5 列でも、**1 行目は 3 列 + DEL + AC のまま**である。
    expect(checked).toBe(9);
  });

  it("spells the degree signs in the label, not in the token", () => {
    // **トークンは ASCII の小文字**(計画の裁定 1)。記号はラベルだけが持つ。
    expect(UNIT_LABELS.degc).toBe("°C");
    expect(UNIT_LABELS.degf).toBe("°F");
    expect(UNIT_LABELS.um).toBe("µm");
    expect(UNIT_LABELS.k).toBe("K");
    expect(UNIT_LABELS.m2).toBe("m²");
    expect(UNIT_LABELS.m3).toBe("m³");
    expect(UNIT_LABELS.l).toBe("L");
    expect(UNIT_LABELS.kb).toBe("kB");
    expect(UNIT_LABELS.kib).toBe("KiB");
    // トークンの側に非 ASCII を混ぜない(`µ` は 2 通りの符号位置を持つ)。
    // **U-2 で数字と `_` が入った**(`mm2` `gal_us`)が、ASCII のままである。
    let checked = 0;
    for (const token of CONVERT_UNIT_TOKENS) {
      expect(token).toMatch(/^[a-z0-9_]+$/);
      checked += 1;
    }
    expect(checked).toBe(63);
  });

  it("gives every unit key a spoken name of its own", () => {
    // 読み上げ名は日本語(base-spec §43)。`m` を「エム」と読ませない。
    const spoken = new Set<string>();
    for (const category of CONVERT_CATEGORY_IDS) {
      for (const key of face(unitSections(category)).keys) {
        if (key.token === null || !key.token.startsWith("unit:")) continue;
        // ASCII だけの読み上げ名は綴りをそのまま読ませることになる
        // (`JPY` は「ジェイピーワイ」、`CHF` は読み手ごとに変わる)。
        expect(key.ariaLabel).not.toMatch(/^[\u0020-\u007e]+$/);
        spoken.add(key.ariaLabel);
      }
    }
    // **単位 63 + 通貨 16。** 1 つでも重なれば件数が落ちる——
    // 「ドル」だけの名前を 6 通貨に付けたら、ここで見つかる。
    expect(spoken.size).toBe(
      CONVERT_UNIT_TOKENS.length + CURRENCY_TOKENS.length,
    );
  });

  it("offers the four fields the spec asks for", () => {
    const fields = CONVERT_SECTIONS[0];
    expect(fields?.columns).toBe(4);
    expect(fields?.height).toBe("half");
    expect(fields?.keys.map((k) => k.token)).toEqual([
      "field:value",
      "field:from",
      "field:to",
      "swap",
    ]);
  });

  it("lets the value be an expression", () => {
    // spec §4.3: `5*12` と打って inch を選べば 60 inch。
    const tokens = PAD.keys.map((k) => k.token);
    let checked = 0;
    for (const op of [
      "add",
      "sub",
      "mul",
      "div",
      "lparen",
      "rparen",
      "eq",
    ] as const) {
      expect(tokens).toContain(op);
      checked += 1;
    }
    expect(checked).toBe(7);
  });

  it("has a way to type a negative value", () => {
    // **`units/entry.ts:119-126` は空の式に `-` を置けない**(単項マイナスを持たない)。
    // 符号はパネルが持つ(計画の裁定 3)。**このキーが無いと不動点 −40 が打てない。**
    const tokens = PAD.keys.map((k) => k.token);
    expect(tokens).toContain("sign");
    const sign = PAD.keys.find((k) => k.token === "sign");
    expect(sign?.ariaLabel).toBe("符号を変える");
    // 1 行目の 3 列目(DEL・AC の隣)。数字面の並びは面の入れ替えで動かない。
    expect(PAD.keys[2]?.token).toBe("sign");
  });

  it("has a way to type a fractional value", () => {
    // `1 in = 25.4 mm`、`0 °C = 273.15 K`(spec §3.2)。**小数点が無ければ
    // 定義値そのものが打てない**——Data Scale と LLM がここを空きにしていたのは
    // 項目が整数だったからである。
    const tokens = PAD.keys.map((k) => k.token);
    expect(tokens).toContain("dot");
    expect(PAD.keys.find((k) => k.token === "dot")?.ariaLabel).toBe("小数点");
  });

  it("does not put a unit suffix on the value pad", () => {
    // 単位は「変換元」「変換先」が持つ。値の欄に `K`/`M`/`G` は要らない。
    const tokens = PAD.keys.map((k) => k.token);
    for (const suffix of ["k", "m", "g"]) {
      expect(tokens).not.toContain(suffix);
    }
    expect(tokens.filter((t) => t === null)).toHaveLength(3);
  });

  it("names every category in Japanese", () => {
    // **8 つある**——境界の 7 つ(`CONVERT_CATEGORY_TOKENS` = Rust の
    // `Category::ALL`)に、U-4 の為替が 1 つ足される。**為替は core の
    // カテゴリではない**ので、あちらの表には入らない(`convert/types.ts`)。
    expect(Object.keys(CATEGORY_LABELS)).toEqual([...CONVERT_CATEGORY_IDS]);
    expect(CATEGORY_LABELS.length).toBe("長さ");
    expect(CATEGORY_LABELS.mass).toBe("質量");
    expect(CATEGORY_LABELS.temperature).toBe("温度");
    expect(CATEGORY_LABELS.area).toBe("面積");
    expect(CATEGORY_LABELS.volume).toBe("体積");
    expect(CATEGORY_LABELS.speed).toBe("速さ");
    expect(CATEGORY_LABELS["data-size"]).toBe("データ量");
    expect(CATEGORY_LABELS.currency).toBe("為替");
  });

  it("names every category in English too", () => {
    // **併記のための表**(U-0 §9 の【変更 2026-08-20】)。日本語の表と鍵が
    // 揃っていないと、盤面が `undefined` を連結して出す。
    //
    // **鍵は `CONVERT_CATEGORY_IDS`(8)である。** ここには当初
    // `CONVERT_CATEGORY_TOKENS`(7)と書いてあった——**併記を入れた日には
    // 為替がまだ無く、7 と 8 の区別が付かなかった**。U-4 を積み直したときに
    // この行が赤くなって見つかった。
    expect(Object.keys(CATEGORY_LABELS_EN)).toEqual([...CONVERT_CATEGORY_IDS]);
    // **2 つの表の鍵が同じであること自体を主張する。** 上の 2 行は
    // どちらも「この表は 8 つの id を持つ」と言っているだけで、
    // **両者が同じ鍵であることは言っていない**——`ConvertPanel` が
    // 同じ id で 2 つの表を同時に引く以上、こちらが本体の不変条件である。
    expect(Object.keys(CATEGORY_LABELS_EN)).toEqual(
      Object.keys(CATEGORY_LABELS),
    );
    expect(CATEGORY_LABELS_EN.length).toBe("Length");
    expect(CATEGORY_LABELS_EN.mass).toBe("Mass");
    expect(CATEGORY_LABELS_EN.temperature).toBe("Temperature");
    expect(CATEGORY_LABELS_EN.area).toBe("Area");
    expect(CATEGORY_LABELS_EN.volume).toBe("Volume");
    expect(CATEGORY_LABELS_EN.speed).toBe("Speed");
    // **Scale の `data-scale` は `Data Scale`** である。日本語はどちらも
    // `データ量` で、**英語だけが 2 つの系統を分けている**(U-2 §2)。
    expect(CATEGORY_LABELS_EN["data-size"]).toBe("Data Size");
    expect(CATEGORY_LABELS_EN.currency).toBe("Currency");
  });

  it("writes the basis into the name where the unit has more than one", () => {
    // spec §0.0-3・§3.2・§3.4: **基準が 1 つに定まらない単位は、名前に基準を書く。**
    expect(UNIT_LABELS.jo).toContain("1.62");
    expect(UNIT_LABELS.cup_jp).toContain("200");
    for (const t of [
      "gal_us",
      "floz_us",
      "pt_us",
      "qt_us",
      "cup_us",
    ] as const) {
      expect(UNIT_LABELS[t]).toContain("US");
    }
    for (const t of ["gal_imp", "floz_imp", "pt_imp", "qt_imp"] as const) {
      expect(UNIT_LABELS[t]).toContain("Imp");
    }
  });

  it("never shows a bare cup or gallon", () => {
    // **裸の名前を使わない**(spec §3.4)。どの系か分からない表示を作らない。
    for (const label of Object.values(UNIT_LABELS)) {
      expect(label).not.toBe("cup");
      expect(label).not.toBe("gal");
      expect(label).not.toBe("畳");
    }
  });

  it("fits every category inside the frame", () => {
    // **単位に使えるのは左 3 列 × 5 行 = 15 スロット**(spec §0.0-4 の【訂正 2026-08-20】)。
    // **Volume はちょうど 15 で、容量いっぱいである。**
    //
    // **`unitsOf().length` から行数を計算しない。** それは `unitFace()` の
    // 詰め方(1 行 3 個)をここに書き写しただけのモデルで、`unitFace` の
    // 詰め方が変わっても緑のままになる。**実物を測る**——"puts DEL and AC
    // in the same place on every face" と同じ流儀で、`unitSections()` が
    // 実際に返すキー数を見る。枠は 5 行 × 5 列 = 25 セルが上限。
    let checked = 0;
    for (const category of CONVERT_CATEGORY_IDS) {
      const keys = face(unitSections(category)).keys;
      expect(
        keys.length,
        `${category} が 5 行(25 セル)に収まらない`,
      ).toBeLessThanOrEqual(25);
      checked += 1;
    }
    expect(checked).toBe(8);
    // **為替は 16 通貨で 4 行 20 セル**(実測 2026-08-20、spec §7)。
    // 左 3 列に詰めると 6 行 30 セルになって枠があふれる——**2 行目以降を
    // 5 列にしてある**。この件数が 30 に変わったら、それが起きている。
    expect(face(unitSections("currency")).keys).toHaveLength(20);
  });
  it("names every currency of the eighth category exactly once", () => {
    // **並びは境界の並びである**(`currency/types.ts` = Rust の
    // `Currency::ALL`)。**面の並びがレートの中身で動いてはならない**
    // (spec §7)ので、`unitSections` が返す順をそのまま突き合わせる。
    const shown = face(unitSections("currency")).keys.flatMap((key) =>
      key.token?.startsWith("unit:") ? [key.token.replace("unit:", "")] : [],
    );
    expect(shown).toEqual([...CURRENCY_TOKENS]);
    expect(shown).toHaveLength(16);
    expect(faceUnitsOf("currency")).toEqual(CURRENCY_TOKENS);
  });

  it("spells the currencies as ISO codes, not as symbols", () => {
    // **`$` は 6 通貨で重なり、`¥` は 2 通貨で重なる。** 記号を使うと、
    // 同じ面に同じ字が並んで、どれを押したか画面から分からなくなる。
    let checked = 0;
    for (const token of CURRENCY_TOKENS) {
      expect(CURRENCY_LABELS[token]).toBe(token.toUpperCase());
      expect(CURRENCY_LABELS[token]).toMatch(/^[A-Z]{3}$/);
      checked += 1;
    }
    expect(checked).toBe(16);
    expect(new Set(Object.values(CURRENCY_LABELS)).size).toBe(16);
  });

  it("keeps DEL and AC out of the first three columns on the currency face", () => {
    // **枠のパターンは保つ**(spec §7 の【実測 2026-08-20】)。1 行目は
    // 通貨 3 つ + DEL + AC で、**2 行目以降だけが 5 列**である。
    const keys = face(unitSections("currency")).keys;
    expect(keys.slice(0, 3).map((k) => k.token)).toEqual([
      "unit:jpy",
      "unit:krw",
      "unit:vnd",
    ]);
    expect(keys[3]?.token).toBe("del");
    expect(keys[4]?.token).toBe("ac");
    // 2 行目は 5 通貨。**恒久の空きは最後の 2 つだけ**(16 = 3 + 5 + 5 + 3)。
    expect(keys.slice(5, 10).map((k) => k.token)).toEqual([
      "unit:usd",
      "unit:eur",
      "unit:gbp",
      "unit:chf",
      "unit:cny",
    ]);
    expect(keys.filter((k) => k.token === null)).toHaveLength(2);
    expect(keys.slice(18).map((k) => k.token)).toEqual([null, null]);
  });
});

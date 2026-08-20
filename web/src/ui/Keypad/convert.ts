import type {
  ConvertCategoryToken,
  ConvertUnitToken,
} from "../../convert/types";
import { CONVERT_UNIT_TOKENS } from "../../convert/types";
import type { KeyDef, KeypadSection } from "./types";

/**
 * 単位換算のキー集合。
 *
 * **`ConvertKeyToken` は Convert パネル固有の型である**(spec §6)。Scientific の
 * `KEY_TOKENS` とは別物で、コーパスにも engine_table にも登場しない。
 *
 * 先例は `dataScale.ts` と `llm.ts`。枠の規律をそのまま踏襲する:
 *
 * - 数字面も単位面も **5 列**(`columns: 5`、`height: "square"`)。**行数は面ごとに
 *   違ってよい**——枠の高さはパネルの CSS が `grid-template-rows: repeat(5, 1fr)` と
 *   `aspect-ratio: 1 / 1` で押さえる(`DataScalePanel.module.css` の実測。型面は
 *   15 セル・3 行しか描かれないのに枠は動かない)。**空きの `<button>` で 5 行に
 *   埋めない**——温度は単位が 3 つしかなく、埋めると 20 個の押せないボタンが
 *   読み上げに並ぶ。
 * - **DEL と AC はどの面でも同じ位置**(1 行目の 4 列目・5 列目)。
 * - 余ったセルは恒久の予約スロット(`token: null`)。
 */

/** 入力する項目(spec §4.1)。 */
export type ConvertField = "value" | "from" | "to";

export type ConvertKeyToken =
  | "digit:0"
  | "digit:1"
  | "digit:2"
  | "digit:3"
  | "digit:4"
  | "digit:5"
  | "digit:6"
  | "digit:7"
  | "digit:8"
  | "digit:9"
  | "zeros3"
  | "dot"
  | "sign"
  | "del"
  | "ac"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eq"
  | "swap"
  | `field:${ConvertField}`
  | `unit:${ConvertUnitToken}`;

/** カテゴリの表示名(計画の裁定 1 の表)。 */
export const CATEGORY_LABELS: Record<ConvertCategoryToken, string> = {
  length: "長さ",
  mass: "質量",
  temperature: "温度",
};

/**
 * 単位の画面ラベル。**記号を持つのはここだけである**(計画の裁定 1)。
 * トークンは ASCII の小文字(`um` `k` `degc` `degf`)——`µ` は U+00B5 と U+03BC の
 * 2 通りがあり、同じに見えて一致しない。
 */
export const UNIT_LABELS: Record<ConvertUnitToken, string> = {
  nm: "nm",
  um: "µm",
  mm: "mm",
  cm: "cm",
  m: "m",
  km: "km",
  in: "in",
  ft: "ft",
  yd: "yd",
  mi: "mi",
  nmi: "nmi",
  mg: "mg",
  g: "g",
  kg: "kg",
  t: "t",
  lb: "lb",
  oz: "oz",
  st: "st",
  k: "K",
  degc: "°C",
  degf: "°F",
};

/**
 * 単位の読み上げ名。**記号キーには日本語の名前を与える**(base-spec §43、
 * `dataScale.ts` の `G` = 「十億」と同じ流儀)。`m` や `mm` をそのまま読ませると
 * 「エム」「エムエム」になり、`°C` は読み手によって変わる。
 */
const UNIT_ARIA_LABELS: Record<ConvertUnitToken, string> = {
  nm: "ナノメートル",
  um: "マイクロメートル",
  mm: "ミリメートル",
  cm: "センチメートル",
  m: "メートル",
  km: "キロメートル",
  in: "インチ",
  ft: "フィート",
  yd: "ヤード",
  mi: "マイル",
  nmi: "海里",
  mg: "ミリグラム",
  g: "グラム",
  kg: "キログラム",
  t: "トン",
  lb: "ポンド",
  oz: "オンス",
  st: "ストーン",
  k: "ケルビン",
  degc: "摂氏",
  degf: "華氏",
};

/**
 * 単位がどのカテゴリに属するか。
 *
 * **並びはここに書かない。** 単位面の並びは `CONVERT_UNIT_TOKENS` を絞り込んで
 * 作る——あちらは `Unit::ALL`(= `convert_units()` が返す順)と同じ順に保たれており
 * (`token_parity.rs` が突き合わせる)、**盤面の並びは境界の並びである**。
 * `Record<ConvertUnitToken, …>` なので、単位が 1 つ増えればここが型で赤くなる。
 */
const UNIT_CATEGORY: Record<ConvertUnitToken, ConvertCategoryToken> = {
  nm: "length",
  um: "length",
  mm: "length",
  cm: "length",
  m: "length",
  km: "length",
  in: "length",
  ft: "length",
  yd: "length",
  mi: "length",
  nmi: "length",
  mg: "mass",
  g: "mass",
  kg: "mass",
  t: "mass",
  lb: "mass",
  oz: "mass",
  st: "mass",
  k: "temperature",
  degc: "temperature",
  degf: "temperature",
};

/** カテゴリの単位を、境界が返すのと同じ順で。 */
export function unitsOf(
  category: ConvertCategoryToken,
): readonly ConvertUnitToken[] {
  return CONVERT_UNIT_TOKENS.filter((unit) => UNIT_CATEGORY[unit] === category);
}

const RESERVED: KeyDef<ConvertKeyToken> = {
  token: null,
  label: "—",
  ariaLabel: "空き",
  variant: "function",
};

const DEL: KeyDef<ConvertKeyToken> = {
  token: "del",
  label: "DEL",
  ariaLabel: "1文字消去",
  variant: "danger",
};

const AC: KeyDef<ConvertKeyToken> = {
  token: "ac",
  label: "AC",
  ariaLabel: "この項目を消去",
  variant: "danger",
};

/** 項目行。**4 つ**(spec §4.1): 値 / 変換元 / 変換先 / ⇅。 */
const FIELDS: KeypadSection<ConvertKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 4,
  height: "half",
  keys: [
    {
      token: "field:value",
      label: "値",
      ariaLabel: "値を入力",
      variant: "function",
    },
    {
      token: "field:from",
      label: "変換元",
      ariaLabel: "変換元の単位を選ぶ",
      variant: "function",
    },
    {
      token: "field:to",
      label: "変換先",
      ariaLabel: "変換先の単位を選ぶ",
      variant: "function",
    },
    {
      // ⇅ は 1 キー。値はそのまま残す(spec §4.2)——残すのはパネルの仕事で、
      // ここは「押されたら swap を送る」ことしか知らない。
      token: "swap",
      label: "⇅",
      ariaLabel: "変換元と変換先を入れ替える",
      variant: "operator",
    },
  ],
};

/**
 * 数字面。`dataScale.ts` の `PAD` が骨格で、違いは 3 つある。
 *
 * - **`K`/`M`/`G` を置かない**(予約スロットに戻す)。単位は「変換元」「変換先」が
 *   持つので、値の欄に単位の接尾辞は要らない。
 * - **1 行目の 3 列目は `±`**。`dataScale.ts:94` が予約スロットを置いていた位置で、
 *   `units/entry.ts:119-126` が空の式に `-` を置けない(単項マイナスを持たない)以上、
 *   **このキーが無いと温度の不動点 −40 が盤面から打てない**(計画の裁定 3)。
 *   符号はパネル局所の状態で持ち、評価の直前に先頭へ付ける。
 * - **5 行 3 列目は小数点**。Scientific の最下段(`scientific.ts:217-221`)と同じ位置で、
 *   Data Scale と LLM がここを空けていたのは項目が整数だったからである。**換算の値は
 *   実数**で、`1 in = 25.4 mm` も `0 °C = 273.15 K` も打てなければならない。
 *
 * `( ) ÷ × − + =` は残す——**値は式で打てる**(spec §4.3)。
 */
const PAD: KeypadSection<ConvertKeyToken> = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    {
      token: "sign",
      label: "±",
      ariaLabel: "符号を変える",
      variant: "function",
    },
    DEL,
    AC,

    { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
    RESERVED,

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    RESERVED,

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    RESERVED,

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

/** 単位 1 つぶんのキー。**ラベル・読み上げ・トークンを手で 3 つ並べない**。 */
function unitKey(unit: ConvertUnitToken): KeyDef<ConvertKeyToken> {
  return {
    token: `unit:${unit}`,
    label: UNIT_LABELS[unit],
    ariaLabel: UNIT_ARIA_LABELS[unit],
    variant: "function",
  };
}

/**
 * 単位面を組む。**1 行目の 4・5 番目は DEL・AC**(数字面と同じ位置)。単位は
 * 1 行あたり左 3 セルに詰め、4・5 列目は恒久の空き(`dataScale.ts` の `TYPES` と
 * `llm.ts` の `buildCandidateFace` と同じ配り方)。
 */
function unitFace(
  category: ConvertCategoryToken,
): KeypadSection<ConvertKeyToken> {
  const units = unitsOf(category);
  const keys: KeyDef<ConvertKeyToken>[] = [];
  let index = 0;
  let firstRow = true;
  do {
    for (let column = 0; column < 3; column += 1) {
      const unit = units[index];
      keys.push(unit === undefined ? RESERVED : unitKey(unit));
      if (unit !== undefined) index += 1;
    }
    if (firstRow) {
      keys.push(DEL, AC);
      firstRow = false;
    } else {
      keys.push(RESERVED, RESERVED);
    }
  } while (index < units.length);
  return {
    // **面の名前はカテゴリで変えない。** 変換元と変換先で同じ面が出るので、
    // 区画が入れ替わるのではなく中身だけが替わる(パネルの CSS も 1 本で済む)。
    ariaLabel: "単位のキー",
    columns: 5,
    height: "square",
    keys,
  };
}

/** 数字面(項目行 + 数字と演算)。 */
export const CONVERT_SECTIONS: KeypadSection<ConvertKeyToken>[] = [FIELDS, PAD];

const UNIT_SECTIONS: Record<
  ConvertCategoryToken,
  KeypadSection<ConvertKeyToken>[]
> = {
  length: [FIELDS, unitFace("length")],
  mass: [FIELDS, unitFace("mass")],
  temperature: [FIELDS, unitFace("temperature")],
};

/** 単位面。項目行はどちらの面でも上に居座る——面が変わっても項目は選べる。 */
export function unitSections(
  category: ConvertCategoryToken,
): KeypadSection<ConvertKeyToken>[] {
  return UNIT_SECTIONS[category];
}

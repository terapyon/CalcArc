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
  area: "面積",
  volume: "体積",
  speed: "速さ",
  "data-size": "データ量",
};

/**
 * 単位の画面ラベル。**記号を持つのはここだけである**(計画の裁定 1)。
 * トークンは ASCII の小文字と数字と `_`(`um` `degc` `mm2` `gal_us`)——`µ` は
 * U+00B5 と U+03BC の 2 通りがあり、同じに見えて一致しない。
 *
 * **基準が 1 つに定まらない単位は、名前に基準を書く**(U-2 spec §0.0-3)。
 * `畳(1.62㎡)`・`カップ(200mL)`・`gal(US)` / `gal(Imp)` がそれで、
 * **裸の `畳` `cup` `gal` は画面に出さない**。
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
  // 面積(U-2 spec §3.1)。`²` は U+00B2。
  mm2: "mm²",
  cm2: "cm²",
  m2: "m²",
  km2: "km²",
  ha: "ha",
  in2: "in²",
  ft2: "ft²",
  yd2: "yd²",
  ac: "ac",
  tsubo: "坪",
  // **畳は地域で違う。基準を名前に書く**(spec §0.0-3、§3.2)。1.62 m² は
  // 不動産の表示に関する公正競争規約施行規則 第 9 条第 16 号の下限で、
  // **畳の実寸ではない**——だからこそ数をラベルに入れる。`㎡` は U+33A1
  // (spec §3.2 の綴りに合わせる)。
  jo: "畳(1.62㎡)",
  // 体積(spec §3.4)。**US と Imperial は系をラベルに書く**——
  // どちらか分からない裸の `gal` `cup` を画面に出さない。
  ml: "mL",
  cl: "cL",
  dl: "dL",
  l: "L",
  m3: "m³",
  gal_us: "gal(US)",
  gal_imp: "gal(Imp)",
  floz_us: "fl oz(US)",
  floz_imp: "fl oz(Imp)",
  pt_us: "pt(US)",
  pt_imp: "pt(Imp)",
  qt_us: "qt(US)",
  qt_imp: "qt(Imp)",
  cup_us: "cup(US)",
  // 日本の計量カップ。米国慣用の 8 fl oz(236.588 mL)と別物なので、
  // **どちらも裸の `cup` を名乗らせない**(spec §3.4)。
  cup_jp: "カップ(200mL)",
  // 速さ(spec §3.5)。
  mps: "m/s",
  kmh: "km/h",
  mph: "mph",
  kn: "kn",
  // データ量(spec §3.6)。**SI と IEC は綴りで分ける**(`kB` ≠ `KiB`)。
  bit: "bit",
  byte: "byte",
  kb: "kB",
  mb: "MB",
  gb: "GB",
  tb: "TB",
  pb: "PB",
  kib: "KiB",
  mib: "MiB",
  gib: "GiB",
  tib: "TiB",
  pib: "PiB",
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
  mm2: "平方ミリメートル",
  cm2: "平方センチメートル",
  m2: "平方メートル",
  km2: "平方キロメートル",
  ha: "ヘクタール",
  in2: "平方インチ",
  ft2: "平方フィート",
  yd2: "平方ヤード",
  ac: "エーカー",
  tsubo: "坪",
  // **読み上げにも基準を残す。** ラベルの `(1.62㎡)` を落とすと、耳では
  // どの畳か分からなくなる。
  jo: "畳、1.62平方メートル",
  ml: "ミリリットル",
  cl: "センチリットル",
  dl: "デシリットル",
  l: "リットル",
  m3: "立方メートル",
  // **系は耳にも届かせる**(`gal(US)` を「ガロン」とだけ読ませない)。
  gal_us: "ガロン、米国",
  gal_imp: "ガロン、英国",
  floz_us: "液量オンス、米国",
  floz_imp: "液量オンス、英国",
  pt_us: "パイント、米国",
  pt_imp: "パイント、英国",
  qt_us: "クォート、米国",
  qt_imp: "クォート、英国",
  cup_us: "カップ、米国",
  cup_jp: "カップ、200ミリリットル",
  mps: "メートル毎秒",
  kmh: "キロメートル毎時",
  mph: "マイル毎時",
  kn: "ノット",
  // **`bit` と `byte` も日本語で読ませる。** ラテン文字のままだと綴りを
  // 読み上げる読み手があり、`bit`(1/8 byte)と `byte` の区別が耳で消える。
  bit: "ビット",
  byte: "バイト",
  kb: "キロバイト",
  mb: "メガバイト",
  gb: "ギガバイト",
  tb: "テラバイト",
  pb: "ペタバイト",
  // IEC は「キビ」以下。**SI の「キロ」と 1 文字違いで読み分けられる**。
  kib: "キビバイト",
  mib: "メビバイト",
  gib: "ギビバイト",
  tib: "テビバイト",
  pib: "ピビバイト",
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
  mm2: "area",
  cm2: "area",
  m2: "area",
  km2: "area",
  ha: "area",
  in2: "area",
  ft2: "area",
  yd2: "area",
  ac: "area",
  tsubo: "area",
  jo: "area",
  ml: "volume",
  cl: "volume",
  dl: "volume",
  l: "volume",
  m3: "volume",
  gal_us: "volume",
  gal_imp: "volume",
  floz_us: "volume",
  floz_imp: "volume",
  pt_us: "volume",
  pt_imp: "volume",
  qt_us: "volume",
  qt_imp: "volume",
  cup_us: "volume",
  cup_jp: "volume",
  mps: "speed",
  kmh: "speed",
  mph: "speed",
  kn: "speed",
  bit: "data-size",
  byte: "data-size",
  kb: "data-size",
  mb: "data-size",
  gb: "data-size",
  tb: "data-size",
  pb: "data-size",
  kib: "data-size",
  mib: "data-size",
  gib: "data-size",
  tib: "data-size",
  pib: "data-size",
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
  area: [FIELDS, unitFace("area")],
  volume: [FIELDS, unitFace("volume")],
  speed: [FIELDS, unitFace("speed")],
  "data-size": [FIELDS, unitFace("data-size")],
};

/** 単位面。項目行はどちらの面でも上に居座る——面が変わっても項目は選べる。 */
export function unitSections(
  category: ConvertCategoryToken,
): KeypadSection<ConvertKeyToken>[] {
  return UNIT_SECTIONS[category];
}

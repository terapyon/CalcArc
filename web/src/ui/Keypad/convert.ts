import type {
  ConvertCategoryId,
  ConvertCategoryToken,
  ConvertUnitToken,
} from "../../convert/types";
import { CONVERT_UNIT_TOKENS } from "../../convert/types";
import type { CurrencyToken } from "../../currency/types";
import { CURRENCY_TOKENS } from "../../currency/types";
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

/**
 * 項目の一覧。**盤面の項目行と、トークンを解く側が共有する**
 * (`Keypad/parse.ts`)。型だけの union は実行時に確かめられない。
 */
export const CONVERT_FIELDS: readonly ConvertField[] = ["value", "from", "to"];

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
  | `unit:${ConvertFaceUnit}`;

/**
 * 面に載る「単位」。**通貨も単位である**——U-4 spec §3 が
 * 「通貨は factor が動的な単位である」と書いており、offset を持たないので
 * U-1 のアフィン機構に 1 行も足さずに乗る。
 *
 * **接頭辞は `unit:` のまま 1 つにする。** 通貨だけ `currency:` にすると、
 * 盤面の押下・トグル・読み上げの経路が全部 2 本になる。綴りは重ならない
 * (単位 63 個と通貨 16 個に同じトークンは無い)。
 */
export type ConvertFaceUnit = ConvertUnitToken | CurrencyToken;

/** カテゴリの表示名(計画の裁定 1 の表)。 */
export const CATEGORY_LABELS: Record<ConvertCategoryId, string> = {
  length: "長さ",
  mass: "質量",
  temperature: "温度",
  area: "面積",
  volume: "体積",
  speed: "速さ",
  "data-size": "データ量",
  // **U-4 の 8 つ目。** ここだけがネットワーク由来のレートで動く。
  currency: "為替",
};

/** カテゴリの英語名。**日本語と併記する**(U-0 §9 の【変更 2026-08-20】)。
 * 綴りは U-1 §4.2 と U-2 §2 の表そのままで、ここで訳し直さない。
 *
 * **`データ量` の衝突をほどくのはこの表である**——Convert の `data-size` は
 * 単位どうしの換算(`1 GB = 953.674 MiB`)、Scale の `data-scale` は規模の
 * 計算で、**日本語のラベルは両方とも `データ量`** である(U-2 §2)。 */
export const CATEGORY_LABELS_EN: Record<ConvertCategoryId, string> = {
  length: "Length",
  mass: "Mass",
  temperature: "Temperature",
  area: "Area",
  volume: "Volume",
  speed: "Speed",
  "data-size": "Data Size",
  // **U-4 の 8 つ目。** 鍵は `ConvertCategoryToken`(7)ではなく
  // `ConvertCategoryId`(8)である——**`CATEGORY_LABELS` と同じ鍵でなければ
  // ならない**。この 2 つの表は `ConvertPanel` が同じ id で同時に引く。
  currency: "Currency",
};

/**
 * 単位の画面ラベル。**記号を持つのはここだけである**(計画の裁定 1)。
 * トークンは ASCII の小文字と数字と `_`(`um` `degc` `mm2` `gal_us`)——`µ` は
 * U+00B5 と U+03BC の 2 通りがあり、同じに見えて一致しない。
 *
 * **基準が 1 つに定まらない単位は、名前に基準を書く**(U-2 spec §0.0-3)。
 * `畳(1.62m²)`・`カップ(200mL)`・`gal(US)` / `gal(Imp)` がそれで、
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
  // **畳の実寸ではない**——だからこそ数をラベルに入れる。
  // **`m²` は `m` + U+00B2 で書く。** 互換文字の `㎡`(U+33A1)は使わない——
  // 同じ面に並ぶ `m2` のラベルと**同じものが 2 通りの字で出る**
  // (spec §3.2 の【訂正 2026-08-20】。`µ` の U+00B5 / U+03BC と同じ型の罠)。
  jo: "畳(1.62m²)",
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
  // **読み上げにも基準を残す。** ラベルの `(1.62m²)` を落とすと、耳では
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

/**
 * 通貨の画面ラベル。**大文字の ISO 4217 コードである**(`JPY` `USD`)。
 *
 * トークン(`jpy`)と綴りが違うのは単位と同じ流儀で、**盤面のトークンは
 * 小文字**(`currency/types.ts`。Rust の `Currency::ALL` と `token_parity.rs`
 * が突き合わせる)。**記号(`¥` `$`)は使わない**——`$` は米ドル・豪ドル・
 * カナダドル・香港ドル・シンガポールドル・台湾ドルで重なり、`¥` は日本円と
 * 中国元で重なる。**同じ面に同じ字が 6 つ並ぶ**ことになり、どれを押したか
 * 画面から分からなくなる。
 */
export const CURRENCY_LABELS: Record<CurrencyToken, string> = {
  jpy: "JPY",
  krw: "KRW",
  vnd: "VND",
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  chf: "CHF",
  cny: "CNY",
  thb: "THB",
  sgd: "SGD",
  hkd: "HKD",
  twd: "TWD",
  aud: "AUD",
  cad: "CAD",
  inr: "INR",
  brl: "BRL",
};

/**
 * 通貨の読み上げ名。**ISO コードをそのまま読ませない**(単位と同じ理由)
 * ——`JPY` は「ジェイピーワイ」、`CHF` は読み手ごとに変わる。
 *
 * **「ドル」だけの名前を作らない。** 米ドル・豪ドル・カナダドル・香港ドル・
 * シンガポールドルが耳で潰れる——単位の `gal(US)` / `gal(Imp)` を
 * 「ガロン」とだけ読ませないのと同じ判断(U-2 spec §3.4)。
 */
const CURRENCY_ARIA_LABELS: Record<CurrencyToken, string> = {
  jpy: "日本円",
  krw: "韓国ウォン",
  vnd: "ベトナムドン",
  usd: "米ドル",
  eur: "ユーロ",
  gbp: "英ポンド",
  chf: "スイスフラン",
  cny: "中国元",
  thb: "タイバーツ",
  sgd: "シンガポールドル",
  hkd: "香港ドル",
  twd: "台湾ドル",
  aud: "豪ドル",
  cad: "カナダドル",
  inr: "インドルピー",
  brl: "ブラジルレアル",
};

/** 面に出るラベル。**通貨も単位である**(`ConvertFaceUnit`)。 */
export const FACE_LABELS: Record<ConvertFaceUnit, string> = {
  ...UNIT_LABELS,
  ...CURRENCY_LABELS,
};

const FACE_ARIA_LABELS: Record<ConvertFaceUnit, string> = {
  ...UNIT_ARIA_LABELS,
  ...CURRENCY_ARIA_LABELS,
};

/**
 * カテゴリの面に並ぶ単位。**通貨は `CURRENCY_TOKENS` の並びそのまま**
 * ——`currency_units()` が返す順(= `Currency::ALL`)であり、
 * **面の並びがレートの中身で動いてはいけない**(spec §7。動くと同じ位置に
 * 違う通貨が来る)。**押せるかどうかは並びと別の話**で、盤面が `disabled`
 * で決める。
 */
export function faceUnitsOf(
  category: ConvertCategoryId,
): readonly ConvertFaceUnit[] {
  return category === "currency" ? CURRENCY_TOKENS : unitsOf(category);
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
function unitKey(unit: ConvertFaceUnit): KeyDef<ConvertKeyToken> {
  return {
    token: `unit:${unit}`,
    label: FACE_LABELS[unit],
    ariaLabel: FACE_ARIA_LABELS[unit],
    variant: "function",
  };
}

/**
 * 2 行目以降に置ける単位の数。**1 行目は常に 3**(4・5 列目は DEL と AC)。
 *
 * **単位は左 3 列、通貨は 5 列**である。**なぜ揃えないか**——
 * **通貨は 16 個あり、左 3 列では 15 スロットに入らない**(U-2 spec §0.0-4 の
 * 【訂正 2026-08-20】が「15 は入り、16 は入らない」と実測している)。
 *
 * **実測**(2026-08-20、Playwright、mobile 390 × 844。数字面はどの
 * カテゴリでも 366.0625 x 366.0625・DEL は枠から 224.4375,0):
 *
 * ```text
 * 通貨 16 個・左 3 列 → 6 行 30 キー。単位面 440.875 x 440.875(+74.8125px)
 *                       DEL も 224.4375,0 → 269.3125,0 へ動く   ← 枠があふれる
 * 通貨 16 個・5 列    → 4 行 20 キー。単位面 366.0625 x 366.0625
 *                       DEL 224.4375,0 / AC 299.25,0            ← 数字面と一致
 * ```
 *
 * **共有の面パターンは破っていない。** 枠は 5 列 × 5 行のまま、DEL と AC は
 * 1 行目の 4・5 列目のままである(実測で 8 カテゴリ 16 面すべて同値)。
 * **動かしたのは 2 行目以降の 4・5 列目だけ**で、そこは他のカテゴリでは
 * 恒久の空きだった場所である——**単位 63 個の面はどれも 3 列のままで、
 * 1 キーも動いていない**。
 *
 * **通貨を落とすほうを採らなかった理由**: どれを落としても誰かの通貨が
 * 消える。**枠の中に 16 個が収まる置き方が実在した**以上、落とす基準を
 * 書く必要が無い。
 *
 * **キーは 66.8125 x 66.8125**(実測)で、44px の下限を割らない。
 */
const ROW_WIDTH = { units: 3, currency: 5 } as const;

/**
 * 単位面を組む。**1 行目の 4・5 番目は DEL・AC**(数字面と同じ位置)。単位は
 * 1 行あたり左 3 セルに詰め、4・5 列目は恒久の空き(`dataScale.ts` の `TYPES` と
 * `llm.ts` の `buildCandidateFace` と同じ配り方)。
 *
 * **為替だけ 2 行目以降が 5 列である**(`ROW_WIDTH`)。16 通貨は左 3 列では
 * 枠にあふれる——**実測してから決めた**。
 */
function unitFace(category: ConvertCategoryId): KeypadSection<ConvertKeyToken> {
  const units = faceUnitsOf(category);
  const width = ROW_WIDTH[category === "currency" ? "currency" : "units"];
  const keys: KeyDef<ConvertKeyToken>[] = [];
  let index = 0;
  let firstRow = true;
  do {
    // **1 行目は必ず 3 列。** 4・5 列目は DEL と AC が取る(どの面でも同じ位置)。
    const columns = firstRow ? 3 : width;
    for (let column = 0; column < columns; column += 1) {
      const unit = units[index];
      keys.push(unit === undefined ? RESERVED : unitKey(unit));
      if (unit !== undefined) index += 1;
    }
    if (firstRow) {
      keys.push(DEL, AC);
      firstRow = false;
    } else {
      for (let column = columns; column < 5; column += 1) keys.push(RESERVED);
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
  ConvertCategoryId,
  KeypadSection<ConvertKeyToken>[]
> = {
  length: [FIELDS, unitFace("length")],
  mass: [FIELDS, unitFace("mass")],
  temperature: [FIELDS, unitFace("temperature")],
  area: [FIELDS, unitFace("area")],
  volume: [FIELDS, unitFace("volume")],
  speed: [FIELDS, unitFace("speed")],
  "data-size": [FIELDS, unitFace("data-size")],
  currency: [FIELDS, unitFace("currency")],
};

/** 単位面。項目行はどちらの面でも上に居座る——面が変わっても項目は選べる。 */
export function unitSections(
  category: ConvertCategoryId,
): KeypadSection<ConvertKeyToken>[] {
  return UNIT_SECTIONS[category];
}

import type { DataTypeToken } from "../../datascale/types";
import type { KeypadSection } from "./types";

/**
 * Data Scale のキー集合。
 *
 * 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠は複製していない
 * (base-spec §3、§12)。制御(DEL・AC)は右上、単位(K/M/G)は右下——数字の
 * 直後に押すキーなので近くに置く(設計書 §2)。
 *
 * **数字面と型面は同じ 4 列 × 4 行の枠に載る。** 型面は 11 キーで 3 行しか
 * 描かれないため、行数はパネルの CSS が押さえる——面を入れ替えたときに
 * 画面が伸び縮みすると、押そうとした位置がずれる。
 */
export type DataScaleKeyToken =
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
  | "k"
  | "m"
  | "g"
  | "del"
  | "ac"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eq"
  | "field:count"
  | "field:dimensions"
  | "field:dtype"
  | `dtype:${DataTypeToken}`;

/** 入力する項目。 */
export type DataScaleField = "count" | "dimensions" | "dtype";

const FIELDS: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 3,
  height: "half",
  keys: [
    {
      token: "field:count",
      label: "件数",
      ariaLabel: "件数を入力",
      variant: "function",
    },
    {
      token: "field:dimensions",
      label: "次元数",
      ariaLabel: "次元数を入力",
      variant: "function",
    },
    {
      token: "field:dtype",
      label: "データ型",
      ariaLabel: "データ型を選ぶ",
      variant: "function",
    },
  ],
};

const PAD: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    // **最上段は Scientific と同じ**(設計書 §4)。3 つのタブで AC・DEL の
    // 位置とキーの寸法を揃える。
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    // 件数に負の値は無いので `+/−` は置かない。予約スロット(裁定 Q3)。
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    {
      token: "ac",
      label: "AC",
      ariaLabel: "この項目を消去",
      variant: "danger",
    },

    { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
    // 読み上げ名は日本語にする(記号キーの流儀。base-spec §43)。
    { token: "g", label: "G", ariaLabel: "十億", variant: "operator" },

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    { token: "m", label: "M", ariaLabel: "百万", variant: "operator" },

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    { token: "k", label: "K", ariaLabel: "千", variant: "operator" },

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

/**
 * 型面。9 つの型を左 3 列に置き、DEL と AC は数字面と同じ位置に置く。
 * **余った 5 セルにはボタンを置かない**——恒久の空きであり、S1 の予約
 * スロット(「ここに何か来る」)とは別物である(設計書 §2)。
 */
const TYPES: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "データ型のキー",
  columns: 5,
  height: "square",
  keys: [
    {
      token: "dtype:int8",
      label: "int8",
      ariaLabel: "int8",
      variant: "function",
    },
    {
      token: "dtype:uint8",
      label: "uint8",
      ariaLabel: "uint8",
      variant: "function",
    },
    {
      token: "dtype:int16",
      label: "int16",
      ariaLabel: "int16",
      variant: "function",
    },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    {
      token: "ac",
      label: "AC",
      ariaLabel: "この項目を消去",
      variant: "danger",
    },

    {
      token: "dtype:float16",
      label: "float16",
      ariaLabel: "float16",
      variant: "function",
    },
    {
      token: "dtype:bfloat16",
      label: "bfloat16",
      ariaLabel: "bfloat16",
      variant: "function",
    },
    {
      token: "dtype:int32",
      label: "int32",
      ariaLabel: "int32",
      variant: "function",
    },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },

    {
      token: "dtype:float32",
      label: "float32",
      ariaLabel: "float32",
      variant: "function",
    },
    {
      token: "dtype:int64",
      label: "int64",
      ariaLabel: "int64",
      variant: "function",
    },
    {
      token: "dtype:float64",
      label: "float64",
      ariaLabel: "float64",
      variant: "function",
    },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
  ],
};

/** 項目の区画。どちらの面でも上に居座る——面が変わっても項目は選べる。 */
export const FIELD_SECTION = FIELDS;

/** 数字面。 */
export const DATA_SCALE_SECTIONS: KeypadSection<DataScaleKeyToken>[] = [
  FIELDS,
  PAD,
];

/** 型面。数字面と同じ枠に、同じ位置の DEL・AC を載せて差し替える。 */
export const TYPE_SECTIONS: KeypadSection<DataScaleKeyToken>[] = [
  FIELDS,
  TYPES,
];

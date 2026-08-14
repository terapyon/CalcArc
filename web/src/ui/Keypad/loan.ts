import type { KeypadSection } from "./types";

/**
 * Loan のキー集合。
 *
 * 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠(配色・ボタン
 * 形状・書体・ロゴ・製品名)は複製していない(base-spec §3 Non-goals、§12)。
 *
 * 制御(DEL・AC)は右上、単位(万・億)は右下——金額を打った直後に押すキー
 * なので数字の近くに置く(設計書 §2)。`=` は無い: 必要な項目が埋まった時点で
 * 結果が出るので、押さないと出ないキーがあると「押していないから」なのか
 * 「入力が足りないから」なのかを見分けられなくなる。
 */

/** キーパッドが返すトークン。**calc の語彙とは別**(設計書 §4)。 */
export type LoanKeyToken =
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
  | "man"
  | "oku"
  | "del"
  | "ac"
  | "mode:payment"
  | "mode:principal"
  | "mode:term"
  | "field:principal"
  | "field:rate"
  | "field:months"
  | "field:payment"
  | "field:residual"
  | "field:bonus";

/** 入力する項目。 */
export type LoanField =
  | "principal"
  | "rate"
  | "months"
  | "payment"
  | "residual"
  | "bonus";

const MODES: KeypadSection<LoanKeyToken> = {
  ariaLabel: "求めるもの",
  columns: 3,
  height: "half",
  keys: [
    {
      token: "mode:payment",
      label: "月々の返済額",
      ariaLabel: "月々の返済額を求める",
      variant: "function",
    },
    {
      token: "mode:principal",
      label: "借入可能額",
      ariaLabel: "借入可能額を求める",
      variant: "function",
    },
    {
      token: "mode:term",
      label: "返済期間",
      ariaLabel: "返済期間を求める",
      variant: "function",
    },
  ],
};

const FIELDS: KeypadSection<LoanKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 6,
  height: "half",
  keys: [
    {
      token: "field:principal",
      label: "借入額",
      ariaLabel: "借入額を入力",
      variant: "function",
    },
    {
      token: "field:rate",
      label: "年利",
      ariaLabel: "年利を入力",
      variant: "function",
    },
    {
      token: "field:months",
      label: "期間",
      ariaLabel: "返済期間を入力",
      variant: "function",
    },
    // 月々の返済額は、月額モードでは答だが他の 2 モードでは入力である
    // (設計書 §6)。タブは常に置き、モードで無効にする。
    {
      token: "field:payment",
      label: "月額",
      ariaLabel: "月々の返済額を入力",
      variant: "function",
    },
    {
      token: "field:residual",
      label: "残価",
      ariaLabel: "残価を入力",
      variant: "function",
    },
    // ボーナスはモードで意味が変わる。アクセシブルネームは Panel が
    // 差し替える(設計書 §6)——ここは月額モードの名前を既定として置く。
    {
      token: "field:bonus",
      label: "ボーナス",
      ariaLabel: "ボーナス返済分（元本）を入力",
      variant: "function",
    },
  ],
};

const PAD: KeypadSection<LoanKeyToken> = {
  ariaLabel: "数字と単位のキー",
  columns: 4,
  height: "square",
  keys: [
    { token: "digit:7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "digit:8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "digit:9", label: "9", ariaLabel: "9", variant: "digit" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    {
      token: "ac",
      label: "AC",
      ariaLabel: "この項目を消去",
      variant: "danger",
    },

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "man", label: "万", ariaLabel: "万", variant: "operator" },

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "oku", label: "億", ariaLabel: "億", variant: "operator" },
  ],
};

export const LOAN_SECTIONS: KeypadSection<LoanKeyToken>[] = [
  MODES,
  FIELDS,
  PAD,
];

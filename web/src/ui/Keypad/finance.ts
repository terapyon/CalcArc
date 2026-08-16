import type { KeyDef, KeypadSection } from "./types";

/**
 * Finance のキー集合。
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
export type FinanceKeyToken =
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
  | "unit:high"
  | "unit:low"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eq"
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
  | "field:bonus"
  | "mode:compound"
  | "mode:deposit-for"
  | "mode:periods-for"
  | "field:deposit"
  | "field:periods"
  | "field:tax"
  | "field:target"
  | `period:${1 | 2 | 12}`
  | "tax:none"
  | "tax:withholding";

/** 入力する項目。 */
export type FinanceField =
  | "principal"
  | "deposit"
  | "periods"
  | "tax"
  | "rate"
  | "months"
  | "payment"
  | "residual"
  | "bonus"
  | "target";

const MODES: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "計算の種類",
  columns: 6,
  // **4 文字ラベルが 2 行になる**(借入可能 / 必要積立 / 必要年数)。半高だと
  // 2 行がボタンからはみ出す(0.2.0 設計書 §8)。
  height: "double",
  keys: [
    {
      token: "mode:payment",
      label: "月額",
      ariaLabel: "月々の返済額を求める",
      variant: "function",
    },
    {
      token: "mode:principal",
      // **語の切れ目で固定改行**(設計書レビュー、C 案)。6 列だと 1 枠 54px
      // ほどしか無く、4 文字ラベルは自動折り返しに任せると語の途中で割れる
      // (「必要積」「立」のように)。折り返し位置はデータで固定する——語の
      // 切れ目は設計判断であって描画結果ではない。読み上げ名(ariaLabel)は
      // 変えない。
      label: "借入\n可能",
      ariaLabel: "借入可能額を求める",
      variant: "function",
    },
    {
      token: "mode:term",
      label: "期間",
      ariaLabel: "返済期間を求める",
      variant: "function",
    },
    // **複利は 1 モード**——一括預入は積立額 0、毎月積立は元本 0 の退化で、
    // コアも 1 本の関数である(設計書 §6)。
    {
      token: "mode:compound",
      label: "複利",
      ariaLabel: "複利で増やす",
      variant: "function",
    },
    // **複利の逆算は 2 モード**——目標額から積立額を求めるか、期数を求める
    // かで探索の形が違う(単調 vs 非単調、設計書 §3〜§4)。
    {
      token: "mode:deposit-for",
      label: "必要\n積立",
      ariaLabel: "必要な積立額を求める",
      variant: "function",
    },
    {
      token: "mode:periods-for",
      label: "必要\n年数",
      ariaLabel: "必要な期間を求める",
      variant: "function",
    },
  ],
};

const FIELDS: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 6,
  // 「ボーナス」の 4 文字。**以前は 0.75rem に縮めて収めていた**が、
  // 器を広げたので読める大きさに戻した(0.2.0 設計書 §8)。
  height: "double",
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

/**
 * 複利の項目。**ローンとは別の行に差し替える**——同じ行に両方を並べると
 * 9 列になり、1 キーが 36px で 44px を割る(設計書 §4)。
 */
const COMPOUND_FIELDS: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "入力する項目",
  columns: 6,
  height: "double",
  keys: [
    {
      token: "field:principal",
      label: "元本",
      ariaLabel: "元本を入力",
      variant: "function",
    },
    {
      token: "field:deposit",
      label: "積立",
      ariaLabel: "毎期の積立額を入力",
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
      ariaLabel: "期間を入力",
      variant: "function",
    },
    {
      token: "field:periods",
      label: "周期",
      ariaLabel: "複利の周期を選ぶ",
      variant: "function",
    },
    {
      token: "field:tax",
      label: "税",
      ariaLabel: "税の扱いを選ぶ",
      variant: "function",
    },
  ],
};

/** 目標額のキー。2 つの逆算で共有する(同じ意味の欄である)。 */
const TARGET_KEY: KeyDef<FinanceKeyToken> = {
  token: "field:target",
  label: "目標",
  ariaLabel: "目標額を入力",
  variant: "function",
};

/** 1 キーだけ差し替えた項目行を作る。**行の形と区画名は動かさない。** */
function fieldsWith(
  replaced: FinanceKeyToken,
  key: KeyDef<FinanceKeyToken>,
): KeypadSection<FinanceKeyToken> {
  return {
    ...COMPOUND_FIELDS,
    keys: COMPOUND_FIELDS.keys.map((k) => (k.token === replaced ? key : k)),
  };
}

/** 必要積立額の項目。**積立の代わりに目標**が出る(設計書 §11)。 */
const DEPOSIT_FOR_FIELDS = fieldsWith("field:deposit", TARGET_KEY);

/** 必要年数の項目。**期間の代わりに目標**が出る。 */
const PERIODS_FOR_FIELDS = fieldsWith("field:months", TARGET_KEY);

export const DEPOSIT_FOR_FIELD_SECTION = DEPOSIT_FOR_FIELDS;
export const PERIODS_FOR_FIELD_SECTION = PERIODS_FOR_FIELDS;

/**
 * 周期の面。**面が入れ替わるのは「計算に入るもの」だから**——表示の読み方
 * だけを変えるトグルとは置き場所を分ける(設計書 §7)。
 */
const PERIODS_FACE: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "複利の周期のキー",
  columns: 5,
  height: "square",
  keys: [
    {
      token: "period:12",
      label: "月",
      ariaLabel: "月ごとに複利",
      variant: "function",
    },
    {
      token: "period:2",
      label: "半年",
      ariaLabel: "半年ごとに複利",
      variant: "function",
    },
    {
      token: "period:1",
      label: "年",
      ariaLabel: "年ごとに複利",
      variant: "function",
    },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    {
      token: "ac",
      label: "AC",
      ariaLabel: "この項目を消去",
      variant: "danger",
    },
    ...Array.from({ length: 20 }, () => ({
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function" as const,
    })),
  ],
};

/** 税の面。既定はタックスフリー(NISA 前提。設計書 §6)。 */
const TAX_FACE: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "税のキー",
  columns: 5,
  height: "square",
  keys: [
    {
      token: "tax:none",
      label: "なし",
      ariaLabel: "税を引かない",
      variant: "function",
    },
    {
      token: "tax:withholding",
      label: "20.315%",
      ariaLabel: "源泉分離課税を引く",
      variant: "function",
    },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    {
      token: "ac",
      label: "AC",
      ariaLabel: "この項目を消去",
      variant: "danger",
    },
    ...Array.from({ length: 20 }, () => ({
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function" as const,
    })),
  ],
};

const PAD: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    // **最上段は Scientific と同じ**——括弧・DEL・AC の位置を 3 つのタブで
    // 揃える(設計書 §4)。タブを行き来して AC の場所が変わるのは、
    // 押し間違いが入力のやり直しに直結する。
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    // 金額に負の値は無いので `+/−` は置かない。予約スロット(設計書 §4)。
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
    // 5 列目はモジュール固有。**単位キーは項目に従って差し替わる**
    // (設計書 §5)——金額は 万/億、期間は 年/月、年利は空き。
    { token: "unit:high", label: "万", ariaLabel: "万", variant: "operator" },

    { token: "digit:4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "digit:5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "digit:6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    { token: "unit:low", label: "億", ariaLabel: "億", variant: "operator" },

    { token: "digit:1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "digit:2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "digit:3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },

    { token: "digit:0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

export const COMPOUND_FIELD_SECTION = COMPOUND_FIELDS;
export const PERIODS_SECTION = PERIODS_FACE;
export const TAX_SECTION = TAX_FACE;

export const FINANCE_SECTIONS: KeypadSection<FinanceKeyToken>[] = [
  MODES,
  FIELDS,
  PAD,
];

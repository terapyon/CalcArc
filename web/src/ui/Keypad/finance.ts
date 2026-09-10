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

/** 項目の一覧。理由は `convert.ts` の `CONVERT_FIELDS` と同じ。 */
export const FINANCE_FIELDS: readonly FinanceField[] = [
  "principal",
  "deposit",
  "periods",
  "tax",
  "rate",
  "months",
  "payment",
  "residual",
  "bonus",
  "target",
];

/**
 * 計算の種類。**6 つとも「求めるものの名詞」で綴りを揃えてある**
 * (設計書 §10.4 系統 B、**利用者裁定 2026-09-10**)。
 *
 * ```
 * 返済⏎月額 / 借入⏎可能額 / 返済⏎期間 │ 複利⏎残高 / 必要⏎積立額 / 必要⏎年数
 * └──────── ローン ────────┘ └──────── 複利 ────────┘
 * ```
 *
 * **なぜ揃えたか。** ここには 2 つの問題があった(設計書 §10.1〜§10.2):
 * **① 上段の「月額」「期間」が下段の項目キーと同じ語で、役が逆だった**
 * (上は求める、下は入力する)。**区別は `ariaLabel` にだけ在って、目で見る
 * 人には無かった。** **② 左 3 つ(ローン)と右 3 つ(複利)の境目が画面に
 * 何も現れていなかった。**
 *
 * **★ 群を分けているのは語だけである。** 冠が左 3 つは `返済 / 借入 / 返済`、
 * 右 3 つは `複利 / 必要 / 必要`。
 *
 * **色でも出す案(§10.4 案 D)は、試して落とした**(2026-09-10)。
 * `--key-accent-bg` は既に `.operator`(演算子)と
 * `.key[aria-pressed="true"]`(押下中)の 2 つの意味を持っており、
 * **3 つ目を載せると初期表示で 6 つのうち 4 つが同じ色になって、群の境目を
 * 示さないどころか選択中を読めなくした**(実測)。**理由の全文は設計書 §10.4.2。**
 *
 * **★ 綴りを変えない。** 承認されたのは組み立て規則ではなく**綴りそのもの**
 * である(a11y の 13 画面名・期末/期首・賞与と同じ扱い。設計書 §10.4.0)。
 * **`ariaLabel` は 1 つも変えていない**——画面の語はすべて `ariaLabel` の
 * 部分文字列であり、**見える側と読み上げ側が同じ語で揃う**のが系統 B が
 * 選ばれた決め手である。
 */
const MODES: KeypadSection<FinanceKeyToken> = {
  ariaLabel: "計算の種類",
  columns: 6,
  // **6 つとも 2 行になる**(系統 B の代償。設計書 §10.4.0)。半高だと
  // 2 行がボタンからはみ出す(0.2.0 設計書 §8)。**内容 63px / 枠 68px**
  // ——390×844 でも 360×800 でも同じ(2026-09-10 実測)。
  height: "double",
  keys: [
    {
      token: "mode:payment",
      // **語の切れ目で固定改行**(設計書レビュー、C 案)。6 列だと 1 枠 54px
      // ほどしか無く、4 文字ラベルは自動折り返しに任せると語の途中で割れる
      // (「必要積」「立」のように)。折り返し位置はデータで固定する——語の
      // 切れ目は設計判断であって描画結果ではない。読み上げ名(ariaLabel)は
      // 変えない。
      label: "返済\n月額",
      ariaLabel: "月々の返済額を求める",
      variant: "function",
    },
    {
      token: "mode:principal",
      // **`可能額` は 3 文字なので 1 行に収まる**(可・能・額。2026-09-10
      // 実測)。5 文字のラベルが 2 行に入るか、が正しい問いだった。
      label: "借入\n可能額",
      ariaLabel: "借入可能額を求める",
      variant: "function",
    },
    {
      token: "mode:term",
      label: "返済\n期間",
      ariaLabel: "返済期間を求める",
      variant: "function",
    },
    // **複利は 1 モード**——一括預入は積立額 0、毎月積立は元本 0 の退化で、
    // コアも 1 本の関数である(設計書 §6)。
    {
      token: "mode:compound",
      label: "複利\n残高",
      ariaLabel: "複利で増やす",
      variant: "function",
    },
    // **複利の逆算は 2 モード**——目標額から積立額を求めるか、期数を求める
    // かで探索の形が違う(単調 vs 非単調、設計書 §3〜§4)。
    {
      token: "mode:deposit-for",
      label: "必要\n積立額",
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
  // **半高。** 収まるようになったのは**字を縮めたからではない——ラベルを
  // 短くしたからである**(「ボーナス」の 4 文字は 42px で 34px の枠を 8px
  // はみ出す。「賞与」の 2 文字は 34px に収まる。2026-09-10 実測)。
  // 0.2.0 が「0.75rem に縮めて収める」から退却して器を倍にした判断
  // (0.2.0 設計書 §8)は**そのまま生きている**: 字は half の既定のまま
  // 15px で、縮めていない(設計書 §11.4)。
  //
  // **上段(`MODES`)は `double` のまま**——2 行のラベルが 3 つあり 34px に
  // 入らない。加えて、**同じ高さの 2 行は対等に見え、高さが違うほうが
  // 階層に見える**——上段が主・下段が従という意図は `double` + `half` の
  // ほうが達成する(設計書 §11.3)。
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
      // **盤面のキーのラベルだけを短くする。** 読み上げ名(下の `ariaLabel`)
      // と一覧の見出し(`FinancePanel.tsx` の `bonusName()`)には幅の制約が
      // 掛からないので、「ボーナス」のまま残す(設計書 §11.4)。
      label: "賞与",
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
  // **`FIELDS` と同じ半高。** 差し替わる行なので高さが違うと入れ替えの
  // たびに盤面が跳ねる。6 つとも 1 行 3 文字以内で 34px に収まる(実測)。
  height: "half",
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

import type { KeyToken } from "../../calc";
import type { KeypadSection } from "./types";

// Scientific のキー集合。
//
// 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠(配色・ボタン
// 形状・書体・ロゴ・製品名)は複製していない(base-spec §3 Non-goals、§12)。
//
// 関数列は上段の半高、メイングリッドは 5×5 でちょうど 25 キー。複素数まわり
// (j・▸∠)は右端の列、四則はその左、制御(AC・DEL)は右上。

const FUNCTION_ROW: KeypadSection<KeyToken> = {
  ariaLabel: "関数キー",
  columns: 7,
  height: "half",
  keys: [
    {
      token: null,
      label: "Shift",
      ariaLabel: "第2面に切り替え",
      variant: "function",
      kind: "shift",
    },
    // 第 2 面に逆三角を置く(S-1 設計書 §7)。使用頻度が低く、sin/cos/tan の
    // 裏という対応が自然だからである。**S-1 で「準備中」の空き面は全部
    // 埋まり、S-4 で最後の予約スロットも埋まった**——盤面に空きは無い。
    {
      token: "sin",
      label: "sin",
      ariaLabel: "サイン",
      variant: "function",
      shift: {
        token: "asin",
        label: "asin",
        ariaLabel: "アークサイン",
        variant: "function",
      },
    },
    {
      token: "cos",
      label: "cos",
      ariaLabel: "コサイン",
      variant: "function",
      shift: {
        token: "acos",
        label: "acos",
        ariaLabel: "アークコサイン",
        variant: "function",
      },
    },
    {
      token: "tan",
      label: "tan",
      ariaLabel: "タンジェント",
      variant: "function",
      shift: {
        token: "atan",
        label: "atan",
        ariaLabel: "アークタンジェント",
        variant: "function",
      },
    },
    { token: "sqrt", label: "√", ariaLabel: "平方根", variant: "function" },
    { token: "sqr", label: "x²", ariaLabel: "2乗", variant: "function" },
    {
      token: "angle_toggle",
      label: "DRG",
      ariaLabel: "角度の単位を切り替え",
      variant: "function",
    },
  ],
};

/**
 * 関数列の 2 段目。**横に 8 列へ広げると 44px を割る**ので縦に増やした
 * (設計書 §7.1: 390px で 8 列は 38.75px)。キー幅は 45.43px のまま。
 *
 * **よく使う関数を第 1 面に出す**(S-1 設計書 §7)——関数電卓で `ln` や `log` が
 * Shift の裏なのは不便であり、空きを予約スロットで埋めたまま隠すのは本末転倒
 * である。**S-4 の `°'"` で 7 枠すべてが埋まった。**
 *
 * 区画名は 1 段目「関数キー」を**含まない**名前にする。Playwright の
 * `getByRole` は部分一致なので、「関数キー 2 段目」のような名前だと
 * `{ name: "関数キー" }` に当たってしまい、1 要素を期待する将来の E2E
 * locator が strict-mode エラーで詰まる(書いた本人には理由が見えない)。
 */
const FUNCTIONS_SECOND: KeypadSection<KeyToken> = {
  ariaLabel: "第 2 関数列",
  columns: 7,
  height: "half",
  keys: [
    {
      token: "eng",
      label: "ENG",
      ariaLabel: "工学表記に切り替え",
      variant: "function",
    },
    { token: "ln", label: "ln", ariaLabel: "自然対数", variant: "function" },
    {
      token: "log10",
      label: "log",
      ariaLabel: "常用対数",
      variant: "function",
    },
    { token: "recip", label: "1/x", ariaLabel: "逆数", variant: "function" },
    {
      token: "exp_e",
      label: "eˣ",
      ariaLabel: "指数関数",
      variant: "function",
      // **同じ e。`eˣ` を Shift すると底そのものが出る**(S-1 設計書 §7)。
      shift: {
        token: "e",
        label: "e",
        ariaLabel: "自然対数の底",
        variant: "function",
      },
    },
    { token: "pow", label: "xʸ", ariaLabel: "べき乗", variant: "function" },
    // **S-4 でここが埋まり、盤面に予約スロットは 1 つも無くなった。**
    // 表に出すのはユーザー裁定(時間計算をよく使うため。S-4 §5)。
    {
      token: "dms",
      label: "°′″",
      ariaLabel: "60進に切り替え",
      variant: "function",
    },
  ],
};

const MAIN_GRID: KeypadSection<KeyToken> = {
  ariaLabel: "数字と演算のキー",
  columns: 5,
  height: "square",
  keys: [
    { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
    { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
    {
      token: "neg",
      label: "+/−",
      ariaLabel: "符号を反転",
      variant: "function",
    },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    { token: "ac", label: "AC", ariaLabel: "全消去", variant: "danger" },

    // **数字キーに第 2 面が付くのはここが初めてである**(S-3 設計書 §7 の
    // 裁定 2)。3 つを隣り合わせに置ける場所が他に無い——関数列の裏は
    // S-1 が意味の対応(√→ln、sin→asin など)で埋めており、そこに割り込むと
    // 対応が壊れる。
    //
    // **第 2 面の variant を "function" にするのは意図的**。数字キーの上で
    // 面が変わったことが**色で分かる**ようにするためで、裁定 2 の
    // 「発見性」への答えである。E2E が実ブラウザで背景色を比べている。
    {
      token: "7",
      label: "7",
      ariaLabel: "7",
      variant: "digit",
      shift: {
        token: "n_fact",
        label: "n!",
        ariaLabel: "階乗",
        variant: "function",
      },
    },
    {
      token: "8",
      label: "8",
      ariaLabel: "8",
      variant: "digit",
      shift: {
        token: "n_p_r",
        label: "nPr",
        ariaLabel: "順列",
        variant: "function",
      },
    },
    {
      token: "9",
      label: "9",
      ariaLabel: "9",
      variant: "digit",
      shift: {
        token: "n_c_r",
        label: "nCr",
        ariaLabel: "組合せ",
        variant: "function",
      },
    },
    { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },
    { token: "j", label: "j", ariaLabel: "虚数単位", variant: "function" },

    { token: "4", label: "4", ariaLabel: "4", variant: "digit" },
    { token: "5", label: "5", ariaLabel: "5", variant: "digit" },
    { token: "6", label: "6", ariaLabel: "6", variant: "digit" },
    { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },
    {
      token: "polar_toggle",
      label: "▸∠",
      ariaLabel: "極形式と直交形式を切り替え",
      variant: "function",
    },

    { token: "1", label: "1", ariaLabel: "1", variant: "digit" },
    { token: "2", label: "2", ariaLabel: "2", variant: "digit" },
    { token: "3", label: "3", ariaLabel: "3", variant: "digit" },
    { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },
    // 第 1 面が Exp、第 2 面が π(設計書 §2/§5)。
    {
      token: "exp",
      label: "Exp",
      ariaLabel: "指数入力",
      variant: "function",
      shift: {
        token: "pi",
        label: "π",
        ariaLabel: "円周率",
        variant: "function",
      },
    },

    { token: "0", label: "0", ariaLabel: "0", variant: "digit" },
    { token: "zeros3", label: "000", ariaLabel: "3桁のゼロ", variant: "digit" },
    { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
    { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },
    { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
  ],
};

export const SCIENTIFIC_SECTIONS: KeypadSection<KeyToken>[] = [
  FUNCTION_ROW,
  FUNCTIONS_SECOND,
  MAIN_GRID,
];

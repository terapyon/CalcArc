import type { KeypadSection, ShiftFace } from "./types";

// Scientific のキー集合。
//
// 日本の電卓の**配置慣習と操作感まで**を参考にしている。意匠(配色・ボタン
// 形状・書体・ロゴ・製品名)は複製していない(base-spec §3 Non-goals、§12)。
//
// 関数列は上段の半高、メイングリッドは 5×5 でちょうど 25 キー。複素数まわり
// (j・▸∠)は右端の列、四則はその左、制御(AC・DEL)は右上。

/** 第 2 面の空きスロット。押しても何も起きない(設計書 §3)。 */
const EMPTY_FACE: ShiftFace = {
  token: null,
  label: "—",
  ariaLabel: "第2面（準備中）",
  variant: "function",
};

const FUNCTION_ROW: KeypadSection = {
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
    // 第 2 面は今回ほぼ空である(設計書 §3)。本命の asin/acos/atan は M3
    // 後半に入る。空きスロットは無効表示で「そこに何か来る」ことだけ示す。
    {
      token: "sin",
      label: "sin",
      ariaLabel: "サイン",
      variant: "function",
      shift: EMPTY_FACE,
    },
    {
      token: "cos",
      label: "cos",
      ariaLabel: "コサイン",
      variant: "function",
      shift: EMPTY_FACE,
    },
    {
      token: "tan",
      label: "tan",
      ariaLabel: "タンジェント",
      variant: "function",
      shift: EMPTY_FACE,
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

const MAIN_GRID: KeypadSection = {
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

    { token: "7", label: "7", ariaLabel: "7", variant: "digit" },
    { token: "8", label: "8", ariaLabel: "8", variant: "digit" },
    { token: "9", label: "9", ariaLabel: "9", variant: "digit" },
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

export const SCIENTIFIC_SECTIONS: KeypadSection[] = [FUNCTION_ROW, MAIN_GRID];

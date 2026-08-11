import type { KeyToken } from "../../calc";
import type { KeyVariant } from "../Key/Key";

export interface KeyDef {
  token: KeyToken;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
}

/**
 * 5 列 6 行のキー配置。スマートフォン縦持ちを前提とする(base-spec §42)。
 *
 * 既存製品のキー配置を写したものではない。よく使う数字を下段中央に寄せ、
 * 複素数まわり(j と ▸∠)を右列の手前に置いている(base-spec §12)。
 */
export const KEYPAD_LAYOUT: KeyDef[] = [
  { token: "sin", label: "sin", ariaLabel: "サイン", variant: "function" },
  { token: "cos", label: "cos", ariaLabel: "コサイン", variant: "function" },
  {
    token: "tan",
    label: "tan",
    ariaLabel: "タンジェント",
    variant: "function",
  },
  { token: "sqrt", label: "√", ariaLabel: "平方根", variant: "function" },
  { token: "sqr", label: "x²", ariaLabel: "2乗", variant: "function" },

  { token: "ac", label: "AC", ariaLabel: "全消去", variant: "danger" },
  { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
  { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
  { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
  { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },

  { token: "7", label: "7", ariaLabel: "7", variant: "digit" },
  { token: "8", label: "8", ariaLabel: "8", variant: "digit" },
  { token: "9", label: "9", ariaLabel: "9", variant: "digit" },
  { token: "j", label: "j", ariaLabel: "虚数単位", variant: "function" },
  { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },

  { token: "4", label: "4", ariaLabel: "4", variant: "digit" },
  { token: "5", label: "5", ariaLabel: "5", variant: "digit" },
  { token: "6", label: "6", ariaLabel: "6", variant: "digit" },
  { token: "pi", label: "π", ariaLabel: "円周率", variant: "function" },
  { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },

  { token: "1", label: "1", ariaLabel: "1", variant: "digit" },
  { token: "2", label: "2", ariaLabel: "2", variant: "digit" },
  { token: "3", label: "3", ariaLabel: "3", variant: "digit" },
  {
    token: "polar_toggle",
    label: "▸∠",
    ariaLabel: "極形式と直交形式を切り替え",
    variant: "function",
  },
  { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },

  { token: "0", label: "0", ariaLabel: "0", variant: "digit" },
  { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
  { token: "neg", label: "+/−", ariaLabel: "符号を反転", variant: "function" },
  {
    token: "angle_toggle",
    label: "DRG",
    ariaLabel: "角度の単位を切り替え",
    variant: "function",
  },
  { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
];

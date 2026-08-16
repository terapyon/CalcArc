/** calcarc-core の numeric::angle::AngleMode に対応。 */
export type AngleMode = "Deg" | "Rad";

/** calcarc-core の engine::state::DisplayForm に対応。 */
export type DisplayForm = "Rect" | "Polar";

/** calcarc-core の engine::state::Notation に対応。 */
export type Notation = "Normal" | "Eng";

/** calcarc-core の error::CalcError に対応。 */
export type CalcErrorCode =
  | "DivisionByZero"
  | "Overflow"
  | "TrigPole"
  | "DomainError"
  | "SyntaxError";

/** calcarc-core の engine::state::BinOp に対応。 */
export type BinOpName = "Add" | "Sub" | "Mul" | "Div" | "Pow";

/**
 * calcarc-core の engine::key::Key に対応するトークン。
 * 画面のボタンと物理キーボードの両方がここに写像される。
 */
export const KEY_TOKENS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "dot",
  "zeros3",
  "exp",
  "pi",
  "add",
  "sub",
  "mul",
  "div",
  "eq",
  "lparen",
  "rparen",
  "j",
  "polar_toggle",
  "sqrt",
  "sqr",
  "sin",
  "cos",
  "tan",
  "neg",
  "ac",
  "del",
  "angle_toggle",
  "eng",
  "pow",
  "ln",
  "log10",
  "exp_e",
  "recip",
  "asin",
  "acos",
  "atan",
  "e",
] as const;

export type KeyToken = (typeof KEY_TOKENS)[number];

/** calcarc-core の engine::display::DisplayState に対応。 */
export interface DisplayState {
  /** 保留中の式。保留が無いあいだは空(設計書 §4)。 */
  echo: string;
  main: string;
  angle: AngleMode;
  form: DisplayForm;
  notation: Notation;
  pendingOp: BinOpName | null;
  pendingDepth: number;
  error: CalcErrorCode | null;
}

/**
 * 電卓の状態。中身は calcarc-core の所有物なので不透明に扱う。
 * TypeScript 側は受け取ってそのまま返すだけで、構造に依存しない。
 */
export type EngineState = { readonly __engineState: unique symbol };

/** 1 回の遷移の結果。 */
export interface Step {
  state: EngineState;
  display: DisplayState;
}

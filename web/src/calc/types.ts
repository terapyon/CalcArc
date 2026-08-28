/**
 * calcarc-core の numeric::angle::AngleMode に対応。
 *
 * **配列が本体で、型はそこから派生する**(DATA_TYPE_TOKENS と同型)。
 * 設定の永続化が「取り得る値の列挙」を実行時に必要とするため
 * (P-1 設計書 §5)。綴りは Rust の serde の出力そのもので、
 * token_parity.rs が対応を守る。
 */
export const ANGLE_MODES = ["Deg", "Rad"] as const;
export type AngleMode = (typeof ANGLE_MODES)[number];

/** calcarc-core の engine::state::DisplayForm に対応。 */
export const DISPLAY_FORMS = ["Rect", "Polar"] as const;
export type DisplayForm = (typeof DISPLAY_FORMS)[number];

/** calcarc-core の engine::state::Notation に対応。 */
export const NOTATIONS = ["Normal", "Eng"] as const;
export type Notation = (typeof NOTATIONS)[number];

/** calcarc-core の error::CalcError に対応。 */
export type CalcErrorCode =
  | "DivisionByZero"
  | "Overflow"
  | "TrigPole"
  | "DomainError"
  | "SyntaxError";

/** calcarc-core の engine::state::BinOp に対応。 */
export type BinOpName = "Add" | "Sub" | "Mul" | "Div" | "Pow" | "Npr" | "Ncr";

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
  "n_fact",
  "n_p_r",
  "n_c_r",
  "dms",
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

/**
 * 境界を渡る 2 択。**無効な状態を表現できない**——成功なら payload が全部在り、
 * 失敗なら `code` だけが在る(設計書 §0)。
 *
 * 以前は「N 個の payload `| null` ＋ `error: E | null`」で、
 * `LoanBonusForwardResult` が**ありうる**と言っていた状態は 256 通りだった。
 * **実際に起きるのは 2 通り**である。
 *
 * **規約はここ 1 箇所、名前は関数ごとに実体化して残す。** 10 個を手で書くと、
 * 11 個目を書く人が写し間違える。
 *
 * Rust 側は `crates/calcarc-wasm/src/outcome.rs` の `Outcome<T>` で、
 * **内側 tag**——`{"kind":"ok", …payload}` / `{"kind":"error","code":"…"}`。
 * 実物は `tests/web.rs` が実ブラウザで固定している。
 */
export type Outcome<T, E> = ({ kind: "ok" } & T) | { kind: "error"; code: E };

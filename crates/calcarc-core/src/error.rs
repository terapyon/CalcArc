use serde::{Deserialize, Serialize};

/// 計算中に発生しうるエラー。UI に panic を露出させないため、
/// 計算コアは必ずこの型を通してエラーを返す（base-spec §27）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CalcError {
    /// 0 による除算。
    DivisionByZero,
    /// 結果が f64 の有限範囲を超えた。
    Overflow,
    /// tan の極（Deg モードの 90 + 180n 度）での評価。
    TrigPole,
    /// その値にはその関数が定義されていない。`ln(0)` や `sqrt(-4)` など。
    ///
    /// `SyntaxError` と混ぜない。「打ち方が悪い」と「その値には定義が無い」は
    /// 利用者にとって別の話で、`ln(-1)` を SyntaxError と言われても直しようがない。
    DomainError,
    /// 対応しない `)` や `.` の重複など、入力列として不正。
    SyntaxError,
}

pub type CalcResult<T> = Result<T, CalcError>;

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
    /// 対応しない `)` や `.` の重複など、入力列として不正。
    SyntaxError,
}

pub type CalcResult<T> = Result<T, CalcError>;

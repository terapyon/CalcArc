//! CalcArc の計算コア。WASM と UI に依存しない。

pub mod complex;
pub mod error;

pub use complex::value::Value;
pub use error::{CalcError, CalcResult};

/// ユニットテストの既定許容誤差。
///
/// 言語間検証（golden）の許容誤差はこれとは別で、
/// `testdata/*.json` の `tolerance` から読む。混同しないこと。
pub const TEST_EPSILON: f64 = 1e-12;

/// 浮動小数点の近似比較。個々のテストに誤差値を書かないためのヘルパー。
#[cfg(test)]
pub(crate) fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < TEST_EPSILON,
        "expected {expected}, got {actual}"
    );
}

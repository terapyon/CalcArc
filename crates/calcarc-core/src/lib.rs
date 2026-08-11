//! CalcArc の計算コア。WASM と UI に依存しない。

pub mod complex;
pub mod error;
pub mod numeric;

pub use complex::value::Value;
pub use error::{CalcError, CalcResult};
pub use numeric::angle::AngleMode;

/// ユニットテストの既定許容誤差。
///
/// 言語間検証（golden）の許容誤差はこれとは別で、
/// `testdata/*.json` の `tolerance` から読む。混同しないこと。
pub const TEST_EPSILON: f64 = 1e-12;

/// rect → polar → rect の往復で許す相対誤差。
///
/// 三角関数と平方根を経由するぶん TEST_EPSILON より緩いが、
/// 実際の往復誤差は 1 ULP 程度（相対 2e-16）なので 4 桁の余裕がある。
/// これ以上緩めると、f32 相当（相対 1e-7）まで精度が落ちても
/// テストが通ってしまい、往復テストが精度を見張らなくなる。
pub const ROUNDTRIP_EPSILON: f64 = 1e-12;

/// 浮動小数点の近似比較。個々のテストに誤差値を書かないためのヘルパー。
#[cfg(test)]
pub(crate) fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < TEST_EPSILON,
        "expected {expected}, got {actual}"
    );
}

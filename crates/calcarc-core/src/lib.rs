//! CalcArc の計算コア。WASM と UI に依存しない。

// 本番経路で panic しないことをコンパイラに守らせる(base-spec §27)。
// テストコードでは unwrap を使うため、not(test) で限定する。
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

pub mod data_scale;
pub mod engine;
pub mod error;
pub mod finance;
pub mod loan;
pub mod numeric;
pub mod polar;
pub mod scientific;
pub mod value;

pub use error::{CalcError, CalcResult};
pub use numeric::angle::AngleMode;
pub use value::Value;

pub use engine::{DisplayState, EngineState, Key, reduce, render};

/// ユニットテストの既定許容誤差。
///
/// 言語間検証（golden）の許容誤差はこれとは別で、
/// `testdata/*.json` の `tolerance` から読む。混同しないこと。
///
/// 使うのは `assert_close`（`#[cfg(test)]`）だけなので、この定数も
/// 同じ条件でしか要らない。`pub(crate)` のまま通常ビルドに残すと
/// dead_code になる。
#[cfg(test)]
pub(crate) const TEST_EPSILON: f64 = 1e-12;

/// rect → polar → rect の往復で許す相対誤差。
///
/// 統合テスト（`tests/roundtrip.rs`）が使うための公開定数である。
/// ユニットテストの既定許容誤差と同値（1e-12）だが、往復の性質上
/// ここは独立に調整しうる。実際の往復誤差は 1 ULP 程度（相対 2e-16）
/// なので 4 桁の余裕がある。これ以上緩めると、f32 相当（相対 1e-7）
/// まで精度が落ちてもテストが通ってしまい、往復テストが精度を
/// 見張らなくなる。
pub const ROUNDTRIP_EPSILON: f64 = 1e-12;

/// 浮動小数点の近似比較。個々のテストに誤差値を書かないためのヘルパー。
#[cfg(test)]
pub(crate) fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < TEST_EPSILON,
        "expected {expected}, got {actual}"
    );
}

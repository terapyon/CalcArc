//! CalcArc の計算コア。WASM と UI に依存しない。

pub mod complex;
pub mod error;

pub use complex::value::Value;
pub use error::{CalcError, CalcResult};

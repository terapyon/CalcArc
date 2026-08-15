//! Finance の計算コア。いまは複利と税だけを持つ。
//!
//! **ローン(`crate::loan`)は移していない。** 移動は wasm・テスト・web の
//! import に波及するので、機能追加と同じ変更に混ぜない(設計書 §7 の
//! 【訂正 3】、API 整理 PR #19 の方式)。`finance::compound` なので
//! `loan::compound` という名前の嘘は生じない。再配置は別 spec で行う。

pub mod compound;
pub mod loan;
pub mod tax;

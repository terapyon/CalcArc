//! Loan Calculator の計算コア(base-spec §20〜§21、設計書 2026-08-13)。
//!
//! 製品方針は**決定的概算**(設計書 §0): 実額の機関一致は非目標で、
//! 同じ入力が常に同じ答を返すことを保証する。数値経路は 2 本ある:
//!
//! - **償還表**(`schedule`)は厳密整数だけで走る。各行利息は
//!   floor(残高×分子/分母) を u128 中間で計算し、f64 を通さない(設計書 §1-1)。
//! - **f64 は閉形式の月額決定にのみ使う**(設計書 §1-3)。逆算でも f64 は
//!   候補を出すだけで、答は厳密償還表が確定する(設計書 §5)。
//!
//! `Value`/`engine`/`data_scale` とは相互 import しない(設計書 §9)。
//! 共有するのはエラー分類(`CalcError`)だけ。

pub mod bonus;
pub mod closed_form;
pub mod forward;
pub mod inverse;
pub mod rate;
pub mod schedule;

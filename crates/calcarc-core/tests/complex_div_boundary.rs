//! 複素除算の境界専用 golden（F7 は 0.9.4、F16 は 0.9.5）を native で確かめる。
//!
//! **通常のコーパスはこの領域に届かない。** `complex-000.json` の生成器は大きさを
//! `1e-6`〜`1e9` に制限しており、**帯を外しても乱択は上端 1 オクターブ
//! (`MAX/2`〜`MAX`)を踏まない**——20 万本で 27,046 件の除算を真値と突き合わせて
//! **踏んだのは 0 件**だった（2026-09-18 実測）。**だから構成したケースがここに在る。**
//! **F16（成分間の指数差が 1023 以上）も同じ**——帯の中では差は高々 50 程度である。
//!
//! **許容はテストコードに書かない**(CLAUDE.md)——`testdata/complex_div_boundary.json`
//! の `tolerance`（`rel` と `abs_floor`）から読む。判定の規則は本文の `component_failures`。
//!
//! **本文は `tests/support/complex_div_boundary_body.rs` に 1 つだけ在り**、
//! wasm32 側（`crates/calcarc-wasm/tests/complex_div_boundary.rs`）も同じものを `include!` する。
//!
//! Run: cargo test -p calcarc-core --test complex_div_boundary

include!("support/complex_div_boundary_body.rs");

#[test]
fn complex_division_holds_at_the_boundaries() {
    check_complex_div_boundaries();
}

//! 複素除算の境界専用 golden（F7 は 0.9.4、F16 は 0.9.5）を **製品が走る wasm32** で確かめる。
//!
//! **native の緑は製品の緑ではない。** native の Rust は x86 の libm、ブラウザの
//! wasm32 は Rust 自前の libm で、**非正規化域の扱いが違えば件数が変わりうる**
//! (`loan_boundary.rs` と同じ理由)。**2026-09-18 に両方で測り、件数も id も
//! 完全に一致した**——**違っていたら、数を緩めるのではなく両者を別々に記録する。**
//!
//! **判定は assert に載せる。** wasm-bindgen-test は**緑のとき `println!` を出さない**
//! ので、**印字を読んで結論できない**。件数も「どこに在るか」も assert で言う
//! ——**印字が切れても崩れない主張**である。
//!
//! **本文は native と同じファイルを `include!` する**
//! （`crates/calcarc-core/tests/support/complex_div_boundary_body.rs`）。0.9.4 までは写しで、
//! 「片方だけ直すと違う主張になる」を註で断っていた——**写しが無ければ食い違えない。**
//!
//! Run: wasm-pack test --headless --chrome --chromedriver <path> crates/calcarc-wasm
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

include!("../../calcarc-core/tests/support/complex_div_boundary_body.rs");

#[wasm_bindgen_test]
fn complex_division_holds_at_the_boundaries() {
    check_complex_div_boundaries();
}

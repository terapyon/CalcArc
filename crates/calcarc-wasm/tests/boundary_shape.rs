//! 境界が吐く JSON の形を見張る。
//!
//! **`rename_all` は 2 か所が別々に効かせている**(設計書 §4)——
//! `Outcome` に付けたものは **tag の値**(`Ok` → `"ok"`)しか決めず、
//! **payload のフィールド名は payload 構造体自身**が決める。
//! **構造体側を書き忘れると `monthly_payment` のまま出る**が、
//! **Rust も TypeScript もコンパイルは通る**——型は綴りを見ていない。
//!
//! 実ブラウザで走らせる。`wasm-pack test --headless --firefox crates/calcarc-wasm`
//! (手元は ChromeDriver と Chrome の版が噛み合わないため firefox。CI は chrome)。
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

/// 成功の JSON を文字列で取る。**形を見るので、キーを 1 つずつ引かない。**
fn forward_json(principal: &str, bonus: &str, rate: &str, months: u32) -> String {
    let value = calcarc_wasm::loan_bonus_forward(principal, bonus, rate, months);
    String::from(js_sys::JSON::stringify(&value).unwrap())
}

#[wasm_bindgen_test]
fn no_boundary_field_is_written_in_snake_case() {
    let json = forward_json("30000000", "5000000", "1.5", 420);
    // **この payload の値に `_` は出ない**——7 つとも数字の文字列と `"ok"` だけ
    // である。だから `_` が 1 つでも在れば、それはフィールド名の綴りである。
    assert!(
        !json.contains('_'),
        "snake_case が漏れている(値に `_` は出ない payload である): {json}"
    );
    // **在るべき綴りも名指しする。** 「`_` が無い」だけだと、フィールドが
    // 丸ごと消えた日にも緑になる。
    for key in [
        "\"kind\"",
        "\"monthlyPayment\"",
        "\"bonusPayment\"",
        "\"bonusRows\"",
        "\"totalPayment\"",
        "\"totalInterest\"",
        "\"monthlyFinalPayment\"",
        "\"bonusFinalPayment\"",
    ] {
        assert!(json.contains(key), "{key} が無い: {json}");
    }
}

/// 失敗の JSON から `code` を取り出す。成功なら `None`。
fn code_of(json: &str) -> Option<String> {
    json.split(r#""code":""#)
        .nth(1)
        .and_then(|s| s.split('"').next())
        .map(str::to_owned)
}

/// TS の `LoanErrorCode` が挙げている綴り。**`web/src/finance/loan/types.ts` の
/// `Extract<CalcErrorCode, "Overflow" | "SyntaxError">` から写した 2 つ**である。
///
/// **写しである以上ずれうる。ずれたらこのテストが落ちる**のが役目である
/// ——「この関数はこのエラーしか返さない」は TS 側の手書きの主張で、
/// Rust は何も保証していない(設計書 §5)。
const LOAN_ERROR_CODES: &[&str] = &["Overflow", "SyntaxError"];

#[wasm_bindgen_test]
fn the_loan_boundary_returns_only_the_codes_typescript_knows() {
    // **2 種類とも踏む入力を選んである。** 計画が挙げていた 3 つは
    // **実測すると 3 つとも `SyntaxError`** で、それだと**この番人は 1 種類しか
    // 見ていない**(2026-08-28 の実測)。下の 5 つで両方を踏む。
    let cases = [
        // 金利の綴りが壊れている
        ("30000000", "5000000", "x", 420u32),
        // 金額が u64 に収まらない(20 桁)
        ("99999999999999999999", "5000000", "1.5", 420),
        // 期間 0
        ("30000000", "5000000", "1.5", 0),
        // u64 の上限 × 上限の金利 → 計算の途中で溢れる
        ("18446744073709551615", "18446744073709551615", "100", 1200),
        // 期間が u32 の上限
        ("30000000", "5000000", "1.5", 4294967295),
        // u64 の上限 × 上限の金利 → 計算の途中で溢れる
        // 期間が u32 の上限
    ];
    let codes: Vec<String> = cases
        .iter()
        .filter_map(|(p, b, r, m)| code_of(&forward_json(p, b, r, *m)))
        .collect();

    // **踏んだ数を先に主張する。** 入力が全部成功に転じた日に、
    // 「TS が知らないエラーは 0 件」で緑を返してしまう。
    assert_eq!(
        codes.len(),
        cases.len(),
        "失敗しなかった入力が在る: {codes:?}"
    );

    for code in &codes {
        assert!(
            LOAN_ERROR_CODES.contains(&code.as_str()),
            "TS が知らないエラーが境界を渡った: {code} ({codes:?})",
        );
    }

    // **2 種類とも実際に踏んでいること。** 片方しか踏まない入力集合になると、
    // この番人はもう片方について何も言っていない。
    for expected in LOAN_ERROR_CODES {
        assert!(
            codes.iter().any(|c| c == expected),
            "{expected} を踏む入力が無い: {codes:?}",
        );
    }
}

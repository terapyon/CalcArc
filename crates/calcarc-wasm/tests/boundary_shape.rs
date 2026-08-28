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

/// 複利の成功の JSON。**税 ON** で取る——税 OFF だと、本当に任意な 3 項目が
/// `null` になって「フィールドが在るか」の主張とまぎれる(設計書 §3)。
fn compound_json(principal: &str, deposit: &str, rate: &str, periods: u32) -> String {
    let value = calcarc_wasm::compound_grow(principal, deposit, rate, 12, periods, true);
    String::from(js_sys::JSON::stringify(&value).unwrap())
}

#[wasm_bindgen_test]
fn no_compound_field_is_written_in_snake_case() {
    // **`_` を含む綴りが 3 つある**(`final_balance`・`principal_total`・
    // `national_tax`)。ローン側より書き忘れが出やすい。
    let json = compound_json("1000000", "0", "1", 60);
    assert!(
        !json.contains('_'),
        "snake_case が漏れている(値に `_` は出ない payload である): {json}"
    );
    for key in [
        "\"kind\"",
        "\"finalBalance\"",
        "\"principalTotal\"",
        "\"interest\"",
        "\"nationalTax\"",
        "\"localTax\"",
        "\"net\"",
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

/// TS の `CompoundErrorCode` が挙げている綴り。ローン側と同じ 2 つだが、
/// **同じである保証は無い**——`web/src/finance/types.ts` から別に写してある。
const COMPOUND_ERROR_CODES: &[&str] = &["Overflow", "SyntaxError"];

#[wasm_bindgen_test]
fn the_compound_boundary_returns_only_the_codes_typescript_knows() {
    let cases = [
        // 単調増加なので u64 を超えうる——**ローンには無い経路**である。
        ("18446744073709551615", "0", "100", 12u32),
        // 積立の側から溢れる
        ("0", "18446744073709551615", "100", 1200),
        // 金利の綴りが壊れている
        ("1000000", "0", "x", 12),
        // 期数 0 はコアの定義域の外
        ("1000000", "0", "1", 0),
    ];
    let codes: Vec<String> = cases
        .iter()
        .filter_map(|(p, d, r, n)| code_of(&compound_json(p, d, r, *n)))
        .collect();

    assert_eq!(
        codes.len(),
        cases.len(),
        "失敗しなかった入力が在る: {codes:?}"
    );
    for code in &codes {
        assert!(
            COMPOUND_ERROR_CODES.contains(&code.as_str()),
            "TS が知らないエラーが境界を渡った: {code} ({codes:?})",
        );
    }
    for expected in COMPOUND_ERROR_CODES {
        assert!(
            codes.iter().any(|c| c == expected),
            "{expected} を踏む入力が無い: {codes:?}",
        );
    }
}

/// Data Scale の成功の JSON。**単位が付く大きさ**で取る——小さい値だと
/// `decimal`/`binary` が null になって「フィールドが在るか」とまぎれる。
fn data_scale_json(count: &str, dimensions: &str, dtype: &str) -> String {
    let value = calcarc_wasm::data_scale(count, dimensions, dtype);
    String::from(js_sys::JSON::stringify(&value).unwrap())
}

#[wasm_bindgen_test]
fn no_data_scale_field_is_written_in_snake_case() {
    let json = data_scale_json("1000000", "1024", "float32");
    assert!(
        !json.contains('_'),
        "snake_case が漏れている(値に `_` は出ない payload である): {json}"
    );
    for key in [
        "\"kind\"",
        "\"bytes\"",
        "\"bytesGrouped\"",
        "\"decimal\"",
        "\"binary\"",
    ] {
        assert!(json.contains(key), "{key} が無い: {json}");
    }
}

/// TS の `DataScaleErrorCode` が挙げている綴り(`web/src/datascale/types.ts`)。
const DATA_SCALE_ERROR_CODES: &[&str] = &["Overflow", "SyntaxError"];

#[wasm_bindgen_test]
fn the_data_scale_boundary_returns_only_the_codes_typescript_knows() {
    let cases = [
        // u128 を超える(2^127 を 2 次元)
        ("170141183460469231731687303715884105728", "2", "uint8"),
        // 掛け算の途中で溢れる
        (
            "170141183460469231731687303715884105727",
            "170141183460469231731687303715884105727",
            "uint8",
        ),
        // dtype の綴りが壊れている
        ("1000", "1", "x"),
        // 個数の綴りが壊れている
        ("x", "1", "int8"),
    ];
    let codes: Vec<String> = cases
        .iter()
        .filter_map(|(c, d, t)| code_of(&data_scale_json(c, d, t)))
        .collect();

    assert_eq!(
        codes.len(),
        cases.len(),
        "失敗しなかった入力が在る: {codes:?}"
    );
    for code in &codes {
        assert!(
            DATA_SCALE_ERROR_CODES.contains(&code.as_str()),
            "TS が知らないエラーが境界を渡った: {code} ({codes:?})",
        );
    }
    for expected in DATA_SCALE_ERROR_CODES {
        assert!(
            codes.iter().any(|c| c == expected),
            "{expected} を踏む入力が無い: {codes:?}",
        );
    }
}

/// LLM の JSON。**3 組の入れ子**を返すので、綴りの見落としが起きやすい。
fn llm_json(parameters: &str, weight: &str, layers: &str, kv: &str) -> String {
    let value = calcarc_wasm::llm_memory(parameters, weight, layers, "16", "128", "8192", kv);
    String::from(js_sys::JSON::stringify(&value).unwrap())
}

#[wasm_bindgen_test]
fn no_llm_field_is_written_in_snake_case() {
    // **入れ子の中まで見る。** 外側の 3 つに `_` は無いので、外側だけ見る
    // 番人は組の中の `bytes_grouped` を取り逃がす。
    let json = llm_json("27000000000", "int4", "62", "fp16");
    assert!(
        !json.contains('_'),
        "snake_case が漏れている(値に `_` は出ない payload である): {json}"
    );
    for key in ["\"kind\"", "\"weight\"", "\"kv\"", "\"total\""] {
        assert!(json.contains(key), "{key} が無い: {json}");
    }
    // **組の中の 4 点も名指しする。** 3 回ずつ出る。
    for key in ["\"bytes\"", "\"bytesGrouped\"", "\"decimal\"", "\"binary\""] {
        assert_eq!(json.matches(key).count(), 3, "{key} が 3 組に無い: {json}");
    }
}

#[wasm_bindgen_test]
fn the_llm_boundary_returns_only_the_codes_typescript_knows() {
    let cases = [
        // 重みが u128 を超える
        (
            "170141183460469231731687303715884105727",
            "fp32",
            "62",
            "fp16",
        ),
        // KV cache が u128 を超える
        (
            "1",
            "int4",
            "170141183460469231731687303715884105727",
            "fp16",
        ),
        // 重みの精度の綴りが壊れている
        ("27000000000", "x", "62", "fp16"),
        // KV の精度の綴りが壊れている
        ("27000000000", "int4", "62", "x"),
    ];
    let codes: Vec<String> = cases
        .iter()
        .filter_map(|(p, w, l, k)| code_of(&llm_json(p, w, l, k)))
        .collect();

    assert_eq!(
        codes.len(),
        cases.len(),
        "失敗しなかった入力が在る: {codes:?}"
    );
    for code in &codes {
        assert!(
            DATA_SCALE_ERROR_CODES.contains(&code.as_str()),
            "TS が知らないエラーが境界を渡った: {code} ({codes:?})",
        );
    }
    for expected in DATA_SCALE_ERROR_CODES {
        assert!(
            codes.iter().any(|c| c == expected),
            "{expected} を踏む入力が無い: {codes:?}",
        );
    }
}

/// TS の `ExprErrorCode` が挙げている綴り(`web/src/expr/types.ts`)。
/// **ここだけ 3 つある**——他の関数と同じ 2 つだと思い込まないこと。
const EXPR_ERROR_CODES: &[&str] = &["Overflow", "SyntaxError", "DivisionByZero"];

#[wasm_bindgen_test]
fn the_expression_boundary_returns_only_the_codes_typescript_knows() {
    let cases = [
        // 0 で割る
        "1/0",
        // 式が途中で終わっている
        "1+",
        // 上限(u64 の最大)を超える
        "99999999999999999999",
        // 知らない単位
        "1兆",
    ];
    let codes: Vec<String> = cases
        .iter()
        .filter_map(|text| {
            let value = calcarc_wasm::expr_integer(text, "18446744073709551615", "yen");
            code_of(&String::from(js_sys::JSON::stringify(&value).unwrap()))
        })
        .collect();

    assert_eq!(
        codes.len(),
        cases.len(),
        "失敗しなかった入力が在る: {codes:?}"
    );
    for code in &codes {
        assert!(
            EXPR_ERROR_CODES.contains(&code.as_str()),
            "TS が知らないエラーが境界を渡った: {code} ({codes:?})",
        );
    }
    // **3 種類とも踏む。** `DivisionByZero` は expr にしか無い綴りなので、
    // ここで踏まないとどこも見ていないことになる。
    for expected in EXPR_ERROR_CODES {
        assert!(
            codes.iter().any(|c| c == expected),
            "{expected} を踏む入力が無い: {codes:?}",
        );
    }
}

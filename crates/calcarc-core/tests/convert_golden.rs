//! convert の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。**係数はすべて定義値で、経路は有理数のまま**なので、
//! 許容誤差という概念が存在しない(U-1 spec §6)。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::convert::format::format_rational;
use calcarc_core::convert::{Category, Unit, convert};
use serde::Deserialize;

const SCHEMA: u32 = 1;

#[derive(Debug, Deserialize)]
struct Golden {
    schema: u32,
    generated_by: String,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    input: Input,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct Input {
    value: String,
    category: String,
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "testdata",
        "convert.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e}. Run reference/scripts/generate.py",
            path.display()
        )
    });
    let golden: Golden = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
    assert_eq!(golden.schema, SCHEMA, "incompatible schema");
    assert!(!golden.cases.is_empty(), "no cases");
    golden
}

fn run(input: &Input) -> Result<String, CalcError> {
    let category = Category::from_token(&input.category).ok_or(CalcError::SyntaxError)?;
    let from = Unit::from_token(&input.from).ok_or(CalcError::SyntaxError)?;
    let to = Unit::from_token(&input.to).ok_or(CalcError::SyntaxError)?;
    format_rational(convert(&input.value, category, from, to)?)
}

#[test]
fn convert_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    // **何件をどちらの枝で見たかを数える。** ループだけだと、全件が error 枝に
    // 落ちた日でもこのテストは緑を返す(tests-can-assert-nothing)。
    let mut ok = 0usize;
    let mut errors = 0usize;

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok(text), None) => {
                assert_eq!(Some(text), case.expect.text, "{}: text", case.id);
                ok += 1;
            }
            (Err(e), Some(expected)) => {
                // **`Overflow` の枝は構造上ずっと 0 件になる。** 参照実装の
                // `Fraction` は無限精度であふれないので、golden にはこの枝を
                // 埋めるケースを置けない(spec §6 の【訂正 2026-08-20】)。
                // あふれを見張っているのは golden ではなく `convert/mod.rs` と
                // `convert/format.rs` の単体テスト(`a_ratio_too_wide_for_i128…`
                // など)。`transfer_golden.rs` からの写しとして残しているだけで、
                // 「golden が Overflow を見張っている」わけではない。
                let code = match e {
                    CalcError::Overflow => "Overflow",
                    CalcError::SyntaxError => "SyntaxError",
                    other => panic!("{}: unexpected error kind {other:?}", case.id),
                };
                assert_eq!(code, expected, "{}: error kind", case.id);
                errors += 1;
            }
            (Ok(_), Some(expected)) => panic!("{}: expected {expected} but succeeded", case.id),
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }

    assert_eq!(
        ok + errors,
        golden.cases.len(),
        "some case was not compared"
    );
    // **下限は Task 3 が実際に置いた件数から決める。** 2026-08-20 の実測: 成功 27 / エラー 4
    // ——「だいたい」で書くと、ケースが消えた日に緑のまま通る。
    assert!(ok >= 27, "only {ok} successful cases compared");
    assert!(errors >= 4, "only {errors} error cases compared");
}

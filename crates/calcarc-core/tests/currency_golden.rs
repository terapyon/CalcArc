//! currency の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。**レートは入力で、経路は有理数のまま**なので、許容誤差という
//! 概念が存在しない(U-4 spec §8「厳密一致」)。**プロバイダは叩かない**
//! ——レートは golden の中の 10 進文字列である。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::convert::currency::{Currency, convert_currency};
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
    to: String,
    from_rate: String,
    to_rate: String,
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
        "currency.json",
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
    // **`from` の通貨はここでは要らない**(換算に効くのは `from_rate` のほうで、
    // 桁を決めるのは着地する `to` だけである)。golden の `from` は id と
    // 読みやすさのために入っている。
    let to = Currency::from_token(&input.to).ok_or(CalcError::SyntaxError)?;
    convert_currency(&input.value, to, &input.from_rate, &input.to_rate)
}

#[test]
fn currency_matches_the_reference() {
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
                let code = match e {
                    CalcError::DivisionByZero => "DivisionByZero",
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
    // **下限は実測ちょうど。** 2026-08-20 の実測(Task 3): 成功 28 / エラー 5
    // ——「だいたい」で書くと、ケースが消えた日に緑のまま通る。
    assert!(ok >= 28, "only {ok} successful cases compared");
    assert!(errors >= 5, "only {errors} error cases compared");
}

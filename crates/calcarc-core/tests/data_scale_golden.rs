//! data_scale の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。整数と決定的な丸めに許容誤差は存在しないので、
//! このファイルの golden は tolerance を持たない(設計書 §5)。
//! バイト数は JSON でも文字列——JSON number は 2^53 で精度を失う。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::{self, DataType};
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
    count: String,
    dimensions: String,
    dtype: String,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    bytes: Option<String>,
    #[serde(default)]
    bytes_grouped: Option<String>,
    #[serde(default)]
    decimal: Option<String>,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "testdata",
        "data_scale.json",
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

/// 入力 3 つから Rust 側の結果を出す。参照実装の compute と同じ形の分岐。
fn run(input: &Input) -> Result<(u128, String, Option<String>, Option<String>), CalcError> {
    let count = data_scale::parse_count(&input.count)?;
    let dimensions = data_scale::parse_count(&input.dimensions)?;
    let dtype = DataType::from_token(&input.dtype).ok_or(CalcError::SyntaxError)?;
    let bytes = data_scale::size_in_bytes(count, dimensions, dtype)?;
    Ok((
        bytes,
        group_digits(bytes),
        format_decimal(bytes),
        format_binary(bytes),
    ))
}

#[test]
fn data_scale_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok((bytes, grouped, decimal, binary)), None) => {
                assert_eq!(
                    Some(bytes.to_string()),
                    case.expect.bytes,
                    "{}: bytes",
                    case.id
                );
                assert_eq!(
                    Some(grouped),
                    case.expect.bytes_grouped,
                    "{}: grouped",
                    case.id
                );
                assert_eq!(decimal, case.expect.decimal, "{}: decimal", case.id);
                assert_eq!(binary, case.expect.binary, "{}: binary", case.id);
            }
            (Err(e), Some(expected)) => {
                let code = match e {
                    CalcError::Overflow => "Overflow",
                    CalcError::SyntaxError => "SyntaxError",
                    other => panic!("{}: unexpected error kind {other:?}", case.id),
                };
                assert_eq!(code, expected, "{}: error kind", case.id);
            }
            (Ok(_), Some(expected)) => panic!("{}: expected {expected} but succeeded", case.id),
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }
}

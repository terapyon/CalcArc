//! transfer の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。整数と決定的な丸めに許容誤差は存在しないので、
//! このファイルの golden は tolerance を持たない(data_scale_golden と同じ)。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::parse_count;
use calcarc_core::data_scale::transfer::{self, BandwidthUnit, DurationUnit};
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
    bandwidth: String,
    bandwidth_unit: String,
    duration: String,
    duration_unit: String,
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
        "transfer.json",
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

fn run(input: &Input) -> Result<u128, CalcError> {
    let bandwidth = parse_count(&input.bandwidth)?;
    let duration = parse_count(&input.duration)?;
    let unit = BandwidthUnit::from_token(&input.bandwidth_unit).ok_or(CalcError::SyntaxError)?;
    let per = DurationUnit::from_token(&input.duration_unit).ok_or(CalcError::SyntaxError)?;
    transfer::transferred_bytes(bandwidth, unit, duration, per)
}

#[test]
fn transfer_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    // **何件をどちらの枝で見たかを数える。** ループだけだと、全件が error 枝に
    // 落ちた日でもこのテストは緑を返す(tests-can-assert-nothing)。
    let mut ok = 0usize;
    let mut errors = 0usize;

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok(bytes), None) => {
                assert_eq!(
                    Some(bytes.to_string()),
                    case.expect.bytes,
                    "{}: bytes",
                    case.id
                );
                assert_eq!(
                    Some(group_digits(bytes)),
                    case.expect.bytes_grouped,
                    "{}: grouped",
                    case.id
                );
                assert_eq!(
                    format_decimal(bytes),
                    case.expect.decimal,
                    "{}: decimal",
                    case.id
                );
                assert_eq!(
                    format_binary(bytes),
                    case.expect.binary,
                    "{}: binary",
                    case.id
                );
                ok += 1;
            }
            (Err(e), Some(expected)) => {
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
    assert!(ok >= 6, "only {ok} successful cases compared");
    assert!(errors >= 3, "only {errors} error cases compared");
}

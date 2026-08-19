//! llm の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。整数と決定的な丸めに許容誤差は存在しないので、
//! このファイルの golden は tolerance を持たない(data_scale_golden と同じ)。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::llm::{self, Precision};
use calcarc_core::data_scale::parse_count;
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
    parameters: String,
    weight_precision: String,
    layers: String,
    kv_heads: String,
    head_dim: String,
    context_length: String,
    kv_precision: String,
}

#[derive(Debug, Deserialize)]
struct Lines {
    bytes: String,
    bytes_grouped: String,
    decimal: Option<String>,
    binary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    weight: Option<Lines>,
    #[serde(default)]
    kv: Option<Lines>,
    #[serde(default)]
    total: Option<Lines>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "testdata",
        "llm.json",
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

fn run(input: &Input) -> Result<llm::LlmMemory, CalcError> {
    let parameters = parse_count(&input.parameters)?;
    let layers = parse_count(&input.layers)?;
    let kv_heads = parse_count(&input.kv_heads)?;
    let head_dim = parse_count(&input.head_dim)?;
    let context_length = parse_count(&input.context_length)?;
    let weight = Precision::from_token(&input.weight_precision).ok_or(CalcError::SyntaxError)?;
    let kv = Precision::from_token(&input.kv_precision).ok_or(CalcError::SyntaxError)?;
    llm::memory(
        parameters,
        weight,
        layers,
        kv_heads,
        head_dim,
        context_length,
        kv,
    )
}

/// 1 組(bytes / 3 桁区切り / 10 進 / 2 進)を突き合わせる。
fn check(bytes: u128, expected: &Option<Lines>, id: &str, which: &str) {
    let expected = expected
        .as_ref()
        .unwrap_or_else(|| panic!("{id}: golden has no {which} block"));
    assert_eq!(bytes.to_string(), expected.bytes, "{id}: {which} bytes");
    assert_eq!(
        group_digits(bytes),
        expected.bytes_grouped,
        "{id}: {which} grouped"
    );
    assert_eq!(
        format_decimal(bytes),
        expected.decimal,
        "{id}: {which} decimal"
    );
    assert_eq!(
        format_binary(bytes),
        expected.binary,
        "{id}: {which} binary"
    );
}

#[test]
fn llm_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    // **何件をどちらの枝で見たかを数える。** ループだけだと、全件が error 枝に
    // 落ちた日でもこのテストは緑を返す(tests-can-assert-nothing)。
    let mut ok = 0usize;
    let mut errors = 0usize;

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok(memory), None) => {
                check(memory.weight_bytes, &case.expect.weight, &case.id, "weight");
                check(memory.kv_bytes, &case.expect.kv, &case.id, "kv");
                check(memory.total_bytes, &case.expect.total, &case.id, "total");
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
    assert!(ok >= 12, "only {ok} successful cases compared");
    assert!(errors >= 4, "only {errors} error cases compared");
}

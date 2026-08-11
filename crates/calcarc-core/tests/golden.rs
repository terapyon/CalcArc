//! Python が生成した期待値と Rust の結果を突き合わせる(base-spec §35)。
//!
//! 許容誤差は JSON の `tolerance` から読む。テストコードに誤差値を
//! 書かないこと(base-spec §36)。

use std::path::PathBuf;

use calcarc_core::complex::polar::{Polar, from_polar, to_polar};
use calcarc_core::numeric::angle::AngleMode;
use calcarc_core::{Value, scientific};
use serde::Deserialize;

const SCHEMA: u32 = 1;

#[derive(Debug, Deserialize)]
struct Golden {
    schema: u32,
    generated_by: String,
    tolerance: Tolerance,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct Tolerance {
    abs: f64,
    rel: f64,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    op: String,
    #[serde(default)]
    mode: Option<String>,
    input: serde_json::Value,
    expect: serde_json::Value,
}

fn load(name: &str) -> Golden {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "testdata", name]
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
    assert_eq!(
        golden.schema, SCHEMA,
        "{name} was generated with an incompatible schema"
    );
    assert!(!golden.cases.is_empty(), "{name} has no cases");
    golden
}

fn field(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key)
        .and_then(|x| x.as_f64())
        .unwrap_or_else(|| panic!("missing numeric field {key} in {v}"))
}

/// 絶対誤差か相対誤差のどちらかを満たせば合格とする。
/// 0 近傍では相対誤差が使えず、大きな値では絶対誤差が使えないため。
fn close(actual: f64, expected: f64, tol: Tolerance, id: &str, what: &str) {
    let diff = (actual - expected).abs();
    let ok = diff <= tol.abs || diff <= tol.rel * expected.abs();
    assert!(
        ok,
        "{id} / {what}: got {actual}, expected {expected} (diff {diff}, abs tol {}, rel tol {})",
        tol.abs, tol.rel
    );
}

fn angle_mode(case: &Case) -> AngleMode {
    match case.mode.as_deref() {
        Some("Rad") => AngleMode::Rad,
        // mode を持たないケースは度として扱う。
        Some("Deg") | None => AngleMode::Deg,
        // 綴り違いを黙って度に倒さない。ラジアンのケースが誤ったモードで
        // 評価されると「差が大きい」という分かりにくい失敗になり、
        // golden ファイルの不備が数値の不一致に化けてしまう。
        // このファイルの他の箇所(field / load)と同じく、不備は不備として落とす。
        Some(other) => panic!("{}: unknown angle mode {other:?}", case.id),
    }
}

#[test]
fn complex_conversions_match_the_reference() {
    let golden = load("complex.json");
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        match case.op.as_str() {
            "rect_to_polar" => {
                let v = Value::new(field(&case.input, "re"), field(&case.input, "im"));
                let p = to_polar(v);
                close(
                    p.r,
                    field(&case.expect, "r"),
                    golden.tolerance,
                    &case.id,
                    "r",
                );
                close(
                    p.theta_rad.to_degrees(),
                    field(&case.expect, "theta_deg"),
                    golden.tolerance,
                    &case.id,
                    "theta_deg",
                );
            }
            "polar_to_rect" => {
                let p = Polar {
                    r: field(&case.input, "r"),
                    theta_rad: field(&case.input, "theta_deg").to_radians(),
                };
                let v = from_polar(p);
                close(
                    v.re,
                    field(&case.expect, "re"),
                    golden.tolerance,
                    &case.id,
                    "re",
                );
                close(
                    v.im,
                    field(&case.expect, "im"),
                    golden.tolerance,
                    &case.id,
                    "im",
                );
            }
            other => panic!("{}: unknown op {other}", case.id),
        }
    }
}

#[test]
fn scientific_functions_match_the_reference() {
    let golden = load("scientific.json");
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        let x = Value::real(field(&case.input, "x"));
        let mode = angle_mode(case);
        let actual = match case.op.as_str() {
            "sin" => scientific::sin(x, mode),
            "cos" => scientific::cos(x, mode),
            "tan" => scientific::tan(x, mode),
            "sqrt" => scientific::sqrt(x),
            other => panic!("{}: unknown op {other}", case.id),
        }
        .unwrap_or_else(|e| panic!("{}: unexpected error {e:?}", case.id));

        close(
            actual.re,
            field(&case.expect, "re"),
            golden.tolerance,
            &case.id,
            "re",
        );
        close(
            actual.im,
            field(&case.expect, "im"),
            golden.tolerance,
            &case.id,
            "im",
        );
    }
}

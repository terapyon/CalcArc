//! Python が生成した期待値と Rust の結果を突き合わせる(base-spec §35)。
//!
//! 許容誤差は JSON の `tolerance` から読む。テストコードに誤差値を
//! 書かないこと(base-spec §36)。

use std::path::PathBuf;

use calcarc_core::AngleMode;
use calcarc_core::polar::{Polar, from_polar};
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

/// `expect` にエラーが書かれていればその名前。値のケースでは None。
fn expected_error(case: &Case) -> Option<&str> {
    case.expect.get("error").and_then(|e| e.as_str())
}

/// CalcError を golden の綴りに写す。
fn error_name(e: calcarc_core::CalcError) -> &'static str {
    use calcarc_core::CalcError::*;
    match e {
        DivisionByZero => "DivisionByZero",
        Overflow => "Overflow",
        TrigPole => "TrigPole",
        DomainError => "DomainError",
        SyntaxError => "SyntaxError",
    }
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

/// 複素数の結果は差ベクトルのノルムで比べる。
///
/// 乗除算は成分ごとの相対精度を保証しない。小さい成分は大きな積の差として
/// 復元されるため、成分比が偏るほど桁が落ちる（実装の不備ではなく複素数
/// 演算の性質。実測は docs/numerical-policy.md の「許容誤差」節）。
/// 保証されるのはノルムの相対精度であり、それを検査する。
/// 差ベクトルのノルムなので、成分の取り違え・符号違いも捕まる。
fn close_complex(actual: Value, expected_re: f64, expected_im: f64, tol: Tolerance, id: &str) {
    let diff = (actual.re - expected_re).hypot(actual.im - expected_im);
    let norm = expected_re.hypot(expected_im);
    let ok = diff <= tol.abs || diff <= tol.rel * norm;
    assert!(
        ok,
        "{id}: got ({}, {}), expected ({expected_re}, {expected_im}) \
         (norm diff {diff}, abs tol {}, rel tol {})",
        actual.re, actual.im, tol.abs, tol.rel
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
                let p = v.to_polar();
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
                close_complex(
                    v,
                    field(&case.expect, "re"),
                    field(&case.expect, "im"),
                    golden.tolerance,
                    &case.id,
                );
            }
            "add" | "sub" | "mul" | "div" => {
                let a = Value::new(field(&case.input, "a_re"), field(&case.input, "a_im"));
                let b = Value::new(field(&case.input, "b_re"), field(&case.input, "b_im"));
                let actual = match case.op.as_str() {
                    "add" => a.checked_add(b),
                    "sub" => a.checked_sub(b),
                    "mul" => a.checked_mul(b),
                    _ => a.checked_div(b),
                }
                .unwrap_or_else(|e| panic!("{}: unexpected error {e:?}", case.id));
                close_complex(
                    actual,
                    field(&case.expect, "re"),
                    field(&case.expect, "im"),
                    golden.tolerance,
                    &case.id,
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
            "ln" => scientific::ln(x),
            "log10" => scientific::log10(x),
            "exp_e" => scientific::exp_e(x),
            "asin" => scientific::asin(x, mode),
            "acos" => scientific::acos(x, mode),
            "atan" => scientific::atan(x, mode),
            "recip" => scientific::recip(x),
            other => panic!("{}: unknown op {other}", case.id),
        };

        match (actual, expected_error(case)) {
            (Ok(v), None) => close_complex(
                v,
                field(&case.expect, "re"),
                field(&case.expect, "im"),
                golden.tolerance,
                &case.id,
            ),
            (Err(e), Some(expected)) => {
                assert_eq!(error_name(e), expected, "{}: error kind", case.id)
            }
            (Ok(v), Some(expected)) => {
                panic!("{}: expected {expected} but got {v:?}", case.id)
            }
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }
}

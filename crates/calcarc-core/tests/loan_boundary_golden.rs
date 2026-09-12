//! 境界専用の golden(設計書 2026-09-12 §4)を native で確かめる。
//!
//! **許容と上限はテストコードに書かない**(CLAUDE.md)——`testdata/loan_boundary.json` の
//! `tolerance` と `max_monthly_yen` から読む。製品の算術はブラウザの wasm32 で走るので、
//! **同じ JSON を `crates/calcarc-wasm/tests/loan_boundary.rs` も読む**(両方緑で緑)。
use std::collections::BTreeMap;
use std::path::PathBuf;

use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward};
use serde::Deserialize;

#[derive(Deserialize)]
struct Golden {
    schema: u32,
    tolerance: Tolerance,
    max_monthly_yen: String,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Tolerance {
    below_yen: u64,
    above_yen: u64,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    op: String,
    set: String,
    boundary: String,
    input: Input,
    expect: Expect,
}

#[derive(Deserialize)]
struct Input {
    principal: String,
    rate: String,
    n: u32,
    #[serde(default)]
    residual: Option<String>,
    #[serde(default)]
    bonus_principal: Option<String>,
}

#[derive(Deserialize)]
struct Expect {
    monthly_floor: String,
    #[serde(default)]
    bonus_floor: Option<String>,
}

#[derive(Default, Debug)]
struct Tally {
    low: u32,
    same: u32,
    high: u32,
}

fn load() -> Golden {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "testdata",
        "loan_boundary.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e}. Run reference/scripts/generate.py",
            path.display()
        )
    });
    let golden: Golden =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("cannot parse: {e}"));
    assert_eq!(golden.schema, 1, "incompatible schema");
    golden
}

fn yen(text: &str) -> u64 {
    text.parse()
        .unwrap_or_else(|_| panic!("not a yen amount: {text}"))
}

/// `want − below ≤ got ≤ want + above` を見て、ずれの向きを数える。
fn check(got: u64, want: u64, tol: &Tolerance, tally: &mut Tally) -> bool {
    match got.cmp(&want) {
        std::cmp::Ordering::Less => tally.low += 1,
        std::cmp::Ordering::Equal => tally.same += 1,
        std::cmp::Ordering::Greater => tally.high += 1,
    }
    want.saturating_sub(tol.below_yen) <= got && got <= want.saturating_add(tol.above_yen)
}

#[test]
fn monthly_payments_stay_within_the_allowance_on_yen_boundaries() {
    let golden = load();
    let cap = yen(&golden.max_monthly_yen);
    let mut tallies: BTreeMap<String, Tally> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();
    let mut compared = 0usize;
    for case in &golden.cases {
        let rate = Rate::from_percent(&case.input.rate)
            .unwrap_or_else(|e| panic!("{}: rate {e:?}", case.id));
        let principal = yen(&case.input.principal);
        let want_monthly = yen(&case.expect.monthly_floor);
        assert!(
            want_monthly <= cap,
            "{}: expectation above the cap",
            case.id
        );
        let key = format!("{}/{}", case.set, case.boundary);
        let tally = tallies.entry(key).or_default();
        match case.op.as_str() {
            "loan_forward" => {
                let residual = yen(case.input.residual.as_deref().unwrap_or("0"));
                let out = forward::compute(principal, &rate, case.input.n, residual)
                    .unwrap_or_else(|e| panic!("{}: {e:?}", case.id));
                if !check(out.monthly_payment, want_monthly, &golden.tolerance, tally) {
                    failures.push(format!(
                        "{}: monthly {} vs floor {}",
                        case.id, out.monthly_payment, want_monthly
                    ));
                }
            }
            "loan_bonus_forward" => {
                let bp = yen(case.input.bonus_principal.as_deref().unwrap_or("0"));
                let want_bonus = yen(case.expect.bonus_floor.as_deref().unwrap_or("0"));
                let out = bonus::compute_forward(principal, bp, &rate, case.input.n)
                    .unwrap_or_else(|e| panic!("{}: {e:?}", case.id));
                if !check(out.monthly_payment, want_monthly, &golden.tolerance, tally) {
                    failures.push(format!(
                        "{}: monthly {} vs floor {}",
                        case.id, out.monthly_payment, want_monthly
                    ));
                }
                if !check(out.bonus_payment, want_bonus, &golden.tolerance, tally) {
                    failures.push(format!(
                        "{}: bonus {} vs floor {}",
                        case.id, out.bonus_payment, want_bonus
                    ));
                }
            }
            other => panic!("{}: unknown op {other}", case.id),
        }
        compared += 1;
    }
    // **何かを比べたことを数える**(記憶 tests-can-assert-nothing)。
    assert_eq!(compared, golden.cases.len());
    for set in ["plain", "residual", "bonus"] {
        for boundary in ["exact", "below", "above"] {
            let t = tallies.get(&format!("{set}/{boundary}"));
            assert!(
                t.is_some_and(|t| t.low + t.same + t.high > 0),
                "no cases in {set}/{boundary}"
            );
        }
    }
    eprintln!("loan boundary (native): {tallies:?}");
    assert!(
        failures.is_empty(),
        "{} outside the allowance:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

//! 境界専用の golden(設計書 2026-09-12 §4)を native で確かめる。
//!
//! **許容と上限はテストコードに書かない**(CLAUDE.md)——`testdata/loan_boundary.json` の
//! `tolerance` と `max_monthly_yen` から読む。製品の算術はブラウザの wasm32 で走るので、
//! **同じ JSON を `crates/calcarc-wasm/tests/loan_boundary.rs` も読む**(両方緑で緑)。
//!
//! 行は 3 種類ある。**上限を両側から挟むのが狙い**である(0.9.2 設計書 §5.1、PR D):
//!
//! - 値を期待する行(`plain`/`residual`/`bonus`): 円境界の上下 1 円以内。
//! - `over_cap`: 理論月額が上限 + 2 円以上。**`expect.error` の綴りで返ることを期待する**
//!   ——上限を上げれば、この行が値を返して赤くなる。
//! - `exempt`: 上限を掛けない経路(年利 0%・1 回払い)で、**上限を超える値**を期待する。
//!   上限をこの 2 つの経路に広げれば、この行がエラーになって赤くなる。
//!
//! 値の行が Err を返すのも、エラーの行が Ok を返すのも、どちらも失敗の 1 件である。
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
    /// 値を期待する行にだけ在る。
    #[serde(default)]
    monthly_floor: Option<String>,
    #[serde(default)]
    bonus_floor: Option<String>,
    /// 上限超えの行にだけ在る。`CalcError` の Debug の綴りと比べる
    /// ——**綴りは JSON が持ち、テストコードは持たない。**
    #[serde(default)]
    error: Option<String>,
}

#[derive(Default, Debug)]
struct Tally {
    low: u32,
    same: u32,
    high: u32,
    /// 期待どおりのエラーで返った行の数(値の比較は 1 度も起きない)。
    errors: u32,
}

/// 空でないことを見るセル。境界の 3 集合 × 3 ラベルに、上限の 2 つを足す。
const CELLS: &[(&str, &str)] = &[
    ("plain", "exact"),
    ("plain", "below"),
    ("plain", "above"),
    ("residual", "exact"),
    ("residual", "below"),
    ("residual", "above"),
    ("bonus", "exact"),
    ("bonus", "below"),
    ("bonus", "above"),
    ("over_cap", "over"),
    ("exempt", "over"),
];

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
        let want_error = case.expect.error.as_deref();
        let want_monthly = case.expect.monthly_floor.as_deref().map(yen);
        // **どの行も、値かエラーのどちらか一方だけを期待する。** 両方在る行も、
        // どちらも無い行も、JSON の作り損ねである。
        assert!(
            want_monthly.is_some() != want_error.is_some(),
            "{}: a case expects a value or an error, not both or neither",
            case.id
        );
        if let Some(want) = want_monthly {
            if case.set == "exempt" {
                // 上限を掛けない経路の行。**上限の下に居たら、その行は何も主張していない。**
                assert!(want > cap, "{}: an exempt row below the cap", case.id);
            } else {
                assert!(want <= cap, "{}: expectation above the cap", case.id);
            }
        }
        let key = format!("{}/{}", case.set, case.boundary);
        let tally = tallies.entry(key).or_default();
        let got = match case.op.as_str() {
            "loan_forward" => {
                let residual = yen(case.input.residual.as_deref().unwrap_or("0"));
                forward::compute(principal, &rate, case.input.n, residual)
                    .map(|out| (out.monthly_payment, None))
            }
            "loan_bonus_forward" => {
                let bp = yen(case.input.bonus_principal.as_deref().unwrap_or("0"));
                bonus::compute_forward(principal, bp, &rate, case.input.n)
                    .map(|out| (out.monthly_payment, Some(out.bonus_payment)))
            }
            other => panic!("{}: unknown op {other}", case.id),
        };
        match (got, want_error) {
            // 上限超えの行。**期待した綴りのエラーだけが成功**である。
            (Err(e), Some(code)) => {
                if format!("{e:?}") == code {
                    tally.errors += 1;
                } else {
                    failures.push(format!(
                        "{}: {} returned {e:?}, wanted {code}",
                        case.id, case.op
                    ));
                }
            }
            // エラーを期待した行が答えを出した = 上限が効いていない。
            (Ok((monthly, _)), Some(code)) => failures.push(format!(
                "{}: {} returned monthly {monthly}, wanted {code}",
                case.id, case.op
            )),
            // 値の行の Err は許容の話ではなく製品側の異常終了。tally には入れず、
            // failures にだけ積んで走査を続ける(1 件の Err で残り全部を
            // 見ないままにしない)。
            (Err(e), None) => failures.push(format!("{}: {} returned {e:?}", case.id, case.op)),
            (Ok((monthly, bonus_payment)), None) => {
                let want = want_monthly
                    .unwrap_or_else(|| panic!("{}: no monthly_floor to compare", case.id));
                if !check(monthly, want, &golden.tolerance, tally) {
                    failures.push(format!("{}: monthly {monthly} vs floor {want}", case.id));
                }
                if let Some(got_bonus) = bonus_payment {
                    let want_bonus = yen(case.expect.bonus_floor.as_deref().unwrap_or("0"));
                    if !check(got_bonus, want_bonus, &golden.tolerance, tally) {
                        failures.push(format!(
                            "{}: bonus {got_bonus} vs floor {want_bonus}",
                            case.id
                        ));
                    }
                }
            }
        }
        compared += 1;
    }
    eprintln!("loan boundary (native): {tallies:?}");
    // 失敗の一覧を先に出す——セルの全件が Err でも、下の「空のセル」より先にその一覧が見える。
    assert!(
        failures.is_empty(),
        "{} outside the allowance:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // **比べたことを数えるのはこのセルごとの「空でない」**(記憶 tests-can-assert-nothing)。
    // 上限の 2 セルも同じ扱いにする——`over_cap` は期待どおりのエラー、`exempt` は
    // 値の比較で数が立つ。
    for (set, boundary) in CELLS {
        let t = tallies.get(&format!("{set}/{boundary}"));
        assert!(
            t.is_some_and(|t| t.low + t.same + t.high + t.errors > 0),
            "no cases in {set}/{boundary}"
        );
    }
    // `compared` は全件を試みた(走査が途中で抜けていない)ことの番人。比べたことの番人ではない。
    assert_eq!(compared, golden.cases.len());
}

//! Loan の期待値を Python 参照実装と突き合わせる(base-spec §35、設計書 §7)。
//!
//! 比較は**完全一致**。金額は整数円で、丸めは決定的なので許容誤差は存在しない
//! ——このファイルの golden は tolerance を持たない。金額は JSON でも文字列で
//! ある(u64 は JSON number の 2^53 を超える)。
//!
//! 突き合わせは**出力の集合ごと**行う: Rust の結果を key→文字列の写像に直し、
//! JSON の `expect` と丸ごと比較する。項目の取りこぼし(片方にしか無い key)も
//! これで落ちる。

use std::collections::BTreeMap;
use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::expr;
use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward, inverse};
use calcarc_core::finance::{compound, compound_inverse, tax};
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
    op: String,
    input: Input,
    expect: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct Input {
    #[serde(default)]
    rate: String,
    #[serde(default)]
    n: Option<u32>,
    #[serde(default)]
    principal: Option<String>,
    #[serde(default)]
    residual: Option<String>,
    #[serde(default)]
    payment: Option<String>,
    #[serde(default)]
    bonus_principal: Option<String>,
    #[serde(default)]
    monthly_payment: Option<String>,
    #[serde(default)]
    bonus_payment: Option<String>,
    // 複利。ローンとは入力が重ならないので、同じ合併型に足すだけで済む。
    #[serde(default)]
    deposit: Option<String>,
    #[serde(default)]
    periods: Option<u32>,
    #[serde(default)]
    periods_per_year: Option<u32>,
    #[serde(default)]
    tax: Option<bool>,
    #[serde(default)]
    target: Option<String>,
    // 式。ローン・複利とは入力が重ならないので、同じ合併型に足すだけで済む。
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    unit_set: Option<String>,
    #[serde(default)]
    max: Option<String>,
}

impl Input {
    fn yen(&self, field: &Option<String>) -> Result<u64, CalcError> {
        field
            .as_deref()
            .ok_or(CalcError::SyntaxError)?
            .parse()
            .map_err(|_| CalcError::SyntaxError)
    }

    fn rows(&self) -> Result<u32, CalcError> {
        self.n.ok_or(CalcError::SyntaxError)
    }
}

fn load() -> Golden {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "testdata",
        "finance.json",
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

fn field(map: &mut BTreeMap<String, String>, key: &str, value: impl ToString) {
    map.insert(key.to_string(), value.to_string());
}

/// 式。**入力が金利を持たない**ので、下の配線とは分けて受ける。
fn run_expression(op: &str, input: &Input) -> Result<BTreeMap<String, String>, CalcError> {
    let text = input.text.as_deref().ok_or(CalcError::SyntaxError)?;
    let value = if op == "expr_percent" {
        expr::evaluate_to_percent(text)?
    } else {
        let maximum: u128 = input
            .max
            .as_deref()
            .ok_or(CalcError::SyntaxError)?
            .parse()
            .map_err(|_| CalcError::SyntaxError)?;
        let units = expr::unit_set_from_str(input.unit_set.as_deref().unwrap_or("none"))?;
        expr::evaluate_to_integer(text, maximum, units)?.to_string()
    };
    let mut out = BTreeMap::new();
    field(&mut out, "value", value);
    Ok(out)
}

/// 複利。**金利の作り方がローンと違う**(分母に期/年が入る)ので、
/// 月利を前提にした下の配線とは分けて受ける。
fn run_compound(input: &Input) -> Result<BTreeMap<String, String>, CalcError> {
    let rate = Rate::from_annual_percent(
        &input.rate,
        input.periods_per_year.ok_or(CalcError::SyntaxError)?,
    )?;
    let growth = compound::grow(
        input.yen(&input.principal)?,
        input.yen(&input.deposit)?,
        &rate,
        input.periods.ok_or(CalcError::SyntaxError)?,
    )?;
    let mut out = BTreeMap::new();
    field(&mut out, "final_balance", growth.final_balance);
    field(&mut out, "principal_total", growth.principal_total);
    field(&mut out, "interest", growth.interest);
    if input.tax == Some(true) {
        let (national, local) = tax::withholding(growth.interest)?;
        let net = growth
            .final_balance
            .checked_sub(national)
            .and_then(|v| v.checked_sub(local))
            .ok_or(CalcError::Overflow)?;
        field(&mut out, "national_tax", national);
        field(&mut out, "local_tax", local);
        field(&mut out, "net", net);
    }
    Ok(out)
}

/// 逆算 2 op。**答の key だけが違い、内訳は compound_grow と同じ形**である。
fn run_compound_inverse(op: &str, input: &Input) -> Result<BTreeMap<String, String>, CalcError> {
    let rate = Rate::from_annual_percent(
        &input.rate,
        input.periods_per_year.ok_or(CalcError::SyntaxError)?,
    )?;
    let target = input.yen(&input.target)?;
    let taxed = input.tax == Some(true);
    let mut out = BTreeMap::new();
    let s = if op == "compound_deposit_for" {
        let s = compound_inverse::deposit_for(
            input.yen(&input.principal)?,
            &rate,
            input.periods.ok_or(CalcError::SyntaxError)?,
            target,
            taxed,
        )?;
        field(&mut out, "deposit", s.deposit);
        s
    } else {
        let s = compound_inverse::periods_for(
            input.yen(&input.principal)?,
            input.yen(&input.deposit)?,
            &rate,
            target,
            taxed,
        )?;
        field(&mut out, "periods", s.periods);
        s
    };
    field(&mut out, "final_balance", s.growth.final_balance);
    field(&mut out, "principal_total", s.growth.principal_total);
    field(&mut out, "interest", s.growth.interest);
    if taxed {
        field(&mut out, "national_tax", s.national_tax);
        field(&mut out, "local_tax", s.local_tax);
        field(&mut out, "net", s.net);
    }
    Ok(out)
}

/// op ごとにコアの関数へ配線し、出力を key→文字列の写像にする。
fn run(op: &str, input: &Input) -> Result<BTreeMap<String, String>, CalcError> {
    if op == "compound_grow" {
        return run_compound(input);
    }
    if op == "compound_deposit_for" || op == "compound_periods_for" {
        return run_compound_inverse(op, input);
    }
    if op.starts_with("expr_") {
        return run_expression(op, input);
    }
    let rate = Rate::from_percent(&input.rate)?;
    let mut out = BTreeMap::new();
    match op {
        "loan_forward" => {
            let r = forward::compute(
                input.yen(&input.principal)?,
                &rate,
                input.rows()?,
                input.yen(&input.residual)?,
            )?;
            field(&mut out, "monthly_payment", r.monthly_payment);
            field(&mut out, "total_payment", r.total_payment);
            field(&mut out, "total_interest", r.total_interest);
            field(&mut out, "final_payment", r.final_payment);
            field(&mut out, "rows_paid", r.rows_paid);
        }
        "loan_principal" => {
            let r = inverse::principal_for(input.yen(&input.payment)?, &rate, input.rows()?)?;
            field(&mut out, "principal", r.principal);
            field(&mut out, "total_payment", r.total_payment);
            field(&mut out, "total_interest", r.total_interest);
            field(&mut out, "final_payment", r.final_payment);
            field(&mut out, "rows_paid", r.rows_paid);
        }
        "loan_term" => {
            let r = inverse::term_for(
                input.yen(&input.principal)?,
                &rate,
                input.yen(&input.payment)?,
            )?;
            field(&mut out, "n", r.n);
            field(&mut out, "total_payment", r.total_payment);
            field(&mut out, "total_interest", r.total_interest);
            field(&mut out, "final_payment", r.final_payment);
        }
        "loan_bonus_forward" => {
            let r = bonus::compute_forward(
                input.yen(&input.principal)?,
                input.yen(&input.bonus_principal)?,
                &rate,
                input.rows()?,
            )?;
            field(&mut out, "monthly_payment", r.monthly_payment);
            field(&mut out, "bonus_payment", r.bonus_payment);
            field(&mut out, "bonus_rows", r.bonus_rows);
            field(&mut out, "total_payment", r.total_payment);
            field(&mut out, "total_interest", r.total_interest);
            field(&mut out, "monthly_final_payment", r.monthly_final_payment);
            field(&mut out, "bonus_final_payment", r.bonus_final_payment);
        }
        "loan_bonus_principal" => {
            let r = bonus::principal_for(
                input.yen(&input.monthly_payment)?,
                input.yen(&input.bonus_payment)?,
                &rate,
                input.rows()?,
            )?;
            field(&mut out, "monthly_principal", r.monthly_principal);
            field(&mut out, "bonus_principal", r.bonus_principal);
            field(&mut out, "total_principal", r.total_principal);
            field(&mut out, "total_payment", r.total_payment);
            field(&mut out, "total_interest", r.total_interest);
        }
        other => panic!("unknown op {other}"),
    }
    Ok(out)
}

/// JSON の expect を key→文字列の写像に直す(数値は 10 進表記のまま)。
fn expected(case: &Case) -> BTreeMap<String, String> {
    case.expect
        .iter()
        .map(|(k, v)| {
            let text = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            (k.clone(), text)
        })
        .collect()
}

#[test]
fn loan_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        let expect_error = case.expect.get("error").and_then(|v| v.as_str());
        match (run(&case.op, &case.input), expect_error) {
            (Ok(actual), None) => assert_eq!(actual, expected(case), "{}", case.id),
            (Err(e), Some(expected_code)) => {
                let code = match e {
                    CalcError::Overflow => "Overflow",
                    CalcError::SyntaxError => "SyntaxError",
                    // 式が入って 0 除算が届くようになった。**panic の腕は残す**
                    // ——知らないエラーが黙って通らないのは良い性質である。
                    CalcError::DivisionByZero => "DivisionByZero",
                    other => panic!("{}: unexpected error kind {other:?}", case.id),
                };
                assert_eq!(code, expected_code, "{}: error kind", case.id);
            }
            (Ok(_), Some(code)) => panic!("{}: expected {code} but succeeded", case.id),
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }
}

/// 必須ケースが 5 つの op すべてに行き渡っていること(設計書 §7 の植え漏れ検査)。
#[test]
fn every_mode_is_covered_by_the_golden() {
    let golden = load();
    for op in [
        "loan_forward",
        "loan_principal",
        "loan_term",
        "loan_bonus_forward",
        "loan_bonus_principal",
        "compound_deposit_for",
        "compound_periods_for",
    ] {
        let count = golden.cases.iter().filter(|c| c.op == op).count();
        assert!(count > 0, "no golden case for {op}");
    }
    // 金利 0% は 3 モードすべてに要る(実装分岐がモードごとに違う)。
    for op in ["loan_forward", "loan_principal", "loan_term"] {
        assert!(
            golden
                .cases
                .iter()
                .any(|c| c.op == op && c.input.rate == "0"),
            "no zero-rate case for {op}"
        );
    }
    // エラー期待のケースも入っていること。
    assert!(
        golden.cases.iter().any(|c| c.expect.contains_key("error")),
        "no error case"
    );
}

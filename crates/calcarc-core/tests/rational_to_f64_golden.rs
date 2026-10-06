//! 「i128 の分数 → 正しく丸めた f64」(`expr::rational::ratio_to_f64`)を Python 参照と
//! 突き合わせる(1.2.2 設計書 §5.3・§8.2)。
//!
//! **比較はビット一致。** 正しい丸めの答えは 1 つしかないので、許容を持たない
//! (`testdata/rational_to_f64.json` も `tolerance` を持たない)。期待は f64 のビット列
//! (16 進)で読む——JSON の十進を f64 に読む段の丸めを挟まない。
//!
//! 参照は `reference/src/calcarc_reference/rational_round.py`(`float(Fraction(num, den))`、
//! 独立: 別手順)。
//!
//! Run: cargo test -p calcarc-core --test rational_to_f64_golden

use calcarc_core::expr::rational::ratio_to_f64;
use serde::Deserialize;

const GOLDEN: &str = include_str!("../../../testdata/rational_to_f64.json");

#[derive(Debug, Deserialize)]
struct Golden {
    schema: u32,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    family: String,
    input: Input,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct Input {
    num: String,
    den: String,
}

#[derive(Debug, Deserialize)]
struct Expect {
    bits: String,
    repr: String,
}

#[test]
fn ratios_round_like_python_bit_for_bit() {
    let golden: Golden = serde_json::from_str(GOLDEN).expect("golden が読めない");
    assert_eq!(golden.schema, 1, "golden の schema が変わった");
    let mut failures = Vec::new();
    let mut families = std::collections::BTreeMap::<&str, usize>::new();
    for case in &golden.cases {
        let num: i128 = case.input.num.parse().expect("分子が i128 でない");
        let den: i128 = case.input.den.parse().expect("分母が i128 でない");
        let hex = case.expect.bits.trim_start_matches("0x");
        let want = u64::from_str_radix(hex, 16).expect("ビット列が読めない");
        let got = ratio_to_f64(num, den).map(f64::to_bits);
        if got != Some(want) {
            failures.push(format!(
                "{}: 期待 {} ({}) 得た {:?}",
                case.id,
                case.expect.bits,
                case.expect.repr,
                got.map(|b| format!("0x{b:016x} ({:?})", f64::from_bits(b)))
            ));
        }
        *families.entry(case.family.as_str()).or_default() += 1;
    }
    println!("照合した行: {} {:?}", golden.cases.len(), families);
    // **何も比べずに緑にならない**——行の数と族を床として持つ。
    assert!(golden.cases.len() >= 400, "golden が痩せている");
    for family in [
        "around_2_53",
        "tie_unreduced",
        "tie_odd_den",
        "i128_ends",
        "random",
    ] {
        assert!(families.contains_key(family), "{family} の行が無い");
    }
    assert!(
        failures.is_empty(),
        "{} / {} 行が違う:\n{}",
        failures.len(),
        golden.cases.len(),
        failures.join("\n")
    );
}

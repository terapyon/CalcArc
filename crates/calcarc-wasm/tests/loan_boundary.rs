//! 境界専用の golden(設計書 2026-09-12 §4)を **製品が走る wasm32** で確かめる。
//!
//! native の Rust は x86 の libm、ブラウザの wasm32 は Rust 自前の libm で、ulp が違いうる。
//! **境界ちょうどは ulp 1 つで 1 円動く場所**なので、native の緑は製品の緑ではない
//! (レビュー条件 1、calcarc-1e)。境界(`loan_forward` / `loan_bonus_forward`)を渡って読む。
//!
//! **許容と上限はテストコードに書かない**(CLAUDE.md)——`testdata/loan_boundary.json` の
//! `tolerance` から読む。native 側は `crates/calcarc-core/tests/loan_boundary_golden.rs` が
//! 同じ JSON を読む(両方緑で緑)。報告の形(失敗行・tally の鍵)はそちらと揃えてある。
//!
//! **計算が失敗しても走査を止めない。** 1 件が `kind: "error"` を返しても、それは
//! 製品側の異常終了であって許容の話ではないので、failures に積んで次のケースへ進む
//! (レビューでの裁定: エラーは panic ではなく失敗として記録する)。
//!
//! Run: wasm-pack test --headless --chrome crates/calcarc-wasm

#![cfg(target_arch = "wasm32")]

use std::cmp::Ordering;
use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const GOLDEN: &str = include_str!("../../../testdata/loan_boundary.json");

#[derive(Default, Debug)]
struct Tally {
    low: u32,
    same: u32,
    high: u32,
}

fn get(value: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(value, &JsValue::from_str(key))
        .unwrap_or_else(|_| panic!("missing field {key}"))
}

fn yen_field(value: &JsValue, key: &str) -> u64 {
    get(value, key)
        .as_string()
        .unwrap_or_else(|| panic!("{key} is not a string"))
        .parse()
        .unwrap_or_else(|_| panic!("{key} is not a yen amount"))
}

fn yen(v: &serde_json::Value) -> u64 {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("not a yen string: {v}"))
}

/// `out` を人に読める形にする。`kind: "error"` なら `code` が出る。
fn render(out: &JsValue) -> String {
    js_sys::JSON::stringify(out)
        .ok()
        .and_then(|s| s.as_string())
        .unwrap_or_else(|| format!("{out:?}"))
}

#[wasm_bindgen_test]
fn monthly_payments_stay_within_the_allowance_on_yen_boundaries_in_wasm32() {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).expect("golden parses");
    assert_eq!(golden["schema"], 1, "incompatible schema");
    let below = golden["tolerance"]["below_yen"]
        .as_u64()
        .expect("below_yen");
    let above = golden["tolerance"]["above_yen"]
        .as_u64()
        .expect("above_yen");
    let within = |got: u64, want: u64| {
        want.saturating_sub(below) <= got && got <= want.saturating_add(above)
    };
    let cases = golden["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());

    let mut tallies: BTreeMap<String, Tally> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();
    let mut compared = 0usize;

    for case in cases {
        let id = case["id"].as_str().expect("id");
        let op = case["op"].as_str().expect("op");
        let input = &case["input"];
        let rate = input["rate"].as_str().expect("rate");
        let n = input["n"].as_u64().expect("n") as u32;
        let principal = input["principal"].as_str().expect("principal");
        let key = format!(
            "{}/{}",
            case["set"].as_str().expect("set"),
            case["boundary"].as_str().expect("boundary")
        );
        let tally = tallies.entry(key).or_default();

        let out = match op {
            "loan_forward" => calcarc_wasm::loan_forward(
                principal,
                rate,
                n,
                input["residual"].as_str().expect("residual"),
            ),
            "loan_bonus_forward" => calcarc_wasm::loan_bonus_forward(
                principal,
                input["bonus_principal"].as_str().expect("bp"),
                rate,
                n,
            ),
            other => panic!("{id}: unknown op {other}"),
        };

        // **エラーは panic ではなく失敗として記録し、次のケースへ進む**
        // (レビュー条件 1 の修正裁定)。1 件の error で残り全部を見ないままにしない。
        if get(&out, "kind").as_string().as_deref() != Some("ok") {
            failures.push(format!("{id}: {op} returned {}", render(&out)));
            compared += 1;
            continue;
        }

        let mut pairs: Vec<(&str, u64, u64)> = vec![(
            "monthly",
            yen_field(&out, "monthlyPayment"),
            yen(&case["expect"]["monthly_floor"]),
        )];
        if op == "loan_bonus_forward" {
            pairs.push((
                "bonus",
                yen_field(&out, "bonusPayment"),
                yen(&case["expect"]["bonus_floor"]),
            ));
        }
        for (what, got, want) in pairs {
            match got.cmp(&want) {
                Ordering::Less => tally.low += 1,
                Ordering::Equal => tally.same += 1,
                Ordering::Greater => tally.high += 1,
            }
            if !within(got, want) {
                failures.push(format!("{id}: {what} {got} vs floor {want}"));
            }
        }
        compared += 1;
    }

    // **何かを比べたことを数える**(記憶 tests-can-assert-nothing)。
    // 静かな取りこぼしを許さない: エラーになったケースも 1 件として数える。
    assert_eq!(compared, cases.len());
    for set in ["plain", "residual", "bonus"] {
        for boundary in ["exact", "below", "above"] {
            let t = tallies.get(&format!("{set}/{boundary}"));
            assert!(
                t.is_some_and(|t| t.low + t.same + t.high > 0),
                "no cases in {set}/{boundary}"
            );
        }
    }
    console_log!("loan boundary (wasm32) [low, same, high]: {tallies:?}");
    assert!(
        failures.is_empty(),
        "{} outside the allowance:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

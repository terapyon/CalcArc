//! 複素除算の境界専用 golden（F7、0.9.4）を native で確かめる。
//!
//! **通常のコーパスはこの領域に届かない。** `complex-000.json` の生成器は大きさを
//! `1e-6`〜`1e9` に制限しており、**帯を外しても乱択は上端 1 オクターブ
//! (`MAX/2`〜`MAX`)を踏まない**——20 万本で 27,046 件の除算を真値と突き合わせて
//! **踏んだのは 0 件**だった（2026-09-18 実測）。**だから構成したケースがここに在る。**
//!
//! **許容はテストコードに書かない**(CLAUDE.md)——`testdata/complex_div_boundary.json`
//! の `tolerance.rel` から読む。**`abs` は無い**——期待値が `1e-320` 前後の行に対して
//! 絶対許容は桁違いに緩く、**表の下端が丸ごと無検査になる**からである。
//! **0 であるべき成分は「厳密に 0」**で別に見張る。
//!
//! **wasm32 側は `crates/calcarc-wasm/tests/complex_div_boundary.rs` が同じ JSON を読む**
//! (両方緑で緑)。**`EXPECTED_INEXACT` は両方に在り、同じ数でなければならない**——
//! 2026-09-18 に native と wasm32 の両方で測り、**件数も id も完全に一致**した。
//!
//! Run: cargo test -p calcarc-core --test complex_div_boundary

use calcarc_core::Value;
use serde::Deserialize;

const GOLDEN: &str = include_str!("../../../testdata/complex_div_boundary.json");

/// **ビット一致しない件数。** 下限ではなく**厳密**に主張する——
/// **増えたら退行、減ったら記録を直す番**である。
///
/// **8 件はすべて `e-320` の `double` 族(`z/(z÷2)`)の実部優勢・虚部優勢**
/// (4 符号 × 2 形)。**`self`・`half`・`real_over_sym` は 0 件で、対称形にも出ない。**
/// **非正規化域が丸ごと不正確なのではなく、非正規化域で入力を作る演算が絡んだときだけ**
/// である（`z÷2` は非正規化域で 1 ビット落ちる）。
///
/// 残差は **1 ULP(相対 2.220e-16 = 2^-52)**。**直す前の下端は相対 2.4e-4** で、
/// **これは 1 ULP の 12 桁上**——**丸めでは出ない**(`docs/numerical-policy.md`)。
const EXPECTED_INEXACT: usize = 8;

#[derive(Deserialize)]
struct Golden {
    schema: u32,
    tolerance: Tolerance,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Tolerance {
    rel: f64,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    num: [String; 2],
    den: [String; 2],
    expect: String,
    #[serde(default)]
    re: Option<String>,
    #[serde(default)]
    im: Option<String>,
}

fn f(text: &str) -> f64 {
    text.parse::<f64>()
        .unwrap_or_else(|e| panic!("golden の数を読めない {text:?}: {e}"))
}

#[test]
fn complex_division_holds_at_the_boundaries() {
    let golden: Golden = serde_json::from_str(GOLDEN).expect("golden が読めない");
    assert_eq!(golden.schema, 1, "golden の schema が変わった");
    let tol = golden.tolerance.rel;

    let mut exact = 0usize;
    let mut inexact: Vec<(String, f64)> = Vec::new();
    let mut correct_overflow = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for case in &golden.cases {
        let num = Value::new(f(&case.num[0]), f(&case.num[1]));
        let den = Value::new(f(&case.den[0]), f(&case.den[1]));
        let got = num.checked_div(den);

        if case.expect == "overflow" {
            // **逆向きの主張。** 「有限の正解を壊すな」だけだと、**全部エラーにする
            // 実装でも緑**になる。ここが在って初めて両側が閉じる。
            match got {
                Err(_) => correct_overflow += 1,
                Ok(v) => failures.push(format!(
                    "{}: 真に範囲外なのに値を返した ({:e}{:+e}j)",
                    case.id, v.re, v.im
                )),
            }
            continue;
        }

        let want = (
            f(case.re.as_deref().expect("finite の行に re が無い")),
            f(case.im.as_deref().expect("finite の行に im が無い")),
        );
        let v = match got {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!(
                    "{}: 有限の正解 ({:e}{:+e}j) を拒んだ: {e:?}",
                    case.id, want.0, want.1
                ));
                continue;
            }
        };

        // **0 であるべき成分は厳密に 0。** 許容を当てない——当てると、
        // 期待値が 0 の行だけ「どんな小さな値でも通る」帯になる。
        for (name, g, w) in [("re", v.re, want.0), ("im", v.im, want.1)] {
            if w == 0.0 && g != 0.0 {
                failures.push(format!(
                    "{}: {name} は厳密に 0 のはずが {g:e}（0 に許容は当てない）",
                    case.id
                ));
            }
        }

        if v.re == want.0 && v.im == want.1 {
            exact += 1;
            continue;
        }
        if v.re == 0.0 && v.im == 0.0 {
            failures.push(format!(
                "{}: 静かに 0 に潰れた（真値 {:e}{:+e}j）",
                case.id, want.0, want.1
            ));
            continue;
        }
        let scale = want.0.abs().max(want.1.abs()).max(f64::MIN_POSITIVE);
        let rel = (v.re - want.0).abs().max((v.im - want.1).abs()) / scale;
        if rel > tol {
            // **メッセージに定数を埋め込む**——**焼いた数は、赤が出た瞬間に嘘を読ませる**
            // (2026-09-18 に実際に踏んだ: 許容を締めたのに文言が古い数のままだった)。
            failures.push(format!(
                "{}: 相対差 {rel:e} が許容 {tol:e} を超えた（真値 {:e}{:+e}j、得た値 {:e}{:+e}j）",
                case.id, want.0, want.1, v.re, v.im
            ));
        } else {
            inexact.push((case.id.clone(), rel));
        }
    }

    assert!(
        failures.is_empty(),
        "{} 件が境界で崩れた:\n  {}",
        failures.len(),
        failures.join("\n  ")
    );

    // **「全部許容で通した」と「大半が厳密一致で、8 件だけ 1 ULP」は別の状態。**
    // **後者が読めるように、両方を印字する。**
    println!(
        "complex_div_boundary: {} 件中 厳密一致 {exact} / 許容内 {} / 真に範囲外を正しくエラー {correct_overflow}",
        golden.cases.len(),
        inexact.len()
    );

    assert_eq!(
        inexact.len(),
        EXPECTED_INEXACT,
        "ビット一致しない件数が {EXPECTED_INEXACT} と違う（増えたら退行、減ったら \
         EXPECTED_INEXACT と註を直す番）: {:?}",
        inexact
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>()
    );

    // **数だけでなく、どこに在るかも主張する。** 件数が合っていても別の場所へ
    // 移っていたら、それは違う話である。
    for (id, _) in &inexact {
        assert!(
            id.starts_with("e-320/") && id.ends_with("/double"),
            "ビット一致しない行が非正規化域の `double` 族の外へ移った: {id}"
        );
        assert!(
            id.contains("re_heavy") || id.contains("im_heavy"),
            "対称形にも差が出るようになった（いままでは実部優勢・虚部優勢だけ）: {id}"
        );
    }

    // **対照が実在すること。** 純実数・純虚数は原理的に壊れないので、
    // **それらが表に在って緑であることが、引き金の条件を裏から支える。**
    let controls = golden
        .cases
        .iter()
        .filter(|c| c.id.contains("/pure_re/") || c.id.contains("/pure_im/"))
        .count();
    assert!(
        controls >= 100,
        "対照（純実数・純虚数）が {controls} 件しかない——引き金が「両成分が非零」で \
         あることを支える行が痩せている"
    );
}

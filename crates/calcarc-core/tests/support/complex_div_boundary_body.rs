// 複素除算の境界 golden を確かめる本文。**native と wasm32 の 2 つのテストが `include!` する**
// （`crates/calcarc-core/tests/complex_div_boundary.rs` と
// `crates/calcarc-wasm/tests/complex_div_boundary.rs`）。
//
// **0.9.4 までは本文を 2 か所に写していた**（「片方だけ直すと違う主張になる」と註で断って）。
// **註は破っても赤くならない**ので、0.9.5 で 1 か所にした——**写しが無ければ食い違えない。**

use calcarc_core::Value;
use serde::Deserialize;

const GOLDEN: &str = include_str!("../../../../testdata/complex_div_boundary.json");

/// **0.9.4 の行（F7）のうち、ビット一致しない件数。** 下限ではなく**厳密**に主張する。
///
/// **8 件はすべて `e-320` の `double` 族(`z/(z÷2)`)の実部優勢・虚部優勢**
/// (4 符号 × 2 形)。**非正規化域で入力を作る演算が絡んだときだけ**である
/// （`z÷2` は非正規化域で 1 ビット落ちる）。残差は **1 ULP**。
const EXPECTED_INEXACT_F7: usize = 8;

/// **0.9.5 で足した族（`gap/`・`den_gap/`・`chain/`）のうち、ビット一致しない件数。**
///
/// **直しの枝の上で測って埋める。** 0.9.4（de50c40）の上では、この数に着く前に
/// 成分の判定が落ちる（F16）。
const EXPECTED_INEXACT_NEW: usize = 0;

/// 0.9.5 で足した族の id の頭（生成器の `NEW_FAMILIES` と同じ）。
const NEW_FAMILIES: [&str; 3] = ["gap/", "den_gap/", "chain/"];

#[derive(Deserialize)]
struct Golden {
    schema: u32,
    tolerance: Tolerance,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Tolerance {
    rel: f64,
    abs_floor: f64,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    num: [String; 2],
    den: [String; 2],
    #[serde(default)]
    then: Vec<(String, [String; 2])>,
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

fn value(pair: &[String; 2]) -> Value {
    Value::new(f(&pair[0]), f(&pair[1]))
}

fn is_new(id: &str) -> bool {
    NEW_FAMILIES.iter().any(|p| id.starts_with(p))
}

/// 除算のあと、`then` の段（引く・掛ける）を順に当てる。
fn evaluate(case: &Case) -> Result<Value, String> {
    let mut v = value(&case.num)
        .checked_div(value(&case.den))
        .map_err(|e| format!("{e:?}"))?;
    for (op, operand) in &case.then {
        let rhs = value(operand);
        v = match op.as_str() {
            "sub" => v.checked_sub(rhs),
            "mul" => v.checked_mul(rhs),
            other => panic!("{}: 知らない段 {other:?}", case.id),
        }
        .map_err(|e| format!("{op} の段で {e:?}"))?;
    }
    Ok(v)
}

/// **成分ごとに判定する（0.9.5、F16）。** 0.9.4 の比較器は「大きい方の期待成分で両成分の差を
/// 割る」形で、`(1e308, 1e-20)` の虚部が丸ごと 0 になっても**相対差 0 で許容内**と数えた。
/// **1 つの成分の消失を、もう 1 つの成分の大きさで薄めない。**
///
/// 1. 期待が 0 の成分は**厳密に 0**（許容を当てない）
/// 2. 期待が非零の成分は、得た値も**非零で同じ符号**（「潰れた」「反転した」を名指す）
/// 3. 差は `max(rel·|期待|, abs_floor)` 以内。`abs_floor` は相対の規則を非正規化域へ
///    延ばしたもの（生成器の `TOLERANCE_ABS_FLOOR` の註）
fn component_failures(id: &str, got: Value, want: (f64, f64), tol: &Tolerance) -> Vec<String> {
    let mut out = Vec::new();
    for (name, g, w) in [("re", got.re, want.0), ("im", got.im, want.1)] {
        if w == 0.0 {
            if g != 0.0 {
                out.push(format!("{id}: 成分 {name} は厳密に 0 のはずが {g:e}（0 に許容は当てない）"));
            }
            continue;
        }
        if g == 0.0 {
            out.push(format!("{id}: 成分 {name} が 0 に潰れた（期待 {w:e}）"));
            continue;
        }
        if g.is_sign_negative() != w.is_sign_negative() {
            out.push(format!("{id}: 成分 {name} の符号が反転した（期待 {w:e}、得た値 {g:e}）"));
            continue;
        }
        let allowed = (tol.rel * w.abs()).max(tol.abs_floor);
        let diff = (g - w).abs();
        if diff > allowed {
            // **メッセージに定数を埋め込む**——焼いた数は、赤が出た瞬間に嘘を読ませる。
            out.push(format!(
                "{id}: 成分 {name} の差 {diff:e}（相対 {:e}）が許容 {allowed:e}（rel {:e}・abs_floor {:e}）を超えた（期待 {w:e}、得た値 {g:e}）",
                diff / w.abs(),
                tol.rel,
                tol.abs_floor
            ));
        }
    }
    out
}

fn check_complex_div_boundaries() {
    let golden: Golden = serde_json::from_str(GOLDEN).expect("golden が読めない");
    assert_eq!(golden.schema, 1, "golden の schema が変わった");
    let tol = &golden.tolerance;

    let mut exact = 0usize;
    let mut inexact_f7: Vec<&str> = Vec::new();
    let mut inexact_new: Vec<&str> = Vec::new();
    let mut correct_overflow = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for case in &golden.cases {
        let got = evaluate(case);

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
                    "{}: 有限の正解 ({:e}{:+e}j) を拒んだ: {e}",
                    case.id, want.0, want.1
                ));
                continue;
            }
        };

        let bad = component_failures(&case.id, v, want, tol);
        if !bad.is_empty() {
            failures.extend(bad);
        } else if v.re == want.0 && v.im == want.1 {
            exact += 1;
        } else if is_new(&case.id) {
            inexact_new.push(&case.id);
        } else {
            inexact_f7.push(&case.id);
        }
    }

    // **件数を先に言う**——一覧は長く、印字の先頭だけでは全体が読めない。
    assert!(
        failures.is_empty(),
        "{} 件が境界で崩れた（{} 件中）:\n  {}",
        failures.len(),
        golden.cases.len(),
        failures.join("\n  ")
    );

    println!(
        "complex_div_boundary: {} 件中 厳密一致 {exact} / 許容内 F7 {} ・新しい族 {} / 真に範囲外を正しくエラー {correct_overflow}",
        golden.cases.len(),
        inexact_f7.len(),
        inexact_new.len()
    );

    // **件数の番人は、成分の判定を通った行だけを数える。** 0.9.4 では成分が消えた行が
    // 「許容内」に数えられ、この数だけが偶然赤くなった——**数を合わせれば緑に戻る形**だった。
    assert_eq!(
        inexact_f7.len(),
        EXPECTED_INEXACT_F7,
        "0.9.4 の行でビット一致しない件数が {EXPECTED_INEXACT_F7} と違う: {inexact_f7:?}"
    );
    assert_eq!(
        inexact_new.len(),
        EXPECTED_INEXACT_NEW,
        "0.9.5 の族でビット一致しない件数が {EXPECTED_INEXACT_NEW} と違う: {inexact_new:?}"
    );

    // **数だけでなく、どこに在るかも主張する。**
    for id in &inexact_f7 {
        assert!(
            id.starts_with("e-320/") && id.ends_with("/double"),
            "ビット一致しない行が非正規化域の `double` 族の外へ移った: {id}"
        );
        assert!(
            id.contains("re_heavy") || id.contains("im_heavy"),
            "対称形にも差が出るようになった（いままでは実部優勢・虚部優勢だけ）: {id}"
        );
    }

    // **対照が実在すること。**
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

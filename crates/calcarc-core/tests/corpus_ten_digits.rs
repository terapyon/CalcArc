//! 番人: コーパスの値ケースで、**表示が「真値の 10 桁」と一致する**こと
//! (1.2.3 の設計書 §5.3)。
//!
//! 重量級の値シャードは相対許容 5e-10 で比べる。**それでは 10 桁目の 1 違いを見逃す**
//! (F2 を外したときの 223 件のうち 181 件は相対誤差が 5e-10 以下。設計書 §5.3)。
//! ここでは許容を使わず、**文字列で**比べる。
//!
//! - **期待の文字列**: 期待値(`expect.re`/`im`。Python の独立実装が mpmath で出した値)を
//!   engine の `format_rect` で整形したもの。**整形の正しさは別の番人が見ている**
//!   (表示シャードが `real_ref` と突き合わせる)。ここで問うのは**値**である。
//! - **実際の文字列**: キー列を `reduce` で畳んだ最後の表示(`DisplayState.main`)。
//! - **一致しない件は、名前で列挙した許可リストだけ**——件数ではなく名前で見張る。
//!   許可リストの件が一致するようになったら赤(リストが古くならないように)。
//!
//! 読み方は `corpus_refused_presses.rs` に倣う(`CARGO_MANIFEST_DIR/../../corpus/generated/*.json`、
//! `serde_json::Value` のまま読む、トークンは `Key::from_token`)。**値ケースは
//! `kind == "value"` のものだけ**——表示(`display`)・同値(`equivalence`)・呼び出し(`call`)は
//! 別の形の期待を持つので数えない。値ケースはどれも `expect: {re, im}` を持つ
//! (持たなければ赤にする。黙って飛ばさない)。
//!
//! **角度モードは `mode` 欄から設定しない。** RAD のケースはキー列の頭に `angle_toggle` を
//! 持つ(`EngineState::initial()` は DEG)。モードとキー列の食い違いは下で赤にする。

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use calcarc_core::engine::reduce;
use calcarc_core::numeric::format::format_rect;
use calcarc_core::{AngleMode, EngineState, Key, Value};
use serde_json::Value as Json;

/// 表示が真値の 10 桁と一致しない、と分かっている件。**名前で**列挙する。
///
/// - `canc-000949`(`1.000000009 ln`): 真値が 10 桁の丸めの境目から相対 2.7e-17。
///   **真値を正しく丸めた f64 なら 10 桁は合う**——外すのは `q − 1` を f64 に丸めてから
///   `ln_1p` に渡す 1 段の手順で、**この手順では直せない**(`q − 1` の丸めの補正を
///   入れれば直る見込み。未実装・未測定。台帳 `rust-review-backlog.md` §7)。
const KNOWN_MISMATCHES: [&str; 1] = ["canc-000949"];

/// 比べた値ケースの数の下限。**2026-10-08 の実測 22,016**(値シャード 11 枚)。
/// シャードが黙って減った・読めなくなったときに赤くするための床。
const MIN_COMPARED: usize = 22_016;

fn corpus_dir() -> PathBuf {
    [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "corpus",
        "generated",
    ]
    .iter()
    .collect()
}

fn corpus_files() -> Vec<PathBuf> {
    let dir = corpus_dir();
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no corpus files under {}", dir.display());
    files
}

fn expected_component(case: &Json, id: &str, field: &str) -> f64 {
    case.get("expect")
        .and_then(|expect| expect.get(field))
        .and_then(Json::as_f64)
        .unwrap_or_else(|| panic!("{id}: value case without a numeric expect.{field}"))
}

#[test]
fn every_value_case_shows_the_true_values_ten_digits() {
    let mut compared: usize = 0;
    let mut mismatched: Vec<String> = Vec::new();
    let mut mismatched_ids: BTreeSet<String> = BTreeSet::new();
    let mut shards: BTreeSet<String> = BTreeSet::new();
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();

    for path in corpus_files() {
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let doc: Json = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
        let cases = doc
            .get("cases")
            .and_then(Json::as_array)
            .unwrap_or_else(|| panic!("{}: no cases array", path.display()));
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();

        for case in cases {
            if case.get("kind").and_then(Json::as_str) != Some("value") {
                continue;
            }
            let id = case.get("id").and_then(Json::as_str).unwrap_or("?");
            let tokens = case
                .get("keys")
                .and_then(Json::as_array)
                .unwrap_or_else(|| panic!("{id}: value case without keys"));
            let expected = format_rect(Value::new(
                expected_component(case, id, "re"),
                expected_component(case, id, "im"),
            ));

            let mut state = EngineState::initial();
            let mut shown = String::new();
            for token in tokens {
                let token = token.as_str().unwrap_or_default();
                let key = Key::from_token(token)
                    .unwrap_or_else(|| panic!("{id}: unknown token {token:?}"));
                let (next, display) = reduce(&state, key);
                state = next;
                shown = display.main;
            }

            let mode = match case.get("mode").and_then(Json::as_str) {
                Some("Deg") => AngleMode::Deg,
                Some("Rad") => AngleMode::Rad,
                other => panic!("{id}: unexpected mode {other:?}"),
            };
            assert_eq!(
                state.angle, mode,
                "{id}: keys end in a different angle mode"
            );

            compared += 1;
            seen_ids.insert(id.to_string());
            shards.insert(file_name.clone());
            if shown != expected {
                mismatched.push(format!("{id}: shown {shown:?}, true {expected:?}"));
                mismatched_ids.insert(id.to_string());
            }
        }
    }

    eprintln!(
        "compared {compared} value cases in {} shards; {} differ from the true value's 10 digits",
        shards.len(),
        mismatched.len()
    );
    for line in mismatched.iter().take(20) {
        eprintln!("  {line}");
    }

    let known: BTreeSet<String> = KNOWN_MISMATCHES.iter().map(|s| s.to_string()).collect();
    let unexpected: Vec<&String> = mismatched_ids.difference(&known).collect();
    // 許可リストの名前がコーパスに無い(シャードの再生成で id が振り直された等)のと、
    // 在って一致するようになったのとは、直し方が違うので分けて言う。どちらも赤。
    let missing: Vec<&String> = known.difference(&seen_ids).collect();
    let now_matching: Vec<&String> = known
        .difference(&mismatched_ids)
        .filter(|id| seen_ids.contains(*id))
        .collect();
    assert!(
        unexpected.is_empty(),
        "{} value cases do not show the true value's 10 digits (first: {:?})",
        unexpected.len(),
        mismatched
            .iter()
            .filter(|line| !KNOWN_MISMATCHES
                .iter()
                .any(|k| line.starts_with(&format!("{k}:"))))
            .take(5)
            .collect::<Vec<_>>()
    );
    assert!(
        missing.is_empty(),
        "allow-listed cases are missing from the corpus — check whether the shard was \
         regenerated, then update KNOWN_MISMATCHES: {missing:?}"
    );
    assert!(
        now_matching.is_empty(),
        "allow-listed cases now match the true value's 10 digits — remove them from \
         KNOWN_MISMATCHES: {now_matching:?}"
    );
    assert!(
        compared >= MIN_COMPARED,
        "compared only {compared} value cases, expected at least {MIN_COMPARED}"
    );
}

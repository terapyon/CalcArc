//! 番人: コミット済みの全コーパスのキー列に、製品が拒む押下が 0 件であること。
//!
//! 背景(外部監査 F5、0.9.2 で製品に merge 済み): 手元に値があるあいだ、画面の値を
//! 黙って捨てるキーは製品が拒む(`engine::refuses`)。キーパッドではそのボタンが
//! `disabled` になる(`Key.tsx:90`)ので、`heavy/`(`.click()` で本物のボタンを押す)は
//! そういう列を待って time out するし、人もそのキーを打てない。
//!
//! **製品の定義を import する。ここで規則を書き直さない**——呼ぶのは
//! `calcarc_core::engine::refuses` そのもの(CLAUDE.md「参照実装を Rust の移植に
//! しない」と同じ理由で、ここでも独自の判定を書けば同じ穴が両方に入って見張りに
//! ならない)。
//!
//! 読み方は `loan_boundary_golden.rs` に倣う
//! (`CARGO_MANIFEST_DIR/../../corpus/generated/*.json`)。各シャードのスキーマは
//! バラバラ(`keys` を持つもの、`left`/`right` を持つもの、どちらも持たないもの)
//! なので、型に写さず `serde_json::Value` のまま読む。

use std::fs;
use std::path::PathBuf;

use calcarc_core::engine::{reduce, refuses};
use calcarc_core::{EngineState, Key};
use serde_json::Value;

/// キー列を運ぶ可能性があるフィールドだけを見る。`input`/`op`(finance・data-scale)
/// のような、キー列ではないフィールドは数えない。
const SEQUENCE_FIELDS: [&str; 3] = ["keys", "left", "right"];

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

/// `case[field]` が文字列トークンの配列なら、そのトークン列を返す。
fn tokens_of<'a>(case: &'a Value, field: &str) -> Option<Vec<&'a str>> {
    let array = case.get(field)?.as_array()?;
    Some(
        array
            .iter()
            .map(|tok| tok.as_str().unwrap_or_default())
            .collect(),
    )
}

#[test]
fn no_committed_corpus_sequence_presses_a_refused_key() {
    let mut refused: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    let mut sequences: usize = 0;

    for path in corpus_files() {
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let doc: Value = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
        let cases = doc
            .get("cases")
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("{}: no cases array", path.display()));
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();

        for case in cases {
            let id = case.get("id").and_then(Value::as_str).unwrap_or("?");
            for field in SEQUENCE_FIELDS {
                let Some(tokens) = tokens_of(case, field) else {
                    continue;
                };
                sequences += 1;
                let mut state = EngineState::initial();
                for (index, token) in tokens.iter().enumerate() {
                    let Some(key) = Key::from_token(token) else {
                        unknown.push(format!("{file_name}:{id}:{field}:{index}:{token}"));
                        continue;
                    };
                    if refuses(&state, key) {
                        refused.push(format!("{id}:{index}:{token}"));
                    }
                    // 拒まれたキーでも `reduce` を呼ぶ——製品の `reduce` は拒まれた
                    // 押下では状態を変えない(`refused` に積んだ後でも安全に畳める)ので、
                    // 続くトークンを同じ状態から見られる。
                    let (next, _shown) = reduce(&state, key);
                    state = next;
                }
            }
        }
    }

    assert_eq!(
        unknown,
        Vec::<String>::new(),
        "unknown tokens in the corpus"
    );
    assert_eq!(
        refused,
        Vec::<String>::new(),
        "committed corpus presses a key the product refuses (id:index:token)"
    );
    // 下限は計画時点の実測(33,391)に、新しいシャード(2,000 件)を足した値。
    // 実測が変わったら、この下限ではなく実測の方を報告する(CLAUDE.md「許容は
    // テストコードに書かない」と同じ精神で、下限は緩め過ぎない現実の数)。
    assert!(
        sequences >= 35_000,
        "measured only {sequences} folded sequences, expected at least 35,000"
    );
}
